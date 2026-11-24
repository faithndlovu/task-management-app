require('dotenv').config({ quiet: true });
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`TaskFlow running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully`);
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
