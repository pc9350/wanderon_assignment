const fs = require('fs');
const path = require('path');

const FEEDBACK_PATH = path.join(__dirname, '..', 'data', 'feedback.json');

function load() {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function save(list) {
  const dir = path.dirname(FEEDBACK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(list, null, 2));
}

function addFeedback(requestId, rating, comment) {
  const list = load();
  list.push({
    request_id: requestId,
    rating, // 'positive' or 'negative'
    comment: comment || null,
    timestamp: new Date().toISOString(),
  });
  save(list);
  return list.length;
}

function getStats() {
  const list = load();
  const positive = list.filter(f => f.rating === 'positive').length;
  const negative = list.filter(f => f.rating === 'negative').length;
  return {
    total: list.length,
    positive,
    negative,
    satisfaction_rate: list.length > 0
      ? (positive / list.length * 100).toFixed(1) + '%'
      : 'N/A',
  };
}

module.exports = { addFeedback, getStats, load };
