'use strict';
require('dotenv').config();

const express = require('express');
const { initSchema } = require('./storage/postgres');
const auth = require('./middleware/auth');
const eventsRouter = require('./routes/events');
const screenshotsRouter = require('./routes/screenshots');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Health check — no auth required
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Apply auth to all API routes
app.use('/api', auth);

// Routes
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/screenshots', screenshotsRouter);

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await initSchema();
  app.listen(PORT, () => {
    console.log(`[api] Process Tracker API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[fatal] Server startup failed:', err);
  process.exit(1);
});
