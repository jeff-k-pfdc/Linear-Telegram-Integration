const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { LABELS } = require('./settings');
const groups = require('./groups');
const users = require('./users');

const HELP_TEXT =
  '<b>Linear Notification Bot</b>\n' +
  'Sends Linear activity into Telegram groups. Each group has its own settings, teams, and member filters.\n\n' +
  '<b>Setup</b>\n' +
  '1. Add bot to a group\n' +
  '2. /register &lt;team&gt; — link to a Linear team\n' +
  '3. /settings — configure notifications for this group\n\n' +
  '<b>Commands</b>\n' +
  '/register &lt;team&gt; — link this group to a Linear team\n' +
  '/unregister [team] — unlink a team (or all)\n' +
  '/add &lt;name&gt; — add a member to this group\'s filter\n' +
  '/remove &lt;name&gt; — remove a member from this group\'s filter\n' +
  '/addstatus &lt;Status Name&gt; — pre-add a status to filter\n' +
  '/removestatus &lt;Status Name&gt; — remove a status from filter\n' +
  '/adduser &lt;Name&gt; [@handle] — add a user (name can have spaces)\n' +
  '/edituser &lt;Name&gt; @handle — update handle\n' +
  '/edituser &lt;Old&gt; -&gt; &lt;New&gt; [@handle] — rename (use -&gt; as separator)\n' +
  '/removeuser &lt;Name&gt; — remove a user globally\n' +
  '/users — list all users\n' +
  '/settings — open this group\'s settings\n' +
  '/info — show this group\'s config\n' +
  '/help — show this message\n\n' +
  '<i>All settings are per-group. No member filter = notify for everyone.</i>';

function createBot(token) {
  const bot = new Telegraf(token);

  bot.on('my_chat_member', async (ctx) => {
    const { new_chat_member, old_chat_member } = ctx.myChatMember;
    const wasAdded = old_chat_member.status === 'left' || old_chat_member.status === 'kicked';
    const isNowMember = new_chat_member.status === 'member' || new_chat_member.status === 'administrator';
    if (wasAdded && isNowMember) {
      await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
    }
  });

  bot.command('start', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }));
  bot.command('help', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }));
  bot.command('status', (ctx) => ctx.reply('Bot is running. Use /info for full details.'));

  bot.command('info', (ctx) => {
    const chatId = ctx.chat.id;
    const teams = groups.getTeamsForChat(chatId).join(', ') || 'not registered';
    const members = groups.getMembers(chatId);
    const currentSettings = groups.getSettings(chatId);
    const statuses = groups.getStatuses(chatId);

    const enabledNotifs = Object.entries(LABELS)
      .filter(([key]) => currentSettings[key])
      .map(([, label]) => `  • ${label}`)
      .join('\n');
    const disabledNotifs = Object.entries(LABELS)
      .filter(([key]) => !currentSettings[key])
      .map(([, label]) => `  • ${label}`)
      .join('\n');

    const statusLines = Object.entries(statuses).length
      ? Object.entries(statuses).map(([name, on]) => `  ${on ? '✅' : '❌'} ${name}`).join('\n')
      : '  none configured (all statuses notify)';

    const lines = [
      '<b>Group Info</b>',
      `Chat ID: ${chatId}`,
      `Teams: ${teams}`,
      `Member filter: ${members.length ? members.join(', ') : 'none (all)'}`,
      '',
      '<b>Active Notifications</b>',
      enabledNotifs || '  none',
      '',
      '<b>Inactive Notifications</b>',
      disabledNotifs || '  none',
      '',
      '<b>Status Filters</b>',
      statusLines,
    ];

    ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // ─── Teams ─────────────────────────────────────────────────────────────────

  bot.command('register', (ctx) => {
    const teamName = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!teamName) return ctx.reply('Usage: /register <team name>\nExample: /register Dev');
    groups.register(ctx.chat.id, teamName);
    const teams = groups.getTeamsForChat(ctx.chat.id);
    ctx.reply(`Linked to: ${teams.join(', ')}`);
  });

  bot.command('unregister', (ctx) => {
    const teamName = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (teamName) {
      groups.unregisterTeam(ctx.chat.id, teamName);
      const teams = groups.getTeamsForChat(ctx.chat.id);
      ctx.reply(teams.length ? `Removed ${teamName}. Still linked to: ${teams.join(', ')}` : 'Unregistered from all teams.');
    } else {
      groups.unregisterAll(ctx.chat.id);
      ctx.reply('This group has been unregistered from all teams.');
    }
  });

  // ─── Member filter ─────────────────────────────────────────────────────────

  bot.command('add', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /add <name>\nExample: /add Jeff');
    try {
      groups.addMember(ctx.chat.id, name);
      const members = groups.getMembers(ctx.chat.id);
      ctx.reply(`Added: ${name}\nCurrent filter: ${members.join(', ')}`);
    } catch (err) {
      ctx.reply(err.message);
    }
  });

  bot.command('remove', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /remove <name>\nExample: /remove Jeff');
    groups.removeMember(ctx.chat.id, name);
    const members = groups.getMembers(ctx.chat.id);
    ctx.reply(`Removed: ${name}\nCurrent filter: ${members.length ? members.join(', ') : 'none (all notifications enabled)'}`);
  });

  // ─── Status management ─────────────────────────────────────────────────────

  bot.command('addstatus', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /addstatus <Status Name>\nExample: /addstatus In Progress');
    try {
      groups.addStatus(ctx.chat.id, name);
      ctx.reply(`Status added: <b>${name}</b> (enabled)\nToggle it in /settings → Status Filters.`, { parse_mode: 'HTML' });
    } catch (err) {
      ctx.reply(err.message);
    }
  });

  bot.command('removestatus', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /removestatus <Status Name>\nExample: /removestatus In Progress');
    try {
      groups.removeStatus(ctx.chat.id, name);
      ctx.reply(`Status removed: <b>${name}</b>`, { parse_mode: 'HTML' });
    } catch (err) {
      ctx.reply(err.message);
    }
  });

  // ─── Global user map ───────────────────────────────────────────────────────

  bot.command('adduser', (ctx) => {
    const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!text) return ctx.reply('Usage: /adduser <Linear Name> [@handle]\nExample: /adduser Jeff Kim @jeff_pf');
    const { name, handle } = splitNameAndHandle(text);
    if (!name) return ctx.reply('Usage: /adduser <Linear Name> [@handle]\nExample: /adduser Jeff Kim @jeff_pf');
    users.addUser(name, handle);
    ctx.reply(`Added: <b>${name}</b>${handle ? ` → ${handle}` : ' (no Telegram handle)'}\nThey can now be used in member filters across all groups.`, { parse_mode: 'HTML' });
  });

  bot.command('removeuser', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /removeuser <Linear Name>\nExample: /removeuser Alex');
    users.removeUser(name);
    ctx.reply(`Removed: <b>${name}</b>`, { parse_mode: 'HTML' });
  });

  bot.command('edituser', (ctx) => {
    const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const USAGE =
      'Usage:\n' +
      '  /edituser <Name> @new_handle — update handle\n' +
      '  /edituser <Old Name> -> <New Name> — rename\n' +
      '  /edituser <Old Name> -> <New Name> @new_handle — rename + update handle\n\n' +
      'Examples:\n' +
      '  /edituser Jeff Kim @jeff_new\n' +
      '  /edituser Jeff Kim -> Jeffrey Kim\n' +
      '  /edituser Jeff Kim -> Jeffrey Kim @jeffrey_pf';

    if (!text) return ctx.reply(USAGE);

    let oldName, newName, newHandle;

    if (text.includes(' -> ')) {
      // Rename (with optional new handle)
      const [oldPart, newPart] = text.split(' -> ');
      oldName = oldPart.trim();
      const { name, handle } = splitNameAndHandle(newPart.trim());
      newName = name || oldName;
      newHandle = handle; // undefined if not provided → keeps existing handle
    } else {
      // Handle-only update — everything before last @token is the name
      const { name, handle } = splitNameAndHandle(text);
      if (!handle) return ctx.reply('To update a handle use @, to rename use ->.\n\n' + USAGE);
      oldName = name;
      newName = name;
      newHandle = handle;
    }

    if (!oldName) return ctx.reply(USAGE);

    try {
      users.editUser(oldName, newName, newHandle);
      const map = users.listUsers();
      const savedHandle = map[newName];
      ctx.reply(
        `Updated: <b>${oldName}</b> → <b>${newName}</b>${savedHandle ? ` (${savedHandle})` : ''}`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      ctx.reply(err.message);
    }
  });

  bot.command('users', (ctx) => {
    const map = users.listUsers();
    const entries = Object.entries(map);
    if (!entries.length) return ctx.reply('No users yet. Use /adduser to add one.');
    const lines = entries.map(([name, handle]) => `  • <b>${name}</b>${handle ? ` → ${handle}` : ''}`).join('\n');
    ctx.reply(`<b>Users (${entries.length})</b>\n${lines}`, { parse_mode: 'HTML' });
  });

  bot.command('debugusers', (ctx) => {
    const userMapFile = path.join(__dirname, '..', 'user-map.json');
    let raw = '';
    let parsed = null;
    let err = null;
    try {
      raw = fs.readFileSync(userMapFile, 'utf8');
      parsed = JSON.parse(raw);
    } catch (e) {
      err = e.message;
    }
    const activeMembers = groups.getMembers(ctx.chat.id);
    ctx.reply(
      `<b>Debug: user-map.json</b>\n` +
      `Path: <code>${userMapFile}</code>\n` +
      `Read error: ${err || 'none'}\n` +
      `Keys found: ${parsed ? Object.keys(parsed).join(', ') || '(empty)' : 'n/a'}\n\n` +
      `<b>Active members in this chat:</b>\n${activeMembers.join(', ') || 'none'}`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── Settings menu ─────────────────────────────────────────────────────────

  const SETTINGS_MAIN_TEXT =
    '<b>⚙️ Settings</b>\n' +
    '<i>All settings below are unique to this group chat — changing them here does not affect any other group.</i>\n\n' +
    '• <b>Linked Teams</b> — choose which Linear team(s) send notifications here\n' +
    '• <b>Notifications</b> — turn specific event types on or off (e.g. comments, status changes)\n' +
    '• <b>Status Filters</b> — when a status change fires, pick exactly which statuses notify here\n' +
    '• <b>Member Filter</b> — only notify when a specific person is involved (assignee, actor, or subscriber)';

  bot.command('settings', (ctx) => {
    ctx.reply(SETTINGS_MAIN_TEXT, {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  bot.action('settings:main', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(SETTINGS_MAIN_TEXT, {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  // Notifications section
  bot.action('settings:notifications', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '<b>🔔 Notifications</b>\n' +
      '<i>Tap any item to toggle it on (✅) or off (❌) for this group.</i>\n\n' +
      '<b>Issue Created</b> — fires when a new issue is opened in the linked team\n' +
      '<b>Issue Updated (other changes)</b> — fires when something not covered by a specific toggle changes (e.g. description, labels, due date)\n' +
      '<b>Issue Deleted</b> — fires when an issue is permanently deleted\n' +
      '<b>Status Changed (master toggle)</b> — fires when an issue moves between statuses. Turn this off to silence all status change notifications regardless of Status Filters\n' +
      '<b>Issue Assigned</b> — fires when an issue is assigned or reassigned to someone\n' +
      '<b>Priority Changed</b> — fires when an issue\'s priority level is updated\n' +
      '<b>Title Changed</b> — fires when an issue\'s title is edited\n' +
      '<b>Comment Added</b> — fires when anyone posts a new comment on an issue\n' +
      '<b>Comment Edited</b> — fires when an existing comment is modified\n' +
      '<b>Comment Deleted</b> — fires when a comment is removed\n' +
      '<b>Project Created/Updated</b> — fires on project-level changes\n' +
      '<b>Cycle Started/Completed</b> — fires when a sprint cycle begins or ends',
      { parse_mode: 'HTML', ...buildNotificationsKeyboard(ctx.chat.id) }
    );
  });

  bot.action(/^toggle:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      const newVal = groups.toggleSetting(chatId, key);
      const label = LABELS[key] || key;
      await ctx.answerCbQuery(`${label}: ${newVal ? 'ON ✅' : 'OFF ❌'}`);
      await ctx.editMessageReplyMarkup(buildNotificationsKeyboard(chatId).reply_markup);
    } catch {
      await ctx.answerCbQuery('Error toggling setting.');
    }
  });

  // Linked teams section
  bot.action('settings:teams', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '<b>🏷 Linked Teams</b>\n' +
      '<i>This group only receives notifications from the teams listed here.</i>\n\n' +
      'Tap a team to <b>unlink</b> it and stop receiving its notifications.\n\n' +
      'To add a new team:\n' +
      '<code>/register &lt;team name&gt;</code>\n' +
      'Example: <code>/register Developers</code>\n\n' +
      'The team name must match exactly what appears in Linear (case-insensitive).',
      { parse_mode: 'HTML', ...buildTeamsKeyboard(ctx.chat.id) }
    );
  });

  bot.action(/^removeteam:(.+)$/, async (ctx) => {
    const teamName = ctx.match[1];
    groups.unregisterTeam(ctx.chat.id, teamName);
    await ctx.answerCbQuery(`Unlinked: ${teamName}`);
    await ctx.editMessageReplyMarkup(buildTeamsKeyboard(ctx.chat.id).reply_markup);
  });

  // Member filter section
  bot.action('settings:members', async (ctx) => {
    await ctx.answerCbQuery();
    const activeMembers = groups.getMembers(ctx.chat.id);
    const filterStatus = activeMembers.length
      ? `<b>Active filter:</b> ${activeMembers.join(', ')}`
      : '<b>No filter set</b> — all events pass through regardless of who is involved';
    await ctx.editMessageText(
      '<b>👤 Member Filter</b>\n' +
      '<i>Limit notifications to events where a specific person is involved.</i>\n\n' +
      'A notification is sent when a filtered member is the <b>assignee</b>, the <b>person who made the change</b>, or a <b>subscriber</b> on the issue.\n\n' +
      'Tap a name to toggle them on (✅) or off (❌).\n' +
      'If nobody is selected, <b>all events are delivered</b>.\n\n' +
      'To add someone who isn\'t listed:\n' +
      '<code>/adduser &lt;Linear Name&gt; [@telegram]</code>\n' +
      'Example: <code>/adduser Jeff Kim @jeff_pf</code>\n\n' +
      filterStatus,
      { parse_mode: 'HTML', ...buildMembersKeyboard(ctx.chat.id) }
    );
  });

  bot.action(/^togglemember:(.+)$/, async (ctx) => {
    const name = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      const members = groups.getMembers(chatId);
      const isOn = members.some(m => m.toLowerCase() === name.toLowerCase());
      if (isOn) {
        groups.removeMember(chatId, name);
        await ctx.answerCbQuery(`${name}: removed from filter`);
      } else {
        groups.addMember(chatId, name);
        await ctx.answerCbQuery(`${name}: added to filter`);
      }
      await ctx.editMessageReplyMarkup(buildMembersKeyboard(chatId).reply_markup);
    } catch (err) {
      await ctx.answerCbQuery(err.message || 'Error updating member filter.');
    }
  });

  // Status filters section
  bot.action('settings:statuses', async (ctx) => {
    await ctx.answerCbQuery();
    const statuses = groups.getStatuses(ctx.chat.id);
    const count = Object.keys(statuses).length;
    const statusSummary = count
      ? `<b>${count} status${count === 1 ? '' : 'es'} configured</b>`
      : '<b>No statuses configured yet</b> — all status changes will notify until you add one';
    await ctx.editMessageText(
      '<b>🔀 Status Filters</b>\n' +
      '<i>Control which Linear statuses trigger a notification in this group.</i>\n\n' +
      'This works <b>on top of</b> the "Status Changed" master toggle in Notifications — that must be ON for any status notifications to fire.\n\n' +
      '✅ = this status will notify  |  ❌ = this status is silenced  |  🗑 = remove from list\n\n' +
      'New statuses are <b>automatically added</b> (enabled) the first time an issue moves to that status. You can also pre-add them:\n' +
      '<code>/addstatus &lt;Status Name&gt;</code>\n' +
      'Example: <code>/addstatus In Progress</code>\n\n' +
      statusSummary,
      { parse_mode: 'HTML', ...buildStatusesKeyboard(ctx.chat.id) }
    );
  });

  bot.action(/^togglestatus:(.+)$/, async (ctx) => {
    const statusName = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      const newVal = groups.toggleStatus(chatId, statusName);
      await ctx.answerCbQuery(`${statusName}: ${newVal ? 'ON ✅' : 'OFF ❌'}`);
      await ctx.editMessageReplyMarkup(buildStatusesKeyboard(chatId).reply_markup);
    } catch (err) {
      await ctx.answerCbQuery(err.message || 'Error toggling status.');
    }
  });

  bot.action(/^deletestatus:(.+)$/, async (ctx) => {
    const statusName = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      groups.removeStatus(chatId, statusName);
      await ctx.answerCbQuery(`Removed: ${statusName}`);
      await ctx.editMessageReplyMarkup(buildStatusesKeyboard(chatId).reply_markup);
    } catch (err) {
      await ctx.answerCbQuery(err.message || 'Error removing status.');
    }
  });

  // Help section
  bot.action('settings:help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(HELP_TEXT, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Back', 'settings:main')]]),
    });
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery());

  return bot;
}

// ─── Keyboard builders ────────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🏷 Linked Teams — which Linear teams notify here', 'settings:teams')],
    [Markup.button.callback('🔔 Notifications — event types on/off', 'settings:notifications')],
    [Markup.button.callback('🔀 Status Filters — per-status notify control', 'settings:statuses')],
    [Markup.button.callback('👤 Member Filter — filter by person', 'settings:members')],
    [Markup.button.callback('❓ Help', 'settings:help')],
  ]);
}

function buildTeamsKeyboard(chatId) {
  const teams = groups.getTeamsForChat(chatId);
  const buttons = teams.length
    ? teams.map(t => [Markup.button.callback(`✅ ${t} — tap to unlink`, `removeteam:${t}`)])
    : [[Markup.button.callback('No teams linked — use /register <team>', 'noop')]];
  buttons.push([Markup.button.callback('← Back', 'settings:main')]);
  return Markup.inlineKeyboard(buttons);
}

function buildNotificationsKeyboard(chatId) {
  const current = groups.getSettings(chatId);
  const buttons = Object.entries(LABELS).map(([key, label]) => {
    const on = current[key];
    return [Markup.button.callback(`${on ? '✅' : '❌'} ${label}`, `toggle:${key}`)];
  });
  buttons.push([Markup.button.callback('← Back', 'settings:main')]);
  return Markup.inlineKeyboard(buttons);
}

function buildMembersKeyboard(chatId) {
  const userMapFile = path.join(__dirname, '..', 'user-map.json');
  let globalUsers = [];
  try {
    globalUsers = Object.keys(JSON.parse(fs.readFileSync(userMapFile, 'utf8')));
  } catch {}

  const activeMembers = groups.getMembers(chatId);

  // Show everyone: global user-map + anyone already in this group's filter (added via /add)
  const allNames = [...new Set([...globalUsers, ...activeMembers])].sort();

  const buttons = allNames.map(name => {
    const on = activeMembers.some(m => m.toLowerCase() === name.toLowerCase());
    return [Markup.button.callback(`${on ? '✅' : '❌'} ${name}`, `togglemember:${name}`)];
  });

  if (!buttons.length) {
    buttons.push([Markup.button.callback('No users — use /adduser to add one', 'noop')]);
  }

  buttons.push([Markup.button.callback('← Back', 'settings:main')]);
  return Markup.inlineKeyboard(buttons);
}

function buildStatusesKeyboard(chatId) {
  const statuses = groups.getStatuses(chatId);
  const entries = Object.entries(statuses);

  const buttons = entries.map(([name, on]) => [
    Markup.button.callback(`${on ? '✅' : '❌'} ${name}`, `togglestatus:${name}`),
    Markup.button.callback('🗑️', `deletestatus:${name}`),
  ]);

  if (!buttons.length) {
    buttons.push([Markup.button.callback('No statuses yet — they appear automatically when events arrive', 'noop')]);
  }

  buttons.push([Markup.button.callback('← Back', 'settings:main')]);
  return Markup.inlineKeyboard(buttons);
}

// Splits "Jeff Kim @jeff_pf" → { name: "Jeff Kim", handle: "@jeff_pf" }
// If no @handle token at the end, handle is null
function splitNameAndHandle(text) {
  const tokens = text.trim().split(' ');
  const last = tokens[tokens.length - 1];
  if (last.startsWith('@')) {
    const name = tokens.slice(0, -1).join(' ').trim();
    return { name, handle: last };
  }
  return { name: text.trim(), handle: null };
}

module.exports = { createBot };
