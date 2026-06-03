require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { createBot } = require('./bot');
const { format } = require('./formatter');
const settings = require('./settings');
const groups = require('./groups');
const { getMention } = require('./users');

const {
  TELEGRAM_BOT_TOKEN,
  LINEAR_WEBHOOK_SECRET,
  LINEAR_WEBHOOK_SECRETS,
  PORT = 3000,
} = process.env;

const webhookSecrets = LINEAR_WEBHOOK_SECRETS
  ? LINEAR_WEBHOOK_SECRETS.split(',').map(s => s.trim()).filter(Boolean)
  : LINEAR_WEBHOOK_SECRET ? [LINEAR_WEBHOOK_SECRET] : [];

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing required env var: TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const bot = createBot(TELEGRAM_BOT_TOKEN);
const app = express();

function verifySignature(rawBody, signature) {
  if (!webhookSecrets.length) return true; // skip if not configured
  return webhookSecrets.some(secret => {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

async function notify(chatId, text) {
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    console.error(`Telegram send error (chat ${chatId}):`, err.message);
  }
}

// groupList: array of { chatId, members[] } — members=[] means no filter (receive all)
async function dispatch(event, groupList, assigneeName) {
  if (!event || !groupList.length) return;

  if (Array.isArray(event)) {
    for (const e of event) await dispatch(e, groupList, assigneeName);
    return;
  }

  const key = event.key ?? null;
  const msg = event.msg ?? event;

  if (key && !settings.isEnabled(key)) return;

  for (const { chatId, members } of groupList) {
    const filtered = members.length > 0;
    if (filtered) {
      const hasAll = members.some(m => m.toLowerCase() === 'all');
      if (!hasAll) {
        if (!assigneeName) continue;
        if (!members.some(m => m.toLowerCase() === assigneeName.toLowerCase())) continue;
      }
    }
    await notify(chatId, msg);
  }
}

app.use(express.raw({ type: 'application/json' }));

app.post('/webhook/linear/:team', async (req, res) => {
  const sig = req.headers['linear-signature'];
  if (!verifySignature(req.body, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  res.sendStatus(200); // acknowledge immediately

  const { type, action, data, updatedFrom, actor } = payload;
  const teamName = req.params.team;
  console.log(`[Linear] ${type} ${action} (team: ${teamName}, actor: ${actor?.name || 'unknown'})`);

  const groupList = groups.getGroupsForTeam(teamName);
  if (!groupList.length) {
    console.log(`No groups registered for team "${teamName}" — skipping`);
    return;
  }

  const assigneeName = data?.assignee?.name || null;
  const event = format(type, action, data, updatedFrom, getMention, actor);
  await dispatch(event, groupList, assigneeName);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook base URL: POST http://localhost:${PORT}/webhook/linear/:team`);
  console.log('Example: /webhook/linear/Developers');
});

bot.launch();
console.log('Telegram bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
