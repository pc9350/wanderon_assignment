const { chat } = require('./llm');
const config = require('./config');

/*
  Hybrid router: tries cheap regex rules first, falls back to LLM.
  This avoids burning tokens on obvious queries like "hi" or "what's the price".
*/

const SMALL_TALK_PATTERNS = [
  /^(hi|hello|hey|howdy|sup|yo)\b/i,
  /^(good\s+)?(morning|afternoon|evening|night)/i,
  /^how\s+are\s+you/i,
  /^what'?s?\s+up/i,
  /^(thanks?|thank\s+you|ty|bye|goodbye|see\s+ya)/i,
  /^(nice|cool|great|awesome)\b/i,
];

const OUT_OF_SCOPE_KEYWORDS = [
  /\b(stock\s*market|cryptocurrency|bitcoin|ethereum|invest(ment|ing)?)\b/i,
  /\b(medical\s+advice|diagnos(is|e)|prescription|symptom)\b/i,
  /\b(legal\s+advice|lawsuit|attorney|lawyer)\b/i,
  /\b(write\s+(me\s+)?(a\s*)?(code|program|script|essay|poem))\b/i,
  /\b(politics|election|vote\s+for)\b/i,
];

const STRUCTURED_DATA_PATTERNS = [
  /\b(price|pricing|cost|how\s+much)\b.*\b(plan|package|trip|tour)\b/i,
  /\b(plan|package|trip|tour)\b.*\b(price|pricing|cost|how\s+much)\b/i,
  /\b(policy|policies|cancellation|refund)\b.*\b(for|of|in|at)\s+\w+/i,
  /\b(lead|booking)\s*(status|id|number|#)\b/i,
  /\bstatus\s+(of|for)\s+(lead|booking|order)\b/i,
  /\bWDR-\d+/i,
  /\bget\s+(me\s+)?(the\s+)?(price|pricing|policy|status)\b/i,
];

function ruleBasedCheck(query) {
  const q = query.trim();

  for (const p of SMALL_TALK_PATTERNS) {
    if (p.test(q)) {
      return { route: 'SMALL_TALK', reasoning: 'Matched common greeting/small talk pattern', method: 'rule' };
    }
  }

  for (const p of OUT_OF_SCOPE_KEYWORDS) {
    if (p.test(q)) {
      return { route: 'OUT_OF_SCOPE', reasoning: 'Query topic falls outside travel domain', method: 'rule' };
    }
  }

  for (const p of STRUCTURED_DATA_PATTERNS) {
    if (p.test(q)) {
      return { route: 'STRUCTURED_DATA', reasoning: 'Query asks for specific structured data (pricing/policy/status)', method: 'rule' };
    }
  }

  return null;
}

const ROUTER_SYSTEM_PROMPT = `You are a query classifier for Wanderon, a travel and adventure company.
Classify the user query into exactly one route:

- FACT_FROM_DOCS: Questions about Wanderon trips, destinations, itineraries, travel tips, company info, or general travel knowledge answerable from documentation.
- STRUCTURED_DATA: Requests for specific data like pricing for a plan, trip policies for a destination, or booking/lead status. These come from an API or database.
- SMALL_TALK: Greetings, casual chat, thank-yous, non-substantive messages, or conversational follow-ups (e.g. referencing something said earlier).
- OUT_OF_SCOPE: Topics clearly unrelated to travel, tourism, or Wanderon services AND not part of an ongoing conversation.

Guidelines:
- Travel info questions without asking for a specific data point → FACT_FROM_DOCS
- Asking for a price, policy detail, or booking status → STRUCTURED_DATA
- When ambiguous between FACT_FROM_DOCS and STRUCTURED_DATA, lean FACT_FROM_DOCS
- If conversation history is provided and the query is a follow-up to that conversation, classify based on context — do NOT mark conversational follow-ups as OUT_OF_SCOPE

Return JSON only: {"route": "<ROUTE>", "reasoning": "<one line>"}`;

async function classifyQuery(query, conversationHistory = []) {
  // try rules first
  const ruleResult = ruleBasedCheck(query);
  if (ruleResult) return ruleResult;

  // build messages for LLM router
  const messages = [
    { role: 'system', content: ROUTER_SYSTEM_PROMPT },
  ];

  // If there's conversation history, include a summary so the router has context
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6); // last 3 exchanges max
    const summary = recentHistory.map(m => `${m.role}: ${m.content}`).join('\n');
    messages.push({
      role: 'user',
      content: `Conversation so far:\n${summary}\n\nClassify this new query: "${query}"`,
    });
  } else {
    messages.push({ role: 'user', content: query });
  }

  // fall back to LLM
  const response = await chat(
    messages,
    config.routerModel,
    { temperature: 0, maxTokens: 100, jsonMode: true }
  );

  try {
    const parsed = JSON.parse(response);
    const valid = ['FACT_FROM_DOCS', 'STRUCTURED_DATA', 'SMALL_TALK', 'OUT_OF_SCOPE'];
    if (!valid.includes(parsed.route)) {
      parsed.route = 'OUT_OF_SCOPE';
      parsed.reasoning = 'Router returned unknown route, defaulting to refusal';
    }
    parsed.method = 'llm';
    return parsed;
  } catch {
    return { route: 'OUT_OF_SCOPE', reasoning: 'Could not parse router output', method: 'llm_fallback' };
  }
}

module.exports = { classifyQuery };
