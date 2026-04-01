'use strict';

const WebSocket = require('ws');

const WS_PORT = 47832;
const HEARTBEAT_TIMEOUT_MS = 15000; // Mark as disconnected if no heartbeat in 15s

let wss = null;
const connectedClients = new Map(); // ws -> { lastHeartbeat: timestamp }
let onStatusChangeCallback = null;

/**
 * Start the WebSocket server that the Chrome extension connects to.
 * Bound to 127.0.0.1 only — never exposed to the network.
 */
function startWebSocketServer(onStatusChange) {
  onStatusChangeCallback = onStatusChange || null;

  wss = new WebSocket.Server({ port: WS_PORT, host: '127.0.0.1' });

  wss.on('listening', () => {
    console.log(`[ws-bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[ws-bridge] Port ${WS_PORT} already in use. Is another instance running?`);
    } else {
      console.error('[ws-bridge] Server error:', err.message);
    }
  });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[ws-bridge] Extension connected from ${clientIp}`);

    connectedClients.set(ws, { lastHeartbeat: Date.now() });
    notifyStatusChange();

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg);
      } catch (err) {
        console.warn('[ws-bridge] Invalid message from extension:', err.message);
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
      console.log('[ws-bridge] Extension disconnected');
      notifyStatusChange();
    });

    ws.on('error', (err) => {
      console.error('[ws-bridge] Client error:', err.message);
      connectedClients.delete(ws);
      notifyStatusChange();
    });

    // Send initial status
    safeSend(ws, { type: 'connected', port: WS_PORT });
  });

  // Periodic cleanup: remove stale connections that missed heartbeats
  setInterval(cleanupStaleClients, 10000);
}

function handleMessage(ws, msg) {
  if (msg.type === 'heartbeat') {
    const client = connectedClients.get(ws);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
    safeSend(ws, { type: 'heartbeat_ack', ts: new Date().toISOString() });
  }
}

function cleanupStaleClients() {
  const now = Date.now();
  let changed = false;
  for (const [ws, info] of connectedClients) {
    if (now - info.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      console.log('[ws-bridge] Removing stale client (no heartbeat)');
      ws.terminate();
      connectedClients.delete(ws);
      changed = true;
    }
  }
  if (changed) notifyStatusChange();
}

function safeSend(ws, obj) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch (_) {}
}

/**
 * Returns true if at least one Chrome extension is actively connected.
 */
function isExtensionConnected() {
  // Also check readyState in case the Map got stale
  for (const [ws] of connectedClients) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function notifyStatusChange() {
  if (onStatusChangeCallback) {
    onStatusChangeCallback(isExtensionConnected());
  }
}

function stopWebSocketServer() {
  if (wss) {
    wss.close();
    wss = null;
  }
}

module.exports = { startWebSocketServer, isExtensionConnected, stopWebSocketServer };
