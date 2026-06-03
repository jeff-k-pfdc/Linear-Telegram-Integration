const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'user-map.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

// Returns "@username" if found, null otherwise
function getMention(linearName) {
  if (!linearName) return null;
  const map = load();
  return map[linearName] || null;
}

module.exports = { getMention };
