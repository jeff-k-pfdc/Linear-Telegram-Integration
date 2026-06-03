const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'groups.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// Normalize to { teams: [], members: [] } — handles legacy string and single-team formats
function entry(val) {
  if (!val) return null;
  if (typeof val === 'string') return { teams: [val], members: [] };
  if (typeof val.team === 'string') return { teams: [val.team], members: val.members || [] };
  return { teams: val.teams || [], members: val.members || [] };
}

function register(chatId, teamName) {
  const data = load();
  const e = entry(data[String(chatId)]) || { teams: [], members: [] };
  const lower = teamName.toLowerCase();
  if (!e.teams.some(t => t.toLowerCase() === lower)) e.teams.push(teamName);
  data[String(chatId)] = e;
  save(data);
}

function unregisterTeam(chatId, teamName) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) return;
  const lower = teamName.toLowerCase();
  e.teams = e.teams.filter(t => t.toLowerCase() !== lower);
  if (e.teams.length === 0) {
    delete data[String(chatId)];
  } else {
    data[String(chatId)] = e;
  }
  save(data);
}

function unregisterAll(chatId) {
  const data = load();
  delete data[String(chatId)];
  save(data);
}

function addMember(chatId, name) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) throw new Error('Group not registered. Run /register first.');
  const lower = name.toLowerCase();
  if (!e.members.some(m => m.toLowerCase() === lower)) e.members.push(name);
  data[String(chatId)] = e;
  save(data);
}

function removeMember(chatId, name) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) throw new Error('Group not registered.');
  const lower = name.toLowerCase();
  e.members = e.members.filter(m => m.toLowerCase() !== lower);
  data[String(chatId)] = e;
  save(data);
}

function getMembers(chatId) {
  const e = entry(load()[String(chatId)]);
  return e?.members || [];
}

function getTeamsForChat(chatId) {
  const e = entry(load()[String(chatId)]);
  return e?.teams || [];
}

// Returns groups registered for a given Linear team name, each with their member filter
function getGroupsForTeam(teamName) {
  if (!teamName) return [];
  const data = load();
  return Object.entries(data)
    .map(([chatId, val]) => ({ chatId, ...entry(val) }))
    .filter(g => g.teams.some(t => t.toLowerCase() === teamName.toLowerCase()));
}

module.exports = { register, unregisterTeam, unregisterAll, addMember, removeMember, getMembers, getTeamsForChat, getGroupsForTeam };
