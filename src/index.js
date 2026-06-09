require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { createBot } = require('./bot');
const { format } = require('./formatter');
const groups = require('./groups');
const { getMention } = require('./users');

const {
  TELEGRAM_BOT_TOKEN,
  LINEAR_WEBHOOK_SECRET,
  LINEAR_WEBHOOK_SECRETS,
  PUBLIC_URL,
  PORT = 3000,
} = process.env;

// settings.js is now constants-only; per-chat logic lives in groups.js

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

// Build the redirect URL that tries the Linear app then falls back to browser
function openUrl(linearUrl) {
  if (!linearUrl || !PUBLIC_URL) return linearUrl;
  return `${PUBLIC_URL}/open?url=${encodeURIComponent(linearUrl)}`;
}

async function notify(chatId, text) {
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    console.error(`Telegram send error (chat ${chatId}):`, err.message, '| code:', err.code, '| description:', err.response?.description, '| status:', err.response?.error_code);
  }
}

// groupList: array of { chatId, members[] } — members=[] means no filter (receive all)
// relevantNames: all names involved in the event (assignee, actor, subscribers)
async function dispatch(event, groupList, relevantNames) {
  if (!event || !groupList.length) return;

  if (Array.isArray(event)) {
    for (const e of event) await dispatch(e, groupList, relevantNames);
    return;
  }

  const key = event.key ?? null;
  const msg = event.msg ?? event;

  for (const { chatId, members } of groupList) {
    // Per-chat notification type toggle
    if (key && !groups.isEnabled(chatId, key)) {
      console.log(`[dispatch] chat ${chatId}: blocked — event type "${key}" is disabled`);
      continue;
    }

    // Per-chat status filter (only applies when master toggle issue_status_changed is on)
    if (key === 'issue_status_changed' && event.statusName) {
      if (!groups.isStatusEnabled(chatId, event.statusName)) {
        console.log(`[dispatch] chat ${chatId}: blocked — status "${event.statusName}" is disabled`);
        continue;
      }
    }

    // Member filter
    const filtered = members.length > 0;
    if (filtered) {
      const hasAll = members.some(m => m.toLowerCase() === 'all');
      if (!hasAll) {
        const lowerMembers = members.map(m => m.toLowerCase());
        const matched = relevantNames.some(name => name && lowerMembers.includes(name.toLowerCase()));
        if (!matched) {
          console.log(`[dispatch] chat ${chatId}: blocked — none of [${relevantNames.join(', ')}] in member filter [${members.join(', ')}]`);
          continue;
        }
      }
    }

    await notify(chatId, msg);
  }
}

app.use(express.raw({ type: 'application/json' }));

// Extract the team name from the Linear payload — works for issues, comments, and cycles
function teamFromPayload(type, data) {
  if (data?.team?.name) return data.team.name;
  if (data?.issue?.team?.name) return data.issue.team.name;
  return null;
}

async function handleLinear(req, res) {
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
  // Prefer the team name embedded in the payload; fall back to the URL segment
  const teamName = teamFromPayload(type, data) || req.params.team || null;
  console.log(`[Linear] ${type} ${action} (team: ${teamName}, actor: ${actor?.name || 'unknown'})`);

  if (!teamName) {
    console.log('Could not determine team from payload or URL — skipping');
    return;
  }

  const groupList = groups.getGroupsForTeam(teamName);
  if (!groupList.length) {
    console.log(`No groups registered for team "${teamName}" — skipping`);
    return;
  }

  const assigneeName = data?.assignee?.name || null;
  const actorName = actor?.name || null;
  const subscriberNames = (data?.subscribers || []).map(s => s.name).filter(Boolean);
  const relevantNames = [...new Set([assigneeName, actorName, ...subscriberNames].filter(Boolean))];

  // Auto-register any new status name so it appears in /settings for each chat
  if (type === 'Issue' && action === 'update' && data?.state?.name) {
    for (const { chatId } of groupList) groups.ensureStatus(chatId, data.state.name);
  }

  const event = format(type, action, data, updatedFrom, getMention, actor, u => u);
  await dispatch(event, groupList, relevantNames);
}

// Supports both /webhook/linear (one URL for all teams) and /webhook/linear/:team (legacy)
app.post('/webhook/linear/:team', handleLinear);
app.post('/webhook/linear', handleLinear);

// Deep link redirect — tries linear:// app first, falls back to https://
app.get('/open', (req, res) => {
  const target = req.query.url;
  if (!target || !target.startsWith('https://linear.app/')) {
    return res.status(400).send('Invalid URL');
  }
  const appLink = target.replace('https://', 'linear://');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Opening Linear...</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}p{color:#666;}</style>
</head>
<body>
  <p>Opening Linear...</p>
  <script>
    window.location = '${appLink}';
    setTimeout(function() { window.location = '${target}'; }, 2000);
  </script>
</body>
</html>`);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL (single for all teams): POST http://localhost:${PORT}/webhook/linear`);
  console.log(`Webhook URL (per-team, legacy):     POST http://localhost:${PORT}/webhook/linear/:team`);
});

bot.launch();
console.log('Telegram bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
