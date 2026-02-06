require('dotenv').config();

module.exports = {
  openaiKey: process.env.OPENAI_API_KEY,
  port: parseInt(process.env.PORT || '3000'),
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  routerModel: process.env.ROUTER_MODEL || 'gpt-4o-mini',
  answerModel: process.env.ANSWER_MODEL || 'gpt-4o-mini',
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.55'),
  maxChunks: parseInt(process.env.MAX_CHUNKS || '3'),
};
