const OpenAI = require('openai');
const config = require('./config');

// lazy init — avoids crashing on import if .env isn't set up yet
let _client = null;
function getClient() {
  if (!_client) {
    if (!config.openaiKey) {
      throw new Error('OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
    _client = new OpenAI({ apiKey: config.openaiKey });
  }
  return _client;
}

async function chat(messages, model, options = {}) {
  model = model || config.answerModel;

  const response = await getClient().chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 512,
    ...(options.jsonMode && { response_format: { type: 'json_object' } }),
  });

  return response.choices[0].message.content;
}

async function embed(text) {
  const response = await getClient().embeddings.create({
    model: config.embeddingModel,
    input: text,
  });
  return response.data[0].embedding;
}

async function embedBatch(texts) {
  const response = await getClient().embeddings.create({
    model: config.embeddingModel,
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

module.exports = { chat, embed, embedBatch };
