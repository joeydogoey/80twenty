// Popup script — reads stats from background, handles pause/resume toggle

async function loadStats() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'get_stats' }, (response) => {
      resolve(response || {});
    });
  });
}

async function render() {
  const stats = await loadStats();
  const config = await new Promise((resolve) => {
    chrome.storage.sync.get(['paused'], resolve);
  });

  const isPaused = config.paused || false;

  // Status dot + text
  const dot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  if (isPaused) {
    dot.classList.add('paused');
    statusText.textContent = 'Tracking paused';
  } else if (stats.uploadError) {
    dot.classList.add('error');
    statusText.textContent = 'Upload error';
  } else {
    statusText.textContent = 'Tracking active';
  }

  // Stats
  document.getElementById('events-today').textContent =
    (stats.eventsTodayCount || 0).toLocaleString();
  document.getElementById('buffer-size').textContent =
    (stats.bufferSize || 0).toLocaleString();

  if (stats.lastUploadTime) {
    const d = new Date(stats.lastUploadTime);
    document.getElementById('last-upload').textContent =
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    document.getElementById('last-upload').textContent = 'Never';
  }

  // Buffer warning
  const warning = document.getElementById('buffer-warning');
  if ((stats.bufferSize || 0) > 200) {
    warning.style.display = 'block';
  }

  // Desktop connection
  const connEl = document.getElementById('desktop-connection');
  if (stats.desktopConnected) {
    connEl.textContent = 'Desktop agent: connected';
    connEl.classList.add('connected');
  } else {
    connEl.textContent = 'Desktop agent: not connected';
  }

  // Toggle button
  const btn = document.getElementById('toggle-btn');
  if (isPaused) {
    btn.textContent = '▶ Resume Tracking';
    btn.classList.remove('active');
  } else {
    btn.textContent = '⏸ Pause Tracking';
    btn.classList.add('active');
  }
}

// Toggle pause/resume
document.getElementById('toggle-btn').addEventListener('click', async () => {
  const config = await new Promise((resolve) => {
    chrome.storage.sync.get(['paused'], resolve);
  });
  const newPaused = !config.paused;
  chrome.runtime.sendMessage({ type: 'set_paused', paused: newPaused });
  await chrome.storage.sync.set({ paused: newPaused });
  await render();
});

// Initial render
render();
