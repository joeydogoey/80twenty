'use strict';

module.exports = function auth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7).trim()
    : apiKeyHeader;

  if (!token) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  if (!process.env.API_KEY) {
    console.warn('[auth] API_KEY env var not set — all requests will be rejected');
    return res.status(500).json({ error: 'Server misconfiguration: API_KEY not set' });
  }

  if (token !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
};
