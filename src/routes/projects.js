const express = require('express');
const { requireRole } = require('../auth');
const { makeAccess } = require('../access');

module.exports = function projectRoutes(db) {
  const router = express.Router();
  const access = makeAccess(db);

  const projectWithStats = (id) =>
    db.prepare(`
      SELECT p.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
      FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`).get(id);

  const membersOf = (id) =>
    db.prepare(`
      SELECT u.id, u.name, u.email, u.role FROM project_members pm
      JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY u.name`).all(id);

  router.get('/', (req, res) => {
    const v = access.visibleProjectsClause(req.user);
    const projects = db.prepare(`
      SELECT p.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
      FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE ${v.sql} ORDER BY p.created_at DESC, p.id DESC`).all(...v.params);
    res.json({ projects });
  });

  router.post('/', requireRole('admin', 'manager'), (req, res) => {
    const { name, description = '', memberIds = [] } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Project name is required' });
    const create = db.transaction(() => {
      const info = db.prepare('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)')
        .run(String(name).trim(), String(description), req.user.id);
      const add = db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)');
      add.run(info.lastInsertRowid, req.user.id);
      for (const uid of memberIds) {
        if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) add.run(info.lastInsertRowid, uid);
      }
      return info.lastInsertRowid;
    });
    const id = create();
    res.status(201).json({ project: projectWithStats(id), members: membersOf(id) });
  });

  router.get('/:id', (req, res) => {
    const project = access.getProject.get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!access.canViewProject(req.user, project)) return res.status(403).json({ error: 'You do not have access to this project' });
    res.json({ project: projectWithStats(project.id), members: membersOf(project.id) });
  });

  router.put('/:id', (req, res) => {
    const project = access.getProject.get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageProject(req.user, project)) return res.status(403).json({ error: 'Only the project’s managers or an admin can edit it' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : project.name;
    const description = req.body?.description !== undefined ? String(req.body.description) : project.description;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run(name, description, project.id);
    res.json({ project: projectWithStats(project.id) });
  });

  router.delete('/:id', (req, res) => {
    const project = access.getProject.get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!(req.user.role === 'admin' || project.owner_id === req.user.id)) {
      return res.status(403).json({ error: 'Only the project owner or an admin can delete it' });
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    res.status(204).end();
  });

  router.post('/:id/members', (req, res) => {
    const project = access.getProject.get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageProject(req.user, project)) return res.status(403).json({ error: 'Not allowed to manage members' });
    const userId = Number(req.body?.userId);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return res.status(404).json({ error: 'User not found' });
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(project.id, userId);
    res.status(201).json({ members: membersOf(project.id) });
  });

  router.delete('/:id/members/:userId', (req, res) => {
    const project = access.getProject.get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!access.canManageProject(req.user, project)) return res.status(403).json({ error: 'Not allowed to manage members' });
    const userId = Number(req.params.userId);
    if (userId === project.owner_id) return res.status(400).json({ error: 'The project owner cannot be removed' });
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(project.id, userId);
      db.prepare('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?').run(project.id, userId);
    });
    tx();
    res.json({ members: membersOf(project.id) });
  });

  return router;
};
