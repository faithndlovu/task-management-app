const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, authenticate } = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function authRoutes(db) {
  const router = express.Router();

  router.post('/register', (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const normalizedEmail = email.trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail)) {
      return res.status(409).json({ error: 'Email is already registered' });
    }
    // The very first account becomes the administrator; everyone else starts as a member.
    const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const role = isFirst ? 'admin' : 'member';
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(String(name).trim(), normalizedEmail, hash, role);
    const user = { id: info.lastInsertRowid, name: String(name).trim(), email: normalizedEmail, role };
    res.status(201).json({ token: signToken(user), user });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    res.json({ token: signToken(user), user });
  });

  router.get('/me', authenticate(db), (req, res) => res.json({ user: req.user }));

  return router;
};
