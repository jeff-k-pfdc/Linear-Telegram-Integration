const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const groups = require('./groups');
const users = require('./users');

const HELP_TEXT =
  '<b>Linear Notification Bot</b>\n' +
  'Sends Linear activity directly into Telegram groups. Each group links to a Linear team and can filter notifications to specific assignees.\n\n' +
  '<b>How to set up</b>\n' +
  '1. Add this bot to a group\n' +
  '2. /register &lt;team&gt; — link to a Linear team\n' +
  '3. /add &lt;name&gt; — filter to specific assignees (optional)\n' +
  '4. /settings — choose which event types to receive\n\n' +
  '<b>Commands</b>\n' +
  '/register &lt;team&gt; — link this group to a Linear team\n' +
  '/unregister — stop notifications in this group\n' +
  '/add &lt;name&gt; — add a member to the filter\n' +
  '/remove &lt;name&gt; — remove a member from the filter\n' +
  '/adduser &lt;Name&gt; [@handle] — add a new user globally (all groups)\n' +
  '/removeuser &lt;Name&gt; — remove a user globally\n' +
  '/users — list all users\n' +
  '/settings — open settings menu\n' +
  '/info — show team, members, and active notifications\n' +
  '/help — show this message\n\n' +
  '<i>No member filter set = all assignees trigger notifications</i>';

function createBot(token) {
  const bot = new Telegraf(token);

  // Show help when bot is added to a group
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

  bot.command('status', (ctx) => {
    ctx.reply('Bot is running. Use /info for full details.');
  });

  bot.command('info', (ctx) => {
    const chatId = ctx.chat.id;
    const team = groups.getTeamsForChat(chatId).join(', ') || null;
    const members = groups.getMembers(chatId);
    const notifSettings = settings.load();

    const enabledNotifs = Object.entries(settings.LABELS)
      .filter(([key]) => notifSettings[key])
      .map(([, label]) => `  • ${label}`)
      .join('\n');
    const disabledNotifs = Object.entries(settings.LABELS)
      .filter(([key]) => !notifSettings[key])
      .map(([, label]) => `  • ${label}`)
      .join('\n');

    const lines = [
      '<b>Group Info</b>',
      `Chat ID: ${chatId}`,
      `Team: ${team || 'not registered'}`,
      `Member filter: ${members.length ? members.join(', ') : 'none (all assignees)'}`,
      '',
      '<b>Active Notifications</b>',
      enabledNotifs || '  none',
      '',
      '<b>Inactive Notifications</b>',
      disabledNotifs || '  none',
    ];

    ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

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

  bot.command('add', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /add <name>\nExample: /add Jeff');
    try {
      groups.addMember(ctx.chat.id, name);
      const members = groups.getMembers(ctx.chat.id);
      ctx.reply(`Added: ${name}\nCurrent: ${members.join(', ')}`);
    } catch (err) {
      ctx.reply(err.message);
    }
  });

  bot.command('remove', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply('Usage: /remove <name>\nExample: /remove Jeff');
    groups.removeMember(ctx.chat.id, name);
    const members = groups.getMembers(ctx.chat.id);
    ctx.reply(`Removed: ${name}\nCurrent: ${members.length ? members.join(', ') : 'none (all notifications enabled)'}`);
  });

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
    if (!entries.length) return ctx.reply('No users in the user map yet. Use /adduser to add one.');
    const lines = entries.map(([name, handle]) => `  • <b>${name}</b>${handle ? ` → ${handle}` : ''}`).join('\n');
    ctx.reply(`<b>Users (${entries.length})</b>\n${lines}`, { parse_mode: 'HTML' });
  });

  // /settings — main menu
  bot.command('settings', (ctx) => {
    ctx.reply('<b>Settings</b>', {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  // Main menu (back button target)
  bot.action('settings:main', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('<b>Settings</b>', {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  // Notifications section
  bot.action('settings:notifications', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('<b>Notifications</b>\nTap to toggle:', {
      parse_mode: 'HTML',
      ...buildNotificationsKeyboard(),
    });
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
    await ctx.editMessageText('<b>Member Filter</b>\nTap to toggle. No one selected = everyone:', {
      parse_mode: 'HTML',
      ...buildMembersKeyboard(ctx.chat.id),
    });
  });

  // Help section
  bot.action('settings:help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(HELP_TEXT, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Back', 'settings:main')]]),
    });
  });

  // Toggle notification type
  bot.action(/^toggle:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    try {
      const newVal = settings.toggle(key);
      const label = settings.LABELS[key] || key;
      await ctx.answerCbQuery(`${label}: ${newVal ? 'ON' : 'OFF'}`);
      await ctx.editMessageReplyMarkup(buildNotificationsKeyboard().reply_markup);
    } catch {
      await ctx.answerCbQuery('Error toggling setting.');
    }
  });

  // Toggle member filter
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

  return bot;
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Linked Teams', 'settings:teams')],
    [Markup.button.callback('Notifications', 'settings:notifications')],
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

function buildNotificationsKeyboard() {
  const current = settings.load();
  const buttons = Object.entries(settings.LABELS).map(([key, label]) => {
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
    buttons.push([Markup.button.callback('No users in user-map.json', 'noop')]);
  }

  buttons.push([Markup.button.callback('← Back', 'settings:main')]);
  return Markup.inlineKeyboard(buttons);
}

module.exports = { createBot };
