/**
 * Resets the database and loads demo data.
 * All demo accounts use the password: Password123!
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createDb } = require('./db');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tasks.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = createDb(file);

const hash = bcrypt.hashSync('Password123!', 10);
const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
const admin = addUser.run('Alex Admin', 'admin@example.com', hash, 'admin').lastInsertRowid;
const manager = addUser.run('Morgan Manager', 'manager@example.com', hash, 'manager').lastInsertRowid;
const sam = addUser.run('Sam Member', 'member@example.com', hash, 'member').lastInsertRowid;
const jo = addUser.run('Jo Developer', 'jo@example.com', hash, 'member').lastInsertRowid;

const addProject = db.prepare('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)');
const addMember = db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)');
const web = addProject.run('Website Redesign', 'Refresh the marketing site and improve performance.', manager).lastInsertRowid;
const mobile = addProject.run('Mobile App Launch', 'Ship v1 of the mobile app to both app stores.', manager).lastInsertRowid;
for (const u of [manager, sam, jo]) addMember.run(web, u);
for (const u of [manager, jo]) addMember.run(mobile, u);

const addTask = db.prepare(`INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, created_by, due_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, date('now', ?))`);
const addHistory = db.prepare('INSERT INTO task_history (task_id, user_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)');
const tasks = [
  [web, 'Design new homepage', 'Wireframes and high-fidelity mockups.', 'done', 'high', sam, '-5 days'],
  [web, 'Set up CI pipeline', 'Lint, test and deploy on every push.', 'review', 'medium', jo, '+2 days'],
  [web, 'Optimise images', 'Convert hero images to WebP and lazy-load.', 'in_progress', 'medium', sam, '+4 days'],
  [web, 'Write accessibility audit', 'Check contrast, keyboard navigation and ARIA labels.', 'todo', 'high', sam, '-1 days'],
  [web, 'Update footer links', '', 'todo', 'low', null, '+10 days'],
  [mobile, 'Push notifications', 'Integrate Firebase Cloud Messaging.', 'in_progress', 'urgent', jo, '+1 days'],
  [mobile, 'App store screenshots', 'Produce screenshots for all device sizes.', 'todo', 'medium', jo, '+7 days'],
];
for (const [p, title, desc, status, priority, assignee, due] of tasks) {
  const id = addTask.run(p, title, desc, status, priority, assignee, manager, due).lastInsertRowid;
  addHistory.run(id, manager, null, 'todo', 'Task created');
  const path = ['todo', 'in_progress', 'review', 'done'];
  for (let i = 1; i <= path.indexOf(status); i++) addHistory.run(id, assignee || manager, path[i - 1], path[i], '');
}
db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(2, jo, 'Pipeline is green — ready for review.');

console.log('Database seeded. Log in with admin@example.com / manager@example.com / member@example.com (password: Password123!)');
void admin;
db.close();
