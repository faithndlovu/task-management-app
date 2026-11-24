const path = require('path');
const express = require('express');
const { createDb } = require('./db');
const { authenticate } = require('./auth');
const { makeAccess } = require('./access');

function createApp({ db = createDb() } = {}) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', require('./routes/auth')(db));

  const auth = authenticate(db);
  app.use('/api/users', auth, require('./routes/users')(db));
  app.use('/api/projects', auth, require('./routes/projects')(db));
  app.use('/api/tasks', auth, require('./routes/tasks')(db));

  // Dashboard summary for the signed-in user.
  app.get('/api/stats', auth, (req, res) => {
    const v = makeAccess(db).visibleProjectsClause(req.user);
    const base = `FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${v.sql}`;
    const byStatus = Object.fromEntries(['todo', 'in_progress', 'review', 'done'].map((s) => [s, 0]));
    for (const r of db.prepare(`SELECT t.status, COUNT(*) AS n ${base} GROUP BY t.status`).all(...v.params)) byStatus[r.status] = r.n;
    const overdue = db.prepare(`SELECT COUNT(*) AS n ${base} AND t.due_date < date('now') AND t.status != 'done'`).get(...v.params).n;
    const mine = db.prepare(`SELECT COUNT(*) AS n ${base} AND t.assignee_id = ? AND t.status != 'done'`).get(...v.params, req.user.id).n;
    const projects = db.prepare(`SELECT COUNT(*) AS n FROM projects p WHERE ${v.sql}`).get(...v.params).n;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    res.json({ byStatus, total, overdue, assignedToMe: mine, projects, completionRate: total ? Math.round((byStatus.done / total) * 100) : 0 });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
