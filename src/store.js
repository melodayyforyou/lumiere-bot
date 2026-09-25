const fs = require('fs');
const path = require('path');

// Tiny JSON-file store. Lives on the VPS disk in data/ so scheduled events
// survive bot restarts. Writes go to a temp file first, so a crash mid-write
// can't corrupt the real file.
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });

function load(name, fallback) {
  const file = path.join(dir, `${name}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function save(name, data) {
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = { load, save };
