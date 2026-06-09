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
  '/adduser &lt;Name&gt; [@handle] — add a user globally (all groups)\n' +
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
    const parts = ctx.message.text.split(' ').slice(1);
    const name = parts[0]?.trim();
    const handle = parts[1]?.trim() || null;
    if (!name) return ctx.reply('Usage: /adduser <Linear Name> [@handle]\nExample: /adduser Alex @alex_pf');
    users.addUser(name, handle);
    ctx.reply(`Added: <b>${name}</b>${handle ? ` → ${handle}` : ' (no Telegram handle)'}\nThey can now be used in member filters across all groups.`, { parse_mode: 'HTML' });
  });

  bot.command('removeuser', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /removeuser <Linear Name>\nExample: /removeuser Alex');
    users.removeUser(name);
    ctx.reply(`Removed: <b>${name}</b>`, { parse_mode: 'HTML' });
  });

  bot.command('users', (ctx) => {
    const map = users.listUsers();
    const entries = Object.entries(map);
    if (!entries.length) return ctx.reply('No users yet. Use /adduser to add one.');
    const lines = entries.map(([name, handle]) => `  • <b>${name}</b>${handle ? ` → ${handle}` : ''}`).join('\n');
    ctx.reply(`<b>Users (${entries.length})</b>\n${lines}`, { parse_mode: 'HTML' });
  });

  // ─── Settings menu ─────────────────────────────────────────────────────────

  bot.command('settings', (ctx) => {
    ctx.reply('<b>Settings</b>\nAll settings apply only to this group.', {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  bot.action('settings:main', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('<b>Settings</b>\nAll settings apply only to this group.', {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  // Notifications section
  bot.action('settings:notifications', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('<b>Notifications</b>\nTap to toggle for this group:', {
      parse_mode: 'HTML',
      ...buildNotificationsKeyboard(ctx.chat.id),
    });
  });

  bot.action(/^toggle:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      const newVal = groups.toggleSetting(chatId, key);
      const label = LABELS[key] || key;
      await ctx.answerCbQuery(`${label}: ${newVal ? 'ON' : 'OFF'}`);
      await ctx.editMessageReplyMarkup(buildNotificationsKeyboard(chatId).reply_markup);
    } catch {
      await ctx.answerCbQuery('Error toggling setting.');
    }
  });

  // Linked teams section
  bot.action('settings:teams', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('<b>Linked Teams</b>\nTap a team to unlink it. Use /register &lt;team&gt; to add.', {
      parse_mode: 'HTML',
      ...buildTeamsKeyboard(ctx.chat.id),
    });
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
    await ctx.editMessageText('<b>Member Filter</b>\nTap to toggle. No one selected = notify for everyone:', {
      parse_mode: 'HTML',
      ...buildMembersKeyboard(ctx.chat.id),
    });
  });

  bot.action(/^togglemember:(.+)$/, async (ctx) => {
    const name = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      const members = groups.getMembers(chatId);
      const isOn = members.some(m => m.toLowerCase() === name.toLowerCase());
      if (isOn) {
        groups.removeMember(chatId, name);
        await ctx.answerCbQuery(`${name}: removed`);
      } else {
        groups.addMember(chatId, name);
        await ctx.answerCbQuery(`${name}: added`);
      }
      await ctx.editMessageReplyMarkup(buildMembersKeyboard(chatId).reply_markup);
    } catch (err) {
      await ctx.answerCbQuery(err.message || 'Error updating member filter.');
    }
  });

  // Status filters section
  bot.action('settings:statuses', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '<b>Status Filters</b>\nToggle which statuses trigger notifications.\nNew statuses auto-appear when first seen.\nUse /addstatus to pre-add.',
      { parse_mode: 'HTML', ...buildStatusesKeyboard(ctx.chat.id) }
    );
  });

  bot.action(/^togglestatus:(.+)$/, async (ctx) => {
    const statusName = ctx.match[1];
    const chatId = ctx.chat.id;
    try {
      const newVal = groups.toggleStatus(chatId, statusName);
      await ctx.answerCbQuery(`${statusName}: ${newVal ? 'ON' : 'OFF'}`);
      await ctx.editMessageReplyMarkup(buildStatusesKeyboard(chatId).reply_markup);
    } catch (err) {
      await ctx.answerCbQuery(err.message || 'Error toggling status.');
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
    [Markup.button.callback('Linked Teams', 'settings:teams')],
    [Markup.button.callback('Notifications', 'settings:notifications')],
    [Markup.button.callback('Status Filters', 'settings:statuses')],
    [Markup.button.callback('Member Filter', 'settings:members')],
    [Markup.button.callback('Help', 'settings:help')],
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
  let allUsers = [];
  try {
    allUsers = Object.keys(JSON.parse(fs.readFileSync(userMapFile, 'utf8')));
  } catch {}

  const activeMembers = groups.getMembers(chatId);
  const buttons = allUsers.map(name => {
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
  ]);

  if (!buttons.length) {
    buttons.push([Markup.button.callback('No statuses yet — they appear automatically when events arrive', 'noop')]);
  }

  buttons.push([Markup.button.callback('← Back', 'settings:main')]);
  return Markup.inlineKeyboard(buttons);
}

module.exports = { createBot };
