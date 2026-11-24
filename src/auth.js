const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL = process.env.TOKEN_TTL || '8h';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/** Verifies the Bearer token and loads the current user onto req.user. */
function authenticate(db) {
  const findUser = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?');
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = findUser.get(payload.sub);
      if (!user) return res.status(401).json({ error: 'User no longer exists' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { signToken, authenticate, requireRole };
