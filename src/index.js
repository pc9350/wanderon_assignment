const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { classifyQuery } = require('./router');
const { answerFromDocs } = require('./rag');
const { executeTool, getToolDescriptions } = require('./tools');
const { checkRefusalRules, validateOutput, checkTokenBudget } = require('./guardrails');
const { createRequestLog, saveLog, getRecentLogs } = require('./logger');
const { addFeedback, getStats } = require('./feedback');
const { chat } = require('./llm');
const { getOrCreateConversation, addMessage, getMessages } = require('./conversations');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- main query endpoint ----

app.post('/query', async (req, res) => {
  // Step 1: Setup 
  const start = Date.now();
  const requestId = uuidv4();
  const log = createRequestLog(requestId);

  try {
    // Step 2: Input Validation
    const { query, conversationId: incomingConvId } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "query" field' });
    }
    log.query = query;

    // Conversation management: get existing or create new
    const conversationId = getOrCreateConversation(incomingConvId);
    log.conversation_id = conversationId;

    // Store the user's message in conversation history
    addMessage(conversationId, 'user', query);

    // Step 3: Guardrails - Hard Refusal
    const refusal = checkRefusalRules(query);
    if (refusal.refused) {
      log.guardrails_triggered.push({ type: 'hard_refusal', reason: refusal.reason });
      log.route = 'OUT_OF_SCOPE';
      log.response_time_ms = Date.now() - start;
      saveLog(log);
      return res.json({
        request_id: requestId,
        answer: "I can't help with that request.",
        confidence: 1.0,
        route: 'OUT_OF_SCOPE',
        trace: {
          router: { route: 'OUT_OF_SCOPE', method: 'guardrail', reasoning: refusal.reason },
          guardrails: log.guardrails_triggered,
        },
      });
    }

    // Step 4: Guardrails - Token Budget
    const budget = checkTokenBudget(query);
    // Check if query > 2000 characters
    if (budget.exceeded) {
      log.guardrails_triggered.push({ type: 'token_budget', reason: budget.reason });
      log.response_time_ms = Date.now() - start;
      saveLog(log);
      return res.json({
        request_id: requestId,
        answer: 'Your query is too long. Please keep it under 2000 characters.',
        confidence: 1.0,
        route: 'OUT_OF_SCOPE',
        trace: { guardrails: log.guardrails_triggered },
      });
    }



    // Step 5: Route the query (with conversation context for better routing)
    const history = getMessages(conversationId);
    const routeResult = await classifyQuery(query, history);
    log.route = routeResult.route;
    log.route_method = routeResult.method;
    log.route_reasoning = routeResult.reasoning;

    let response;
    // Step 6: Route the query
    switch (routeResult.route) {
      case 'FACT_FROM_DOCS':
        response = await handleRAG(query, requestId, log, conversationId);
        break;
      case 'STRUCTURED_DATA':
        response = await handleToolCall(query, requestId, log, conversationId);
        break;
      case 'SMALL_TALK':
        response = await handleSmallTalk(query, requestId, log, conversationId);
        break;
      case 'OUT_OF_SCOPE':
      default:
        response = handleRefusal(requestId, routeResult.reasoning);
        break;
    }

    // Store assistant response in conversation history
    addMessage(conversationId, 'assistant', response.answer);
    response.conversation_id = conversationId;

    // Step 8: Output Validation Guardrail
    const validation = validateOutput(response);
    if (!validation.valid) {
      log.guardrails_triggered.push({ type: 'output_validation', errors: validation.errors });
      // clamp confidence to valid range if it drifted
      if (typeof response.confidence === 'number') {
        response.confidence = Math.max(0, Math.min(1, response.confidence));
      } else {
        response.confidence = 0;
      }
    }

    // Step 9: Attach the full trace
    response.trace = {
      router: {
        route: routeResult.route,
        method: routeResult.method,
        reasoning: routeResult.reasoning,
      },
      guardrails: log.guardrails_triggered,
      tools_used: log.tools_used,
      chunks_retrieved: log.chunks_retrieved,
      groundedness: response._grounded !== undefined
        ? { grounded: response._grounded, detail: response._groundedness_detail }
        : null,
    };

    // clean internal fields to avoid exposing implementation details in the final response
    delete response._grounded;
    delete response._groundedness_detail;

    // Step 10: Log the response and return
    log.confidence = response.confidence;
    log.response_time_ms = Date.now() - start;
    saveLog(log);

    res.json(response);
  } catch (err) {
    log.error = err.message;
    log.response_time_ms = Date.now() - start;
    saveLog(log);
    console.error(`[${requestId}] Error:`, err.message);
    res.status(500).json({ request_id: requestId, error: 'Internal server error' });
  }
});

// ---- route handlers ----

// Step 7: RAG Pipeline
async function handleRAG(query, requestId, log, conversationId = null) {
  const history = conversationId ? getMessages(conversationId) : [];
  const result = await answerFromDocs(query, history);

  log.chunks_retrieved = (result.chunks || []).map(c => ({
    source: c.source,
    score: parseFloat(c.score.toFixed(4)),
    preview: c.text.substring(0, 100),
  }));
  log.grounded = result.grounded;

  return {
    request_id: requestId,
    answer: result.answer,
    confidence: parseFloat(result.confidence.toFixed(4)),
    route: 'FACT_FROM_DOCS',
    sources: (result.chunks || []).map(c => ({
      source: c.source,
      relevance: parseFloat(c.score.toFixed(4)),
    })),
    _grounded: result.grounded,
    _groundedness_detail: result.groundedness_detail,
  };
}

async function handleToolCall(query, requestId, log, conversationId = null) {
  const descriptions = getToolDescriptions();

  // ask LLM which tool to use and what args to pass
  const selectionPrompt = `You have these tools available:
${JSON.stringify(descriptions, null, 2)}

Based on the user's query, pick the right tool and arguments.
If no tool fits, set tool to null.

User query: "${query}"

Respond with JSON: {"tool": "<name or null>", "arguments": {}, "reasoning": "<why>"}`;

  const raw = await chat(
    [{ role: 'user', content: selectionPrompt }],
    config.routerModel,
    { temperature: 0, maxTokens: 200, jsonMode: true }
  );

  let decision;
  try {
    decision = JSON.parse(raw);
  } catch {
    return {
      request_id: requestId,
      answer: "I couldn't figure out the right data source for that. Could you rephrase?",
      confidence: 0.3,
      route: 'STRUCTURED_DATA',
    };
  }

  if (!decision.tool) {
    return {
      request_id: requestId,
      answer: "I don't have a matching data source for that specific request.",
      confidence: 0.4,
      route: 'STRUCTURED_DATA',
    };
  }

  const toolResult = executeTool(decision.tool, decision.arguments || {});
  log.tools_used.push({
    name: decision.tool,
    args: decision.arguments,
    reasoning: decision.reasoning,
  });

  if (toolResult.error) {
    const detail = toolResult.details ? ' ' + toolResult.details.join('; ') : '';
    return {
      request_id: requestId,
      answer: `Couldn't fetch that data: ${toolResult.error}.${detail}`,
      confidence: 0.5,
      route: 'STRUCTURED_DATA',
      tool_used: decision.tool,
    };
  }

  // turn the raw data into a human-friendly answer (with conversation context)
  const history = conversationId ? getMessages(conversationId) : [];
  const formatMessages = [
    ...history,
    {
      role: 'user',
      content: `Format this data as a helpful response for a travel company customer. Be conversational and concise.\n\nTool: ${decision.tool}\nData: ${JSON.stringify(toolResult)}\nOriginal question: ${query}`,
    },
  ];
  // If no history, just use a single message
  const formatted = await chat(
    history.length > 0 ? formatMessages : [formatMessages[formatMessages.length - 1]],
    config.answerModel,
    { temperature: 0.3, maxTokens: 300 }
  );

  return {
    request_id: requestId,
    answer: formatted,
    confidence: 0.95,
    route: 'STRUCTURED_DATA',
    tool_used: decision.tool,
    raw_data: toolResult,
  };
}

async function handleSmallTalk(query, requestId, log, conversationId = null) {
  const systemMsg = {
    role: 'system',
    content: 'You are a friendly assistant for Wanderon, a travel company. Keep small talk responses warm but brief. If conversation steers toward travel, mention you can help with trip info, pricing, and policies. Do not repeat greetings if you have already greeted the user in this conversation.',
  };

  // Build messages: system prompt + full conversation history
  const history = conversationId ? getMessages(conversationId) : [{ role: 'user', content: query }];
  const messages = [systemMsg, ...history];

  const answer = await chat(messages, config.answerModel, { temperature: 0.7, maxTokens: 150 });

  return {
    request_id: requestId,
    answer,
    confidence: 0.9,
    route: 'SMALL_TALK',
  };
}

function handleRefusal(requestId, reasoning) {
  return {
    request_id: requestId,
    answer: "That's outside what I can help with. I'm here for Wanderon travel packages, trip details, pricing, and policies — ask me anything about those!",
    confidence: 1.0,
    route: 'OUT_OF_SCOPE',
  };
}

// ---- feedback endpoints ----

app.post('/feedback', (req, res) => {
  const { request_id, rating, comment } = req.body;

  if (!request_id || !rating) {
    return res.status(400).json({ error: 'request_id and rating are required' });
  }
  if (!['positive', 'negative'].includes(rating)) {
    return res.status(400).json({ error: 'rating must be "positive" or "negative"' });
  }

  const total = addFeedback(request_id, rating, comment);
  res.json({ success: true, total_feedback: total });
});

app.get('/feedback/stats', (req, res) => {
  res.json(getStats());
});

// ---- observability ----

app.get('/logs', (req, res) => {
  const count = parseInt(req.query.count || '20');
  res.json(getRecentLogs(count));
});

// ---- health ----

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- start ----

app.listen(config.port, () => {
  console.log(`Wanderon AI Assistant running on http://localhost:${config.port}`);
  console.log('Endpoints:');
  console.log('  POST /query        - ask the assistant');
  console.log('  POST /feedback     - submit feedback');
  console.log('  GET  /feedback/stats');
  console.log('  GET  /logs');
  console.log('  GET  /health');
});
