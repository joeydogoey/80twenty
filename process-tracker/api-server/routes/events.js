'use strict';

const { Router } = require('express');
const { query } = require('../storage/postgres');
const { v4: uuidv4 } = require('uuid');

const router = Router();

/**
 * POST /api/v1/events
 * Body: {
 *   device_id: string,
 *   employee_id: string,
 *   company_id: string,
 *   events: Array<{ event_type, timestamp, source, payload, screenshot_id? }>
 * }
 * Response: { received: N }
 */
router.post('/', async (req, res, next) => {
  try {
    const { device_id, employee_id, company_id, events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }

    if (events.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 events per batch' });
    }

    // Build batch arrays for UNNEST insert
    const eventIds       = [];
    const deviceIds      = [];
    const employeeIds    = [];
    const companyIds     = [];
    const eventTypes     = [];
    const timestamps     = [];
    const sources        = [];
    const payloads       = [];
    const screenshotIds  = [];

    for (const e of events) {
      if (!e.event_type || !e.timestamp || !e.source) {
        continue; // Skip malformed events silently
      }
      eventIds.push(e.event_id || uuidv4());
      deviceIds.push(device_id || null);
      employeeIds.push(employee_id || null);
      companyIds.push(company_id || null);
      eventTypes.push(e.event_type);
      timestamps.push(e.timestamp);
      sources.push(e.source);
      payloads.push(JSON.stringify(e.payload || e));
      screenshotIds.push(e.screenshot_id || null);
    }

    if (eventIds.length === 0) {
      return res.json({ received: 0 });
    }

    // Batch insert using UNNEST — vastly faster than N individual inserts
    const result = await query(`
      INSERT INTO events
        (event_id, device_id, employee_id, company_id, event_type, timestamp, source, payload, screenshot_id)
      SELECT
        UNNEST($1::uuid[]),
        UNNEST($2::text[]),
        UNNEST($3::text[]),
        UNNEST($4::text[]),
        UNNEST($5::text[]),
        UNNEST($6::timestamptz[]),
        UNNEST($7::text[]),
        UNNEST($8::jsonb[]),
        UNNEST($9::text[])
      ON CONFLICT (event_id) DO NOTHING
    `, [eventIds, deviceIds, employeeIds, companyIds, eventTypes, timestamps, sources, payloads, screenshotIds]);

    const inserted = result.rowCount || 0;
    const duplicates = eventIds.length - inserted;

    console.log(`[events] Received ${eventIds.length}, inserted ${inserted}, duplicates ${duplicates}`);

    res.json({ received: inserted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
