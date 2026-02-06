/*
  Ingestion script — reads .txt files from data/docs/, chunks them,
  generates embeddings via OpenAI, and saves everything to data/embeddings.json.

  Run with: npm run ingest
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { embedBatch } = require('../src/llm');

const DOCS_DIR = path.join(__dirname, '..', 'data', 'docs');
const OUTPUT = path.join(__dirname, '..', 'data', 'embeddings.json');

// split text into overlapping chunks so we don't lose context at boundaries
function chunkText(text, maxLen, overlap) {
  maxLen = maxLen || 500;
  overlap = overlap || 50;

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 30) chunks.push(chunk); // skip tiny scraps
    start += maxLen - overlap;
  }
  return chunks;
}

async function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    console.error('data/docs/ directory not found.');
    process.exit(1);
  }

  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.txt'));
  if (files.length === 0) {
    console.error('No .txt files found in data/docs/.');
    process.exit(1);
  }

  console.log(`Found ${files.length} document(s)`);

  const allChunks = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
    const chunks = chunkText(content);
    console.log(`  ${file} → ${chunks.length} chunks`);
    for (const chunk of chunks) {
      allChunks.push({ text: chunk, source: file });
    }
  }

  console.log(`\nTotal: ${allChunks.length} chunks`);
  console.log('Generating embeddings...\n');

  const batchSize = 20;
  const embeddings = [];

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const vectors = await embedBatch(batch.map(c => c.text));
    embeddings.push(...vectors);
    const done = Math.min(i + batchSize, allChunks.length);
    console.log(`  [${done}/${allChunks.length}] embedded`);
  }

  const store = {
    chunks: allChunks.map((c, i) => ({
      text: c.text,
      source: c.source,
      embedding: embeddings[i],
    })),
    metadata: {
      created_at: new Date().toISOString(),
      embedding_model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      total_chunks: allChunks.length,
      documents: files,
    },
  };

  const outDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(OUTPUT, JSON.stringify(store));
  console.log(`\nSaved to ${OUTPUT}`);
  console.log('Done. You can now run the server with: npm start');
}

main().catch(err => {
  console.error('Ingestion failed:', err.message);
  process.exit(1);
});
