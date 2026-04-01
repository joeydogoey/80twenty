// Settings window renderer script
// Communicates with main process via window.tracker (exposed by preload.js)

async function loadSettings() {
  try {
    const settings = await window.tracker.getSettings();

    document.getElementById('apiBase').value = settings.apiBase || '';
    document.getElementById('authToken').value = settings.authToken || '';
    document.getElementById('employeeId').value = settings.employeeId || '';
    document.getElementById('companyId').value = settings.companyId || '';
    document.getElementById('dashboardUrl').value = settings.dashboardUrl || '';

    document.getElementById('blockedApps').value =
      (settings.blockedApps || []).join('\n');

    const quality = settings.screenshotQuality || 50;
    document.getElementById('screenshotQuality').value = quality;
    document.getElementById('qualityValue').textContent = `${quality}%`;

    document.getElementById('showNotificationOnScreenshot').checked =
      settings.showNotificationOnScreenshot || false;

    document.getElementById('startAtLogin').checked =
      settings.startAtLogin || false;
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function loadStats() {
  try {
    const stats = await window.tracker.getStats();
    document.getElementById('stat-events-today').textContent =
      (stats.eventsToday || 0).toLocaleString();
    document.getElementById('stat-screenshots-today').textContent =
      (stats.screenshotsToday || 0).toLocaleString();
    document.getElementById('stat-events-pending').textContent =
      (stats.eventsPending || 0).toLocaleString();
    document.getElementById('stat-screenshots-pending').textContent =
      (stats.screenshotsPending || 0).toLocaleString();
  } catch (_) {}
}

async function saveSettings() {
  const blockedAppsRaw = document.getElementById('blockedApps').value;
  const blockedApps = blockedAppsRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const settings = {
    apiBase: document.getElementById('apiBase').value.trim().replace(/\/$/, ''),
    authToken: document.getElementById('authToken').value.trim(),
    employeeId: document.getElementById('employeeId').value.trim(),
    companyId: document.getElementById('companyId').value.trim(),
    dashboardUrl: document.getElementById('dashboardUrl').value.trim(),
    blockedApps,
    screenshotQuality: parseInt(document.getElementById('screenshotQuality').value, 10),
    showNotificationOnScreenshot:
      document.getElementById('showNotificationOnScreenshot').checked,
    startAtLogin: document.getElementById('startAtLogin').checked,
  };

  try {
    await window.tracker.saveSettings(settings);
    showStatus('Settings saved!');
  } catch (err) {
    showStatus(`Error: ${err.message}`);
  }
}

async function openActivityLog() {
  await window.tracker.openActivityLog();
}

function showStatus(msg) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// Live quality slider display
document.getElementById('screenshotQuality').addEventListener('input', (e) => {
  document.getElementById('qualityValue').textContent = `${e.target.value}%`;
});

// Initialize
loadSettings();
loadStats();
