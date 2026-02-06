const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data', 'logs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createRequestLog(requestId) {
  return {
    request_id: requestId,
    timestamp: new Date().toISOString(),
    query: null,
    route: null,
    route_method: null,
    route_reasoning: null,
    tools_used: [],
    chunks_retrieved: [],
    confidence: null,
    grounded: null,
    guardrails_triggered: [],
    response_time_ms: null,
    error: null,
  };
}

function saveLog(log) {
  ensureDir(LOG_DIR);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(LOG_DIR, `${date}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(log) + '\n');
}

function getRecentLogs(count) {
  count = count || 50;
  ensureDir(LOG_DIR);

  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  const logs = [];
  for (const file of files) {
    if (logs.length >= count) break;
    const lines = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (logs.length >= count) break;
      try { logs.push(JSON.parse(lines[i])); } catch {}
    }
  }
  return logs;
}

module.exports = { createRequestLog, saveLog, getRecentLogs };
