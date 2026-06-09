// Default notification toggle values for a new chat
const DEFAULTS = {
  issue_created: true,
  issue_updated: false,
  issue_deleted: true,
  issue_status_changed: true,
  issue_assigned: true,
  issue_priority_changed: false,
  issue_title_changed: false,
  comment_created: true,
  comment_updated: false,
  comment_deleted: false,
  project_created: true,
  project_updated: false,
  cycle_started: true,
  cycle_completed: true,
};

const LABELS = {
  issue_created: 'Issue Created',
  issue_updated: 'Issue Updated (other changes)',
  issue_deleted: 'Issue Deleted',
  issue_status_changed: 'Status Changed (master toggle)',
  issue_assigned: 'Issue Assigned',
  issue_priority_changed: 'Priority Changed',
  issue_title_changed: 'Title Changed',
  comment_created: 'Comment Added',
  comment_updated: 'Comment Edited',
  comment_deleted: 'Comment Deleted',
  project_created: 'Project Created',
  project_updated: 'Project Updated',
  cycle_started: 'Cycle Started',
  cycle_completed: 'Cycle Completed',
};

module.exports = { DEFAULTS, LABELS };
