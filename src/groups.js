const fs = require('fs');
const path = require('path');
const { DEFAULTS } = require('./settings');

const FILE = path.join(__dirname, '..', 'groups.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// Normalize to { teams, members, settings, statuses }
function entry(val) {
  if (!val) return null;
  if (typeof val === 'string') return { teams: [val], members: [], settings: {}, statuses: {} };
  if (typeof val.team === 'string') return { teams: [val.team], members: val.members || [], settings: val.settings || {}, statuses: val.statuses || {} };
  return { teams: val.teams || [], members: val.members || [], settings: val.settings || {}, statuses: val.statuses || {} };
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function register(chatId, teamName) {
  const data = load();
  const e = entry(data[String(chatId)]) || { teams: [], members: [], settings: {}, statuses: {} };
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

function getTeamsForChat(chatId) {
  const e = entry(load()[String(chatId)]);
  return e?.teams || [];
}

// Returns groups registered for a given Linear team name, each with their data
function getGroupsForTeam(teamName) {
  if (!teamName) return [];
  const data = load();
  return Object.entries(data)
    .map(([chatId, val]) => ({ chatId, ...entry(val) }))
    .filter(g => g.teams.some(t => t.toLowerCase() === teamName.toLowerCase()));
}

// ─── Members ──────────────────────────────────────────────────────────────────

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

// ─── Per-chat notification settings ──────────────────────────────────────────

function getSettings(chatId) {
  const e = entry(load()[String(chatId)]);
  return { ...DEFAULTS, ...(e?.settings || {}) };
}

function isEnabled(chatId, key) {
  return getSettings(chatId)[key] === true;
}

function toggleSetting(chatId, key) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) throw new Error('Group not registered.');
  const current = { ...DEFAULTS, ...e.settings };
  e.settings[key] = !current[key];
  data[String(chatId)] = e;
  save(data);
  return e.settings[key];
}

// ─── Per-chat status filters ──────────────────────────────────────────────────

function getStatuses(chatId) {
  const e = entry(load()[String(chatId)]);
  return e?.statuses || {};
}

// Called automatically when a status change event arrives — registers unseen statuses as enabled
function ensureStatus(chatId, statusName) {
  if (!statusName) return;
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) return;
  if (!(statusName in e.statuses)) {
    e.statuses[statusName] = true;
    data[String(chatId)] = e;
    save(data);
  }
}

function addStatus(chatId, statusName) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) throw new Error('Group not registered.');
  if (!(statusName in e.statuses)) e.statuses[statusName] = true;
  data[String(chatId)] = e;
  save(data);
}

function removeStatus(chatId, statusName) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) throw new Error('Group not registered.');
  delete e.statuses[statusName];
  data[String(chatId)] = e;
  save(data);
}

function toggleStatus(chatId, statusName) {
  const data = load();
  const e = entry(data[String(chatId)]);
  if (!e) throw new Error('Group not registered.');
  e.statuses[statusName] = !e.statuses[statusName];
  data[String(chatId)] = e;
  save(data);
  return e.statuses[statusName];
}

// Unknown statuses default to enabled (until the user explicitly disables them)
function isStatusEnabled(chatId, statusName) {
  const statuses = getStatuses(chatId);
  if (!(statusName in statuses)) return true;
  return statuses[statusName] === true;
}

module.exports = {
  register, unregisterTeam, unregisterAll, getTeamsForChat, getGroupsForTeam,
  addMember, removeMember, getMembers,
  getSettings, isEnabled, toggleSetting,
  getStatuses, ensureStatus, addStatus, removeStatus, toggleStatus, isStatusEnabled,
};
