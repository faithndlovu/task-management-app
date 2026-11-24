/**
 * Task workflow rules.
 *
 *   todo ──▶ in_progress ──▶ review ──▶ done
 *     ▲          │  ▲           │        │
 *     └──────────┘  └───────────┘        │
 *                ▲      (reject)         │
 *                └───────────────────────┘ (reopen)
 *
 * Members may move their own tasks forward up to "review".
 * Only managers/admins can approve (review → done), reject (review → in_progress)
 * or reopen a finished task (done → in_progress).
 */
const STATUSES = ['todo', 'in_progress', 'review', 'done'];

const TRANSITIONS = {
  todo:        { in_progress: ['admin', 'manager', 'member'] },
  in_progress: { todo: ['admin', 'manager', 'member'], review: ['admin', 'manager', 'member'] },
  review:      { done: ['admin', 'manager'], in_progress: ['admin', 'manager'] },
  done:        { in_progress: ['admin', 'manager'] },
};

function allowedNext(from, role) {
  const options = TRANSITIONS[from] || {};
  return Object.keys(options).filter((to) => options[to].includes(role));
}

/** Returns null if allowed, otherwise an error message. */
function checkTransition(from, to, role) {
  if (!STATUSES.includes(to)) return `Unknown status "${to}"`;
  if (from === to) return `Task is already "${to}"`;
  const roles = (TRANSITIONS[from] || {})[to];
  if (!roles) return `Cannot move a task from "${from}" to "${to}"`;
  if (!roles.includes(role)) return `Your role (${role}) cannot move a task from "${from}" to "${to}"`;
  return null;
}

module.exports = { STATUSES, TRANSITIONS, allowedNext, checkTransition };
