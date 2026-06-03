// Formats Linear webhook payloads into Telegram-friendly messages (HTML mode)

function esc(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function priorityLabel(p) {
  return ['No Priority', 'Urgent', 'High', 'Medium', 'Low'][p] ?? 'Unknown';
}

function issueLink(data) {
  const id = esc(data.identifier || data.id?.slice(0, 8));
  const title = esc(data.title || 'Untitled');
  const url = data.url;
  return url ? `<a href="${url}">${id}: ${title}</a>` : `<b>${id}: ${title}</b>`;
}

// Convert https Linear URL to linear:// deep link for inline buttons
function appUrl(url) {
  return url ? url.replace('https://', 'linear://') : null;
}

function event(key, msg, url) {
  return { key, msg, url: appUrl(url) };
}

function actorLine(actor, getMention) {
  if (!actor?.name) return '';
  const mention = getMention(actor.name);
  return mention
    ? `\nBy: ${esc(actor.name)} (${mention})`
    : `\nBy: ${esc(actor.name)}`;
}

function ping(name, getMention) {
  const mention = name ? getMention(name) : null;
  return mention ? `${mention}\n` : '';
}

function assigneeLine(name) {
  return name ? `\nAssignee: ${esc(name)}` : '';
}

// getMention(linearName) => "@username" or null — injected from users.js
function format(type, action, data, updatedFrom, getMention = () => null, actor = null) {
  switch (type) {
    case 'Issue':   return formatIssue(action, data, updatedFrom, getMention, actor);
    case 'Comment': return formatComment(action, data, getMention, actor);
    case 'Project': return formatProject(action, data);
    case 'Cycle':   return formatCycle(action, data);
    default:        return null;
  }
}

function formatIssue(action, data, updatedFrom = {}, getMention = () => null, actor = null) {
  const link = issueLink(data);
  const by = actorLine(actor, getMention);
  const assigneeName = data.assignee?.name;
  const assignee = assigneeLine(assigneeName);
  const url = data.url;

  if (action === 'create') {
    const priority = data.priority != null ? `\nPriority: ${priorityLabel(data.priority)}` : '';
    const state = data.state?.name ? `\nStatus: ${esc(data.state.name)}` : '';
    const p = ping(assigneeName, getMention);
    return event(null, `${p}<b>New Issue</b>\n${link}${state}${priority}${assignee}${by}`, url);
  }

  if (action === 'remove') {
    return event(null, `<b>Issue Deleted</b>\n${link}${by}`, url);
  }

  if (action === 'update') {
    const events = [];

    if (updatedFrom.stateId !== undefined) {
      const from = esc(updatedFrom.stateName || 'previous');
      const to = esc(data.state?.name || 'new status');
      const p = ping(assigneeName, getMention);
      events.push(event('issue_status_changed', `${p}<b>Status Changed</b>\n${link}\n${from} → ${to}${by}`, url));
    }

    if (updatedFrom.assigneeId !== undefined) {
      const name = data.assignee?.name;
      const p = ping(name, getMention);
      const assigneeStr = name ? esc(name) : 'Unassigned';
      events.push(event('issue_assigned', `${p}<b>Issue Assigned</b>\n${link}\nAssignee: ${assigneeStr}${by}`, url));
    }

    if (updatedFrom.priority !== undefined) {
      const from = priorityLabel(updatedFrom.priority);
      const to = priorityLabel(data.priority);
      const p = ping(assigneeName, getMention);
      events.push(event('issue_priority_changed', `${p}<b>Priority Changed</b>\n${link}\n${from} → ${to}${by}`, url));
    }

    if (updatedFrom.title !== undefined) {
      const p = ping(assigneeName, getMention);
      events.push(event('issue_title_changed', `${p}<b>Title Changed</b>\n${link}\n${esc(updatedFrom.title)} → ${esc(data.title)}${by}`, url));
    }

    if (events.length === 0) {
      const p = ping(assigneeName, getMention);
      events.push(event('issue_updated', `${p}<b>Issue Updated</b>\n${link}${by}`, url));
    }

    return events;
  }

  return null;
}

function formatComment(action, data, getMention = () => null, actor = null) {
  const issueLink_ = data.issue ? issueLink(data.issue) : `<b>issue</b>`;
  const body = esc((data.body || '').slice(0, 200)) + ((data.body || '').length > 200 ? '…' : '');
  const by = actorLine(actor, getMention);
  const url = data.issue?.url;

  if (action === 'create') {
    return event('comment_created', `<b>Comment Added</b> on ${issueLink_}${by}\n<i>${body}</i>`, url);
  }
  if (action === 'update') {
    return event('comment_updated', `<b>Comment Edited</b> on ${issueLink_}${by}\n<i>${body}</i>`, url);
  }
  if (action === 'remove') {
    return event('comment_deleted', `<b>Comment Deleted</b> on ${issueLink_}${by}`, url);
  }
  return null;
}

function formatProject(action, data) {
  const name = esc(data.name || 'Untitled Project');
  const link = data.url ? `<a href="${data.url}">${name}</a>` : `<b>${name}</b>`;

  if (action === 'create') return event('project_created', `<b>Project Created</b>\n${link}`, data.url);
  if (action === 'update') return event('project_updated', `<b>Project Updated</b>\n${link}`, data.url);
  return null;
}

function formatCycle(action, data) {
  const name = esc(data.name || `Cycle ${data.number ?? ''}`);

  if (action === 'create') return event('cycle_started', `<b>Cycle Started</b>\n${name}`, null);
  if (action === 'update' && data.completedAt) return event('cycle_completed', `<b>Cycle Completed</b>\n${name}`, null);
  return null;
}

module.exports = { format };
