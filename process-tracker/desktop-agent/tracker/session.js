'use strict';

const { v4: uuidv4 } = require('uuid');
const { insertEvent } = require('../storage/database');
const { logSystem } = require('../privacy/activity-log');

let sessionId = null;
let sessionStart = null;

/**
 * Start a new tracking session. Emits a session_start event.
 */
function startSession() {
  sessionId = uuidv4();
  sessionStart = new Date();

  insertEvent({
    event_type: 'session_start',
    timestamp: sessionStart.toISOString(),
    source: 'desktop_agent',
    payload: { session_id: sessionId },
  });

  logSystem(`Session started — ${sessionId}`);
  console.log(`[session] Session started: ${sessionId}`);

  return sessionId;
}

/**
 * End the current session. Emits a session_end event with duration.
 * @param {string} [reason]
 */
function endSession(reason = 'app_quit') {
  if (!sessionId) return;

  const now = new Date();
  const durationSeconds = Math.round((now - sessionStart) / 1000);

  insertEvent({
    event_type: 'session_end',
    timestamp: now.toISOString(),
    source: 'desktop_agent',
    payload: {
      session_id: sessionId,
      duration_seconds: durationSeconds,
      reason,
    },
  });

  logSystem(`Session ended (${reason}) — duration: ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`);
  console.log(`[session] Session ended: ${reason}, duration: ${durationSeconds}s`);

  sessionId = null;
  sessionStart = null;
}

/**
 * Mark a session boundary (e.g. after long idle). Ends current session and starts a new one.
 * @param {string} reason
 */
function newSessionBoundary(reason = 'long_idle') {
  endSession(reason);
  startSession();
}

function getSessionId() {
  return sessionId;
}

module.exports = { startSession, endSession, newSessionBoundary, getSessionId };
