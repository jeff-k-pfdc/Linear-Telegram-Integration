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
  const webUrl = data.url;
  // Use linear:// scheme to open in the app; falls back to browser if app not installed
  const appUrl = webUrl ? webUrl.replace('https://', 'linear://') : null;
  return appUrl ? `<a href="${appUrl}">${id}: ${title}</a>` : `<b>${id}: ${title}</b>`;
}

function teamLine() {
  return '';
}

// getMention(linearName) => "@username" or null — injected from users.js
function format(type, action, data, updatedFrom, getMention = () => null, actor = null) {
  switch (type) {
    case 'Issue':
      return formatIssue(action, data, updatedFrom, getMention, actor);
    case 'Comment':
      return formatComment(action, data, getMention, actor);
    case 'Project':
      return formatProject(action, data, actor);
    case 'Cycle':
      return formatCycle(action, data, actor);
    default:
      return null;
  }
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

function assigneeLine(name, getMention) {
  if (!name) return '';
  return `\nAssignee: ${esc(name)}`;
}

function formatIssue(action, data, updatedFrom = {}, getMention = () => null, actor = null) {
  const link = issueLink(data);
  const by = actorLine(actor, getMention);
  const assigneeName = data.assignee?.name;
  const assignee = assigneeLine(assigneeName, getMention);

  if (action === 'create') {
    const priority = data.priority != null ? `\nPriority: ${priorityLabel(data.priority)}` : '';
    const state = data.state?.name ? `\nStatus: ${esc(data.state.name)}` : '';
    const p = ping(assigneeName, getMention);
    return `${p}<b>New Issue</b>\n${link}${state}${priority}${assignee}${by}`;
  }

  if (action === 'remove') {
    return `<b>Issue Deleted</b>\n${link}${by}`;
  }

  if (action === 'update') {
    const events = [];

    if (updatedFrom.stateId !== undefined) {
      const from = esc(updatedFrom.stateName || 'previous');
      const to = esc(data.state?.name || 'new status');
      const p = ping(assigneeName, getMention);
      events.push({ key: 'issue_status_changed', msg: `${p}<b>Status Changed</b>\n${link}\n${from} → ${to}${by}` });
    }

    if (updatedFrom.assigneeId !== undefined) {
      const name = data.assignee?.name;
      const p = ping(name, getMention);
      const assigneeStr = name ? esc(name) : 'Unassigned';
      events.push({ key: 'issue_assigned', msg: `${p}<b>Issue Assigned</b>\n${link}\nAssignee: ${assigneeStr}${by}` });
    }

    if (updatedFrom.priority !== undefined) {
      const from = priorityLabel(updatedFrom.priority);
      const to = priorityLabel(data.priority);
      const p = ping(assigneeName, getMention);
      events.push({ key: 'issue_priority_changed', msg: `${p}<b>Priority Changed</b>\n${link}\n${from} → ${to}${by}` });
    }

    if (updatedFrom.title !== undefined) {
      const p = ping(assigneeName, getMention);
      events.push({ key: 'issue_title_changed', msg: `${p}<b>Title Changed</b>\n${esc(updatedFrom.title)} → ${esc(data.title)}${by}` });
    }

    if (events.length === 0) {
      const p = ping(assigneeName, getMention);
      events.push({ key: 'issue_updated', msg: `${p}<b>Issue Updated</b>\n${link}${by}` });
    }

    return events;
  }

  return null;
}

function formatComment(action, data, getMention = () => null, actor = null) {
  const issueLink_ = data.issue ? issueLink(data.issue) : `<b>issue</b>`;
  const body = esc((data.body || '').slice(0, 200)) + ((data.body || '').length > 200 ? '…' : '');
  const by = actorLine(actor, getMention);

  if (action === 'create') {
    return { key: 'comment_created', msg: `<b>Comment Added</b> on ${issueLink_}${by}\n<i>${body}</i>` };
  }
  if (action === 'update') {
    return { key: 'comment_updated', msg: `<b>Comment Edited</b> on ${issueLink_}${by}\n<i>${body}</i>` };
  }
  if (action === 'remove') {
    return { key: 'comment_deleted', msg: `<b>Comment Deleted</b> on ${issueLink_}${by}` };
  }
  return null;
}

function formatProject(action, data, actor = null) {
  const name = esc(data.name || 'Untitled Project');
  const appUrl = data.url ? data.url.replace('https://', 'linear://') : null;
  const link = appUrl ? `<a href="${appUrl}">${name}</a>` : `<b>${name}</b>`;

  if (action === 'create') {
    return { key: 'project_created', msg: `<b>Project Created</b>\n${link}` };
  }
  if (action === 'update') {
    return { key: 'project_updated', msg: `<b>Project Updated</b>\n${link}` };
  }
  return null;
}

function formatCycle(action, data, actor = null) {
  const name = esc(data.name || `Cycle ${data.number ?? ''}`);

  if (action === 'create') {
    return { key: 'cycle_started', msg: `<b>Cycle Started</b>\n${name}` };
  }
  if (action === 'update' && data.completedAt) {
    return { key: 'cycle_completed', msg: `<b>Cycle Completed</b>\n${name}` };
  }
  return null;
}

module.exports = { format };
