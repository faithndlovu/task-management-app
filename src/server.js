require('dotenv').config({ quiet: true });
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Task Manager running at http://localhost:${PORT}`);
});
