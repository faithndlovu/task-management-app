const express = require('express');
const { requireRole } = require('../auth');

const ROLES = ['admin', 'manager', 'member'];

module.exports = function userRoutes(db) {
  const router = express.Router();

  // Everyone can list users (needed to pick assignees / members); only safe fields are returned.
  router.get('/', (req, res) => {
    const users = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name').all();
    res.json({ users });
  });

  router.patch('/:id/role', requireRole('admin'), (req, res) => {
    const { role } = req.body || {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}` });
    const id = Number(req.params.id);
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin' && role !== 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
      if (admins <= 1) return res.status(400).json({ error: 'Cannot demote the last administrator' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    res.json({ user: db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id) });
  });

  router.delete('/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const owns = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?').get(id).n;
    if (owns > 0) return res.status(400).json({ error: 'Reassign or delete this user’s projects first' });
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.status(204).end();
  });

  return router;
};
