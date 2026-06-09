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

function issueLink(data, getUrl = u => u) {
  const id = esc(data.identifier || data.id?.slice(0, 8));
  const title = esc(data.title || 'Untitled');
  const url = data.url ? getUrl(data.url) : null;
  return url ? `<a href="${url}">${id}: ${title}</a>` : `<b>${id}: ${title}</b>`;
}

function identifierLink(data, getUrl = u => u) {
  const id = esc(data.identifier || data.id?.slice(0, 8));
  const url = data.url ? getUrl(data.url) : null;
  return url ? `<a href="${url}">${id}</a>` : `<b>${id}</b>`;
}

function event(key, msg, url, extra) {
  return { key, msg, url: url || null, ...extra };
}

// "by Name"
function actorStr(actor, getMention) {
  if (!actor?.name) return '';
  return `by ${esc(actor.name)}`;
}

// Appends " · {by}" if by is non-empty
function dot(by) { return by ? ` · ${by}` : ''; }

// Ping directly above next line — no blank line gap
function pingClose(name, getMention) {
  const mention = name ? getMention(name) : null;
  return mention ? `${mention}\n` : '';
}

// Ping with a blank line before next content
function pingFar(name, getMention) {
  const mention = name ? getMention(name) : null;
  return mention ? `${mention}\n\n` : '';
}

function format(type, action, data, updatedFrom, getMention = () => null, actor = null, getUrl = u => u) {
  switch (type) {
    case 'Issue':   return formatIssue(action, data, updatedFrom, getMention, actor, getUrl);
    case 'Comment': return formatComment(action, data, getMention, actor, getUrl);
    case 'Project': return formatProject(action, data, getUrl);
    case 'Cycle':   return formatCycle(action, data);
    default:        return null;
  }
}

function formatIssue(action, data, updatedFrom = {}, getMention = () => null, actor = null, getUrl = u => u) {
  const link = issueLink(data, getUrl);
  const assigneeName = data.assignee?.name;
  const by = actorStr(actor, getMention);
  const url = data.url;

  if (action === 'create') {
    const priority = data.priority != null ? priorityLabel(data.priority) : null;
    const state = data.state?.name ? esc(data.state.name) : null;
    const meta = [priority, state, by].filter(Boolean).join(' · ');
    const p = pingClose(assigneeName, getMention);
    return event(null, `${p}<b>Issue Created</b>\n${link}\n\n${meta}`, url);
  }

  if (action === 'remove') {
    return event(null, `<b>Issue Deleted</b>\n${link}\n${by}`, url);
  }

  if (action === 'update') {
    const events = [];

    if (updatedFrom.stateId !== undefined) {
      const from = esc(updatedFrom.stateName || 'previous');
      const to = esc(data.state?.name || 'new status');
      const p = pingFar(assigneeName, getMention);
      events.push(event('issue_status_changed', `${p}<b>Status Changed</b>\n${link}\n\n${from} → ${to}${dot(by)}`, url, { statusName: data.state?.name || null }));
    }

    if (updatedFrom.assigneeId !== undefined) {
      const name = data.assignee?.name;
      const p = pingFar(name, getMention);
      const assigneeStr = name ? esc(name) : 'Unassigned';
      events.push(event('issue_assigned', `${p}<b>Issue Assigned</b>\n${link}\n→ ${assigneeStr}${dot(by)}`, url));
    }

    if (updatedFrom.priority !== undefined) {
      const from = priorityLabel(updatedFrom.priority);
      const to = priorityLabel(data.priority);
      const p = pingFar(assigneeName, getMention);
      events.push(event('issue_priority_changed', `${p}<b>Priority Changed</b>\n${link}\n${from} → ${to}${dot(by)}`, url));
    }

    if (updatedFrom.title !== undefined) {
      const idLink = identifierLink(data, getUrl);
      const p = pingFar(assigneeName, getMention);
      events.push(event('issue_title_changed', `${p}<b>Title Changed</b>\n${idLink}\n${esc(updatedFrom.title)} → ${esc(data.title)}${dot(by)}`, url));
    }

    if (events.length === 0) {
      const p = pingFar(assigneeName, getMention);
      events.push(event('issue_updated', `${p}<b>Issue Updated</b>\n${link}\n\nupdated ${by}`, url));
    }

    return events;
  }

  return null;
}

function formatComment(action, data, getMention = () => null, actor = null, getUrl = u => u) {
  const issueLink_ = data.issue ? issueLink(data.issue, getUrl) : `<b>issue</b>`;
  const body = esc((data.body || '').slice(0, 200)) + ((data.body || '').length > 200 ? '…' : '');
  const by = actorStr(actor, getMention);
  const url = data.issue?.url;
  const assigneeName = data.issue?.assignee?.name;

  if (action === 'create') {
    const p = pingFar(assigneeName, getMention);
    return event('comment_created', `${p}<b>Comment Added</b>\n${issueLink_}${dot(by)}\n\n"${body}"`, url);
  }
  if (action === 'update') {
    const p = pingClose(assigneeName, getMention);
    return event('comment_updated', `${p}<b>Comment Edited</b>\n\n${issueLink_}${dot(by)}\n\n"${body}"`, url);
  }
  if (action === 'remove') {
    const p = pingFar(assigneeName, getMention);
    return event('comment_deleted', `${p}<b>Comment Deleted</b>\n${issueLink_}${dot(by)}`, url);
  }
  return null;
}

function formatProject(action, data, getUrl = u => u) {
  const name = esc(data.name || 'Untitled Project');
  const url = data.url ? getUrl(data.url) : null;
  const link = url ? `<a href="${url}">${name}</a>` : `<b>${name}</b>`;

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
