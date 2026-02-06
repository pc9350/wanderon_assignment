const fs = require('fs');
const path = require('path');
const { chat, embed } = require('./llm');
const config = require('./config');

const EMBEDDINGS_PATH = path.join(__dirname, '..', 'data', 'embeddings.json');

// lazy-loaded in-memory store
let store = null;

function loadStore() {
  if (store) return store;
  if (!fs.existsSync(EMBEDDINGS_PATH)) {
    throw new Error('Embeddings not found. Run `npm run ingest` first.');
  }
  store = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  return store;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function retrieve(query, topK) {
  topK = topK || config.maxChunks;
  const data = loadStore();
  const queryEmbedding = await embed(query);

  const scored = data.chunks.map(chunk => ({
    text: chunk.text,
    source: chunk.source,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// verify the generated answer is actually backed by the retrieved context
async function checkGroundedness(query, answer, chunks) {
  const context = chunks.map(c => c.text).join('\n---\n');

  const prompt = `Given a question, an answer, and the source context, determine if the answer is factually supported by the context.

Context:
${context}

Question: ${query}
Answer: ${answer}

Is the answer supported by the context? Respond with JSON:
{"grounded": true/false, "explanation": "<brief reason>"}`;

  const response = await chat(
    [{ role: 'user', content: prompt }],
    config.routerModel,
    { temperature: 0, maxTokens: 150, jsonMode: true }
  );

  try {
    return JSON.parse(response);
  } catch {
    return { grounded: false, explanation: 'Groundedness check parse failure' };
  }
}

async function answerFromDocs(query) {
  const chunks = await retrieve(query);

  // confidence guardrail — if nothing relevant came back, don't hallucinate
  if (chunks.length === 0 || chunks[0].score < config.confidenceThreshold) {
    return {
      answer: "I don't have enough relevant information to answer that accurately.",
      confidence: chunks[0]?.score || 0,
      chunks: chunks.map(c => ({ text: c.text, source: c.source, score: c.score })),
      grounded: false,
      groundedness_detail: 'Top chunk below confidence threshold, skipped generation',
    };
  }

  const context = chunks.map(c => c.text).join('\n---\n');

  const answer = await chat([
    {
      role: 'system',
      content: `You are a helpful travel assistant for Wanderon. Answer based ONLY on the provided context. If the context doesn't have enough info, say so honestly. Keep it concise.

Context:
${context}`,
    },
    { role: 'user', content: query },
  ]);

  // verify answer is actually grounded in the docs
  const groundedness = await checkGroundedness(query, answer, chunks);

  if (!groundedness.grounded) {
    return {
      answer: "I found some related info but couldn't verify a reliable answer. " + answer,
      confidence: chunks[0].score * 0.5,
      chunks: chunks.map(c => ({ text: c.text, source: c.source, score: c.score })),
      grounded: false,
      groundedness_detail: groundedness.explanation,
    };
  }

  return {
    answer,
    confidence: chunks[0].score,
    chunks: chunks.map(c => ({ text: c.text, source: c.source, score: c.score })),
    grounded: true,
    groundedness_detail: groundedness.explanation,
  };
}

module.exports = { retrieve, answerFromDocs, checkGroundedness };
