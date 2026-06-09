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

function addUser(linearName, telegramHandle) {
  const map = load();
  map[linearName] = telegramHandle || null;
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

function removeUser(linearName) {
  const map = load();
  delete map[linearName];
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

function listUsers() {
  return load();
}

module.exports = { getMention, addUser, removeUser, listUsers };
