const config = require('./config');

// --- Guardrail 1: Hard refusal rules ---
// catches prompt injection, manipulation attempts, and harmful queries
const REFUSAL_PATTERNS = [
  { pattern: /\b(ignore|disregard|forget)\s+(your|all|previous|the)\s+(instructions|rules|prompt)/i, reason: 'Prompt injection attempt' },
  { pattern: /\b(pretend|act\s+as\s+if|you\s+are\s+now|roleplay)\b/i, reason: 'Role manipulation attempt' },
  { pattern: /\b(system\s*prompt|reveal\s*(your|the)\s*(prompt|instructions))\b/i, reason: 'Prompt extraction attempt' },
  { pattern: /\b(hack|exploit|attack|ddos|phishing)\b/i, reason: 'Harmful intent detected' },
];

function checkRefusalRules(query) {
  for (const { pattern, reason } of REFUSAL_PATTERNS) {
    if (pattern.test(query)) {
      return { refused: true, reason };
    }
  }
  return { refused: false };
}

// --- Guardrail 2: Output schema validation ---
// makes sure every response has the fields we promise in our API contract

function validateOutput(response) {
  const errors = [];

  const required = ['answer', 'confidence', 'route'];
  for (const field of required) {
    if (!(field in response)) errors.push(`Missing field: ${field}`);
  }

  if (typeof response.answer !== 'string') {
    errors.push('answer must be a string');
  }
  if (typeof response.confidence === 'number') {
    if (response.confidence < 0 || response.confidence > 1) {
      errors.push('confidence must be between 0 and 1');
    }
  } else if (response.confidence !== undefined) {
    errors.push('confidence must be a number');
  }

  const validRoutes = ['FACT_FROM_DOCS', 'STRUCTURED_DATA', 'SMALL_TALK', 'OUT_OF_SCOPE'];
  if (response.route && !validRoutes.includes(response.route)) {
    errors.push(`Invalid route: ${response.route}`);
  }

  return { valid: errors.length === 0, errors };
}

// --- Guardrail 3: Input length / token budget ---

const MAX_INPUT_LENGTH = 2000;

function checkTokenBudget(query) {
  if (query.length > MAX_INPUT_LENGTH) {
    return {
      exceeded: true,
      reason: `Query too long (${query.length} chars, max ${MAX_INPUT_LENGTH})`,
    };
  }
  return { exceeded: false };
}

module.exports = {
  checkRefusalRules,
  validateOutput,
  checkTokenBudget,
};
