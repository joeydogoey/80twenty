// Dashboard renderer — communicates with main process via window.tracker (preload.js)

let allScreenshots = [];
let allEvents = [];
let selectedScreenshotId = null;
let sessionStart = Date.now();

// ── Filters ───────────────────────────────────────────────────────────────────

const filterDate = document.getElementById('filter-date');
const filterApp  = document.getElementById('filter-app');
const filterType = document.getElementById('filter-type');

// Default to today
filterDate.value = new Date().toISOString().slice(0, 10);

filterDate.addEventListener('change', () => {
  if (activeTab === 'summary') loadSummary();
  else loadAll();
});
filterApp.addEventListener('change', loadEvents);
filterType.addEventListener('change', loadEvents);

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await loadAll();
  await loadStats();
  await populateAppFilter();

  // Refresh every 30 seconds
  setInterval(async () => {
    await loadStats();
    if (activeTab === 'summary') {
      await loadSummary();
    } else {
      await loadAll();
    }
  }, 30000);

  // Update session timer every second
  setInterval(updateSessionTimer, 1000);
}

async function loadAll() {
  await Promise.all([loadScreenshots(), loadEvents()]);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const stats = await window.tracker.getStats();
    document.getElementById('stat-events').textContent = (stats.eventsToday || 0).toLocaleString();
    document.getElementById('stat-screenshots').textContent = (stats.screenshotsToday || 0).toLocaleString();
  } catch (_) {}
}

function updateSessionTimer() {
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  document.getElementById('stat-session').textContent = parts.join(' ');
}

// ── Screenshots ───────────────────────────────────────────────────────────────

async function loadScreenshots() {
  const date = filterDate.value || null;
  try {
    allScreenshots = await window.tracker.getScreenshots({ date, limit: 100 });
    renderScreenshots();
  } catch (err) {
    console.error('Failed to load screenshots:', err);
  }
}

function renderScreenshots() {
  const grid = document.getElementById('screenshot-grid');
  document.getElementById('screenshot-count').textContent = `(${allScreenshots.length})`;

  if (allScreenshots.length === 0) {
    grid.innerHTML = '<div class="no-data">No screenshots yet for this date.<br>Switch apps or click something to capture one.</div>';
    return;
  }

  grid.innerHTML = allScreenshots.map(s => {
    const time = formatTime(s.timestamp);
    const app = s.app_name || 'Unknown';
    const trigger = s.trigger_type || 'periodic';
    const active = s.id === selectedScreenshotId ? 'active' : '';
    return `
      <div class="screenshot-thumb ${active}" onclick="selectScreenshot('${s.id}')" data-id="${s.id}">
        <img src="" data-screenshot-id="${s.id}" alt="Loading..." />
        <span class="trigger-badge ${trigger}">${triggerLabel(trigger)}</span>
        <div class="thumb-meta">
          <div class="thumb-time">${time}</div>
          <div class="thumb-app">${escHtml(app)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Load thumbnails lazily
  loadVisibleThumbnails();
  setupThumbnailObserver();
}

function setupThumbnailObserver() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (!img.src || img.src === window.location.href) {
          loadThumbnail(img);
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '100px' });

  document.querySelectorAll('img[data-screenshot-id]').forEach(img => observer.observe(img));
}

function loadVisibleThumbnails() {
  document.querySelectorAll('img[data-screenshot-id]').forEach(img => {
    const rect = img.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200) {
      loadThumbnail(img);
    }
  });
}

async function loadThumbnail(img) {
  const id = img.getAttribute('data-screenshot-id');
  if (!id || img.dataset.loaded) return;
  img.dataset.loaded = 'true';

  try {
    const dataUrl = await window.tracker.getScreenshotImage(id);
    if (dataUrl) {
      img.src = dataUrl;
      img.style.background = 'transparent';
    } else {
      img.style.background = '#1a1d27';
      img.alt = 'Not available';
    }
  } catch (_) {
    img.style.background = '#1a1d27';
  }
}

async function selectScreenshot(id) {
  selectedScreenshotId = id;

  // Update active state
  document.querySelectorAll('.screenshot-thumb').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  const screenshot = allScreenshots.find(s => s.id === id);
  if (!screenshot) return;

  // Show full-size image
  const area = document.getElementById('detail-image-area');
  area.innerHTML = '<div class="spinner"></div>';

  try {
    const dataUrl = await window.tracker.getScreenshotImage(id);
    if (dataUrl) {
      area.innerHTML = `<img src="${dataUrl}" alt="Screenshot ${id}" />`;
    } else {
      area.innerHTML = '<div class="detail-placeholder"><div class="big">🚫</div><p>Screenshot file not found locally.<br>It may have been uploaded and deleted.</p></div>';
    }
  } catch (_) {
    area.innerHTML = '<div class="detail-placeholder"><div class="big">⚠️</div><p>Failed to load screenshot</p></div>';
  }

  // Show metadata
  const meta = document.getElementById('detail-meta');
  meta.style.display = 'grid';
  document.getElementById('dm-time').textContent = formatDateTime(screenshot.timestamp);
  document.getElementById('dm-app').textContent = screenshot.app_name || '—';
  document.getElementById('dm-trigger').textContent = triggerLabel(screenshot.trigger_type);
  document.getElementById('dm-window').textContent = screenshot.window_title || '—';
  document.getElementById('dm-click').textContent =
    screenshot.click_x != null ? `${screenshot.click_x}, ${screenshot.click_y}` : '—';
  document.getElementById('dm-size').textContent =
    screenshot.file_size_bytes ? formatBytes(screenshot.file_size_bytes) : '—';
  document.getElementById('dm-uploaded').textContent =
    screenshot.uploaded ? '✅ Yes' : '⏳ Pending';
  document.getElementById('dm-id').textContent = screenshot.id;

  // Highlight nearby events in the right panel
  highlightEventsNearTime(screenshot.timestamp);
}

// ── Events ────────────────────────────────────────────────────────────────────

async function loadEvents() {
  const date     = filterDate.value || null;
  const appName  = filterApp.value  || null;
  const eventType = filterType.value || null;
  try {
    allEvents = await window.tracker.getEvents({ date, appName, eventType, limit: 300 });
    renderEvents();
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

function renderEvents() {
  const list = document.getElementById('events-list');
  document.getElementById('event-count').textContent = `(${allEvents.length})`;

  if (allEvents.length === 0) {
    list.innerHTML = '<div class="no-data" style="padding:30px 20px">No events for this date/filter.</div>';
    return;
  }

  list.innerHTML = allEvents.map(e => {
    const payload = safeJson(e.payload);
    const desc = eventDescription(e.event_type, payload);
    const sub  = eventSubtext(e.event_type, payload);
    const time = formatTime(e.timestamp);
    const hasScreenshot = e.screenshot_id ? ' data-has-screenshot="true"' : '';
    return `
      <div class="event-item" onclick="showEventDetail('${e.id}')"${hasScreenshot} data-ts="${e.timestamp}" data-id="${e.id}">
        <div class="event-type-dot ${e.event_type}"></div>
        <div class="event-body">
          <div class="event-top">
            <span class="event-type-label">${formatEventType(e.event_type)}</span>
            <span class="event-time">${time}</span>
          </div>
          <div class="event-desc">${escHtml(desc)}</div>
          ${sub ? `<div class="event-sub">${escHtml(sub)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function highlightEventsNearTime(timestamp, windowMs = 5000) {
  const ts = new Date(timestamp).getTime();
  document.querySelectorAll('.event-item').forEach(el => {
    const elTs = new Date(el.dataset.ts).getTime();
    const near = Math.abs(elTs - ts) <= windowMs;
    el.classList.toggle('highlight', near);
    if (near) {
      // Scroll first highlighted event into view
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

async function showEventDetail(id) {
  const event = allEvents.find(e => String(e.id) === String(id));
  if (!event) return;

  const payload = safeJson(event.payload);
  const detail = {
    id: event.id,
    event_type: event.event_type,
    timestamp: event.timestamp,
    source: event.source,
    screenshot_id: event.screenshot_id,
    payload,
  };

  document.getElementById('modal-title').textContent = formatEventType(event.event_type);
  document.getElementById('modal-json').textContent = JSON.stringify(detail, null, 2);
  document.getElementById('event-modal-overlay').classList.add('open');

  // If this event has a screenshot, select it
  if (event.screenshot_id) {
    await selectScreenshot(event.screenshot_id);
  }
}

function closeModal(e) {
  if (e.target === document.getElementById('event-modal-overlay')) {
    document.getElementById('event-modal-overlay').classList.remove('open');
  }
}

// ── App filter ────────────────────────────────────────────────────────────────

async function populateAppFilter() {
  try {
    const apps = await window.tracker.getDistinctApps();
    const select = document.getElementById('filter-app');
    const current = select.value;
    select.innerHTML = '<option value="">All apps</option>' +
      apps.map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');
    select.value = current;
  } catch (_) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerLabel(trigger) {
  return { click: 'Click', window_switch: 'Switch', periodic: 'Auto' }[trigger] || trigger;
}

function formatEventType(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function eventDescription(type, payload) {
  switch (type) {
    case 'click':
    case 'desktop_click':
      return payload.element_text || payload.window_title || '(click)';
    case 'window_change':
      return payload.app_name || '—';
    case 'navigation':
      return payload.title || payload.url || '—';
    case 'tab_switch':
      return payload.to_title || payload.to_url || '—';
    case 'idle_start':
      return 'User went idle';
    case 'idle_end':
      return `Back after ${Math.round((payload.idle_duration_seconds || 0) / 60)}m idle`;
    case 'session_start':
      return 'Session started';
    case 'session_end':
      return `Session ended (${payload.reason || ''})`;
    default:
      return type;
  }
}

function eventSubtext(type, payload) {
  switch (type) {
    case 'click':
      return payload.url ? new URL(payload.url).hostname : '';
    case 'desktop_click':
      return payload.window_title || '';
    case 'window_change':
      return payload.window_title || '';
    case 'navigation':
      return payload.domain || '';
    case 'tab_switch':
      return payload.to_url ? (() => { try { return new URL(payload.to_url).hostname; } catch { return payload.to_url; } })() : '';
    default:
      return '';
  }
}

function safeJson(str) {
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return {}; }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Tab switching ─────────────────────────────────────────────────────────────

let activeTab = 'timeline';

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(name === 'timeline' ? 'timeline' : 'summary')));
  document.getElementById('tab-timeline').classList.toggle('active', name === 'timeline');
  document.getElementById('tab-summary').classList.toggle('active', name === 'summary');
  if (name === 'summary') loadSummary();
}

// ── Summary tab ───────────────────────────────────────────────────────────────

async function loadSummary() {
  const date = filterDate.value || new Date().toISOString().slice(0, 10);
  const panel = document.getElementById('summary-panel');
  panel.innerHTML = '<div class="spinner" style="margin:60px auto"></div>';

  try {
    const [appSummary, workflows, switchEvents] = await Promise.all([
      window.tracker.getAppTimeSummary(date),
      window.tracker.getWorkflowSequences(date),
      window.tracker.getEvents({ date, eventType: 'window_change', limit: 500 }),
    ]);
    renderSummary(panel, appSummary, workflows, switchEvents);
  } catch (err) {
    panel.innerHTML = `<div class="no-summary">Failed to load summary: ${escHtml(String(err))}</div>`;
  }
}

function renderSummary(panel, appSummary, workflows, switchEvents) {
  const totalActive = appSummary.reduce((s, r) => s + (r.active_seconds || 0), 0);

  let html = '';

  // ── Time per app ──────────────────────────────────────────────────────────
  html += `<div>
    <div class="summary-section-title">Time per app — active only</div>`;

  if (appSummary.length === 0) {
    html += '<div class="no-summary" style="padding:20px 0">No data yet for this date.</div>';
  } else {
    html += '<div class="app-bar-list">';
    for (const row of appSummary) {
      const displayName = row.web_app_name || row.app_name || 'Unknown';
      const pct = totalActive > 0 ? Math.round((row.active_seconds / totalActive) * 100) : 0;
      const timeLabel = fmtDuration(row.active_seconds || 0);
      html += `
        <div class="app-bar-row" onclick="filterByApp(${JSON.stringify(displayName)})">
          <div class="app-bar-name" title="${escHtml(displayName)}">${escHtml(displayName)}</div>
          <div class="app-bar-track"><div class="app-bar-fill" style="width:${pct}%"></div></div>
          <div class="app-bar-time">${timeLabel}</div>
        </div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // ── Workflow sequences ────────────────────────────────────────────────────
  html += `<div>
    <div class="summary-section-title">Workflow sequences</div>`;

  if (workflows.length === 0) {
    html += '<div class="no-summary" style="padding:20px 0">No workflow data yet.</div>';
  } else {
    html += '<div class="workflow-cards">';
    for (const wf of workflows) {
      const startFmt = formatTime(wf.startTime);
      const endFmt   = formatTime(wf.endTime);
      const dur      = fmtDuration(wf.totalActiveSeconds || 0);
      html += `<div class="workflow-card">
        <div class="workflow-card-header">${startFmt} – ${endFmt}  ·  ${dur} active</div>
        <div class="workflow-chain">`;
      wf.apps.forEach((a, i) => {
        const name = a.webAppName || a.name;
        html += `<div class="workflow-app-chip">${escHtml(name)}<span class="chip-time">${fmtDuration(a.activeSeconds)}</span></div>`;
        if (i < wf.apps.length - 1) html += `<span class="workflow-arrow">→</span>`;
      });
      html += `</div></div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // ── App switch feed ───────────────────────────────────────────────────────
  html += `<div>
    <div class="summary-section-title">App switch log</div>
    <div class="switch-feed">`;

  if (switchEvents.length === 0) {
    html += '<div class="no-summary" style="padding:20px 0">No switches recorded yet.</div>';
  } else {
    for (const e of switchEvents) {
      const p = safeJson(e.payload);
      const to = p.web_app_name || p.app_name || '?';
      const from = p.previous_app || '';
      const active = fmtDuration(p.active_duration_seconds || 0);
      const time = formatTime(e.timestamp);
      html += `<div class="switch-row">
        <div class="switch-time">${time}</div>
        <div class="switch-transition">
          ${from ? `<span class="switch-from">${escHtml(from)}</span><span class="switch-arrow">→</span>` : ''}
          <strong>${escHtml(to)}</strong>
          ${p.window_title ? `<span class="switch-from"> "${escHtml(p.window_title.slice(0,60))}"</span>` : ''}
        </div>
        <div class="switch-duration">${active}</div>
      </div>`;
    }
  }
  html += '</div></div>';

  panel.innerHTML = html;
}

function filterByApp(appName) {
  switchTab('timeline');
  // find matching option in filterApp and select it
  const sel = document.getElementById('filter-app');
  for (const opt of sel.options) {
    if (opt.value === appName || opt.text === appName) {
      sel.value = opt.value;
      break;
    }
  }
  loadEvents();
}

function fmtDuration(seconds) {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
