/**
 * Thin wrapper around Node's built-in SQLite driver (node:sqlite, Node 22.13+).
 * Using the built-in driver means `npm install` never has to compile native code,
 * which keeps setup painless on Windows, macOS and Linux.
 *
 * Adds two conveniences on top of DatabaseSync:
 *   db.pragma('foreign_keys = ON')
 *   db.transaction(fn)  -> returns a function that runs fn inside BEGIN/COMMIT (ROLLBACK on error)
 */
const { DatabaseSync } = require('node:sqlite');

function openDatabase(file) {
  const db = new DatabaseSync(file);
  let depth = 0;

  db.pragma = (statement) => db.exec(`PRAGMA ${statement}`);

  db.transaction = (fn) => (...args) => {
    const savepoint = `sp_${depth}`;
    db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    depth++;
    try {
      const result = fn(...args);
      depth--;
      db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      depth--;
      db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw err;
    }
  };

  return db;
}

module.exports = { openDatabase };
