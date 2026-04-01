'use strict';

// Uses Electron's built-in powerMonitor.getSystemIdleTime() — no additional
// native module needed, correctly tracks all input types on macOS.

const { insertEvent } = require('../storage/database');
const { logSystem } = require('../privacy/activity-log');
const { newSessionBoundary } = require('./session');

const IDLE_THRESHOLD_SECONDS = 120;    // 2 minutes → emit idle_start
const SESSION_THRESHOLD_SECONDS = 600; // 10 minutes → new session boundary
const CHECK_INTERVAL_MS = 30 * 1000;   // Check every 30 seconds

let isIdle = false;
let idleStartTime = null;
let checkInterval = null;
let onIdleChangeCallback = null;
let powerMonitor;

// ── Idle accumulator (for active-time tracking) ───────────────────────────────
// Tracks how much idle time has accumulated since the last window switch.
// window-tracker calls resetIdleAccumulator() on each switch, then reads
// getIdleAccumulatedMs() before resetting to subtract idle from total duration.
let idleAccumulatedMs = 0;
let idleAccStartedAt = null;

/**
 * Start idle detection.
 * Must be called after the Electron app is ready (powerMonitor requires app ready).
 * @param {{ onIdleChange?: Function }} options
 */
function startIdleDetector({ onIdleChange } = {}) {
  onIdleChangeCallback = onIdleChange || null;

  try {
    powerMonitor = require('electron').powerMonitor;
  } catch (err) {
    console.error('[idle-detector] Failed to access powerMonitor:', err.message);
    return;
  }

  checkInterval = setInterval(checkIdleState, CHECK_INTERVAL_MS);
  console.log('[idle-detector] Started (checking every 30s)');
}

function checkIdleState() {
  let idleSeconds;
  try {
    idleSeconds = powerMonitor.getSystemIdleTime();
  } catch (err) {
    console.warn('[idle-detector] getSystemIdleTime failed:', err.message);
    return;
  }

  const nowIso = new Date().toISOString();

  if (!isIdle && idleSeconds >= IDLE_THRESHOLD_SECONDS) {
    // Transition: active → idle
    isIdle = true;
    // Backtrack to approximate when idle actually started
    idleStartTime = Date.now() - (idleSeconds * 1000);
    idleAccStartedAt = idleStartTime;

    insertEvent({
      event_type: 'idle_start',
      timestamp: new Date(idleStartTime).toISOString(),
      source: 'desktop_agent',
      payload: {
        event_type: 'idle_start',
        timestamp: new Date(idleStartTime).toISOString(),
        source: 'desktop_agent',
        idle_seconds: idleSeconds,
      },
    });

    logSystem(`Idle detected (${idleSeconds}s)`);
    console.log(`[idle-detector] Idle start after ${idleSeconds}s`);

    if (onIdleChangeCallback) onIdleChangeCallback({ idle: true, idleSeconds });

  } else if (isIdle && idleSeconds < IDLE_THRESHOLD_SECONDS) {
    // Transition: idle → active
    isIdle = false;
    const now2 = Date.now();
    if (idleAccStartedAt) {
      idleAccumulatedMs += now2 - idleAccStartedAt;
      idleAccStartedAt = null;
    }
    const idleDurationMs = now2 - idleStartTime;
    const idleDurationSeconds = Math.round(idleDurationMs / 1000);

    insertEvent({
      event_type: 'idle_end',
      timestamp: nowIso,
      source: 'desktop_agent',
      payload: {
        event_type: 'idle_end',
        timestamp: nowIso,
        source: 'desktop_agent',
        idle_duration_seconds: idleDurationSeconds,
      },
    });

    logSystem(`Idle ended (was idle for ${Math.floor(idleDurationSeconds / 60)}m ${idleDurationSeconds % 60}s)`);
    console.log(`[idle-detector] Active again after ${idleDurationSeconds}s idle`);

    if (onIdleChangeCallback) onIdleChangeCallback({ idle: false, idleDurationSeconds });

    // Session boundary after 10+ minutes of idle
    if (idleDurationSeconds >= SESSION_THRESHOLD_SECONDS) {
      console.log('[idle-detector] Long idle — creating new session boundary');
      newSessionBoundary('long_idle');
    }

    idleStartTime = null;
  }
}

function stopIdleDetector() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function isCurrentlyIdle() {
  return isIdle;
}

function getIdleAccumulatedMs() {
  // If currently idle, include time since idle started (not yet flushed)
  if (isIdle && idleAccStartedAt) {
    return idleAccumulatedMs + (Date.now() - idleAccStartedAt);
  }
  return idleAccumulatedMs;
}

function resetIdleAccumulator() {
  idleAccumulatedMs = 0;
  // If we're currently idle, restart the accumulator from now
  // (the window-tracker is noting a switch; ongoing idle will be charged to the new window)
  idleAccStartedAt = isIdle ? Date.now() : null;
}

module.exports = { startIdleDetector, stopIdleDetector, isCurrentlyIdle, getIdleAccumulatedMs, resetIdleAccumulator };
