const express = require('express');
const { makeAccess } = require('../access');
const { STATUSES, allowedNext, checkTransition } = require('../workflow');

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TASK_SELECT = `
  SELECT t.*, a.name AS assignee_name, c.name AS creator_name, p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users a ON a.id = t.assignee_id
  JOIN users c ON c.id = t.created_by`;

module.exports = function taskRoutes(db) {
  const router = express.Router();
  const access = makeAccess(db);
  const getTask = (id) => db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);

  function loadTask(req, res) {
    const task = getTask(Number(req.params.id));
    if (!task) { res.status(404).json({ error: 'Task not found' }); return null; }
    const project = access.getProject.get(task.project_id);
    if (!access.canViewProject(req.user, project)) { res.status(403).json({ error: 'You do not have access to this task' }); return null; }
    return { task, project };
  }

  function validateFields(body, { partial }) {
    const out = {};
    if (!partial || body.title !== undefined) {
      if (!body.title || !String(body.title).trim()) return { error: 'Title is required' };
      out.title = String(body.title).trim();
    }
    if (body.description !== undefined) out.description = String(body.description);
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority)) return { error: `Priority must be one of: ${PRIORITIES.join(', ')}` };
      out.priority = body.priority;
    }
    if (body.due_date !== undefined) {
      if (body.due_date !== null && body.due_date !== '' && !DATE_RE.test(body.due_date)) return { error: 'due_date must be YYYY-MM-DD' };
      out.due_date = body.due_date || null;
    }
    if (body.assignee_id !== undefined) out.assignee_id = body.assignee_id === null || body.assignee_id === '' ? null : Number(body.assignee_id);
    return { fields: out };
  }

  // List tasks visible to the user, with optional filters.
  router.get('/', (req, res) => {
    const v = access.visibleProjectsClause(req.user);
    const where = [v.sql];
    const params = [...v.params];
    const { project_id, status, priority, assignee_id, mine, q, overdue } = req.query;
    if (project_id) { where.push('t.project_id = ?'); params.push(Number(project_id)); }
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (priority) { where.push('t.priority = ?'); params.push(priority); }
    if (assignee_id) { where.push('t.assignee_id = ?'); params.push(Number(assignee_id)); }
    if (mine === '1' || mine === 'true') { where.push('t.assignee_id = ?'); params.push(req.user.id); }
    if (q) { where.push('(t.title LIKE ? OR t.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (overdue === '1' || overdue === 'true') where.push("t.due_date IS NOT NULL AND t.due_date < date('now') AND t.status != 'done'");
    const tasks = db.prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               t.due_date IS NULL, t.due_date, t.id`).all(...params);
    res.json({ tasks });
  });

  router.post('/', (req, res) => {
    const projectId = Number(req.body?.project_id);
    const project = access.getProject.get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageProject(req.user, project)) return res.status(403).json({ error: 'Only managers or admins can create tasks in this project' });
    const { error, fields } = validateFields(req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    if (fields.assignee_id && !access.isProjectParticipant(projectId, fields.assignee_id)) {
      return res.status(400).json({ error: 'Assignee must be a member of the project' });
    }
    const tx = db.transaction(() => {
      const info = db.prepare(`INSERT INTO tasks (project_id, title, description, priority, assignee_id, created_by, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(projectId, fields.title, fields.description || '', fields.priority || 'medium',
        fields.assignee_id || null, req.user.id, fields.due_date || null);
      db.prepare('INSERT INTO task_history (task_id, user_id, from_status, to_status, note) VALUES (?, ?, NULL, ?, ?)')
        .run(info.lastInsertRowid, req.user.id, 'todo', 'Task created');
      return info.lastInsertRowid;
    });
    res.status(201).json({ task: getTask(tx()) });
  });

  router.get('/:id', (req, res) => {
    const ctx = loadTask(req, res);
    if (!ctx) return;
    const history = db.prepare(`SELECT h.*, u.name AS user_name FROM task_history h JOIN users u ON u.id = h.user_id
      WHERE h.task_id = ? ORDER BY h.id`).all(ctx.task.id);
    const comments = db.prepare(`SELECT c.*, u.name AS user_name FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ? ORDER BY c.id`).all(ctx.task.id);
    const canMove = canChangeStatus(req.user, ctx);
    res.json({ task: ctx.task, history, comments, allowed_transitions: canMove ? allowedNext(ctx.task.status, req.user.role) : [] });
  });

  router.put('/:id', (req, res) => {
    const ctx = loadTask(req, res);
    if (!ctx) return;
    if (!access.canManageProject(req.user, ctx.project)) return res.status(403).json({ error: 'Only managers or admins can edit task details' });
    const { error, fields } = validateFields(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ error });
    if (fields.assignee_id && !access.isProjectParticipant(ctx.task.project_id, fields.assignee_id)) {
      return res.status(400).json({ error: 'Assignee must be a member of the project' });
    }
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), ctx.task.id);
    }
    res.json({ task: getTask(ctx.task.id) });
  });

  function canChangeStatus(user, ctx) {
    if (access.canManageProject(user, ctx.project)) return true;
    return ctx.task.assignee_id === user.id; // members may only move tasks assigned to them
  }

  router.patch('/:id/status', (req, res) => {
    const ctx = loadTask(req, res);
    if (!ctx) return;
    const { status, note = '' } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    if (!canChangeStatus(req.user, ctx)) return res.status(403).json({ error: 'Only the assignee or a project manager can change this task’s status' });
    const problem = checkTransition(ctx.task.status, status, req.user.role);
    if (problem) return res.status(422).json({ error: problem, allowed_transitions: allowedNext(ctx.task.status, req.user.role) });
    const tx = db.transaction(() => {
      db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, ctx.task.id);
      db.prepare('INSERT INTO task_history (task_id, user_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)')
        .run(ctx.task.id, req.user.id, ctx.task.status, status, String(note));
    });
    tx();
    res.json({ task: getTask(ctx.task.id) });
  });

  router.delete('/:id', (req, res) => {
    const ctx = loadTask(req, res);
    if (!ctx) return;
    if (!access.canManageProject(req.user, ctx.project)) return res.status(403).json({ error: 'Only managers or admins can delete tasks' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(ctx.task.id);
    res.status(204).end();
  });

  router.post('/:id/comments', (req, res) => {
    const ctx = loadTask(req, res);
    if (!ctx) return;
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });
    const info = db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(ctx.task.id, req.user.id, body);
    const comment = db.prepare('SELECT c.*, u.name AS user_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(info.lastInsertRowid);
    res.status(201).json({ comment });
  });

  return router;
};
