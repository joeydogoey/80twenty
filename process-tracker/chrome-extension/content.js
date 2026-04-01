// Content script — injected into all pages at document_start
// Handles: click tracking, SPA navigation detection

(function () {
  'use strict';

  // ── Guard: skip frames that aren't top-level or are cross-origin ─────────
  // (We still run in iframes for completeness but restrict sensitive checks)

  const INTERACTIVE_SELECTOR = [
    'button',
    'a',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="link"]',
    'input[type="submit"]',
    'input[type="button"]',
    'select',
    '.btn',
    '[data-action]',
    '[onclick]',
  ].join(', ');

  const SENSITIVE_URL_PATTERNS = /login|signin|sign-in|auth|password|oauth|sso/i;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isSensitivePage() {
    return SENSITIVE_URL_PATTERNS.test(window.location.href);
  }

  function hasPasswordAncestor(el) {
    let cur = el;
    while (cur) {
      if (
        cur.tagName === 'FORM' &&
        cur.querySelector('input[type="password"]')
      ) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function extractLabel(el) {
    // Priority: innerText → value → aria-label → title → alt → placeholder → name → id
    const text = (el.innerText || el.textContent || '').trim().slice(0, 100);
    if (text) return text;
    if (el.value && el.tagName !== 'SELECT') return String(el.value).slice(0, 100);
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').slice(0, 100);
    if (el.title) return el.title.slice(0, 100);
    if (el.alt) return el.alt.slice(0, 100);
    if (el.placeholder) return el.placeholder.slice(0, 100);
    if (el.name) return el.name.slice(0, 100);
    if (el.id) return el.id.slice(0, 100);
    return '';
  }

  function getParentContext(el) {
    const parts = [];
    let cur = el.parentElement;
    let levels = 0;

    while (cur && levels < 5) {
      // Collect heading text
      const heading = cur.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) {
        const t = (heading.innerText || heading.textContent || '').trim();
        if (t && !parts.includes(t)) parts.push(t.slice(0, 60));
      }

      // Collect aria-label of containers
      const label = cur.getAttribute('aria-label');
      if (label && !parts.includes(label)) parts.push(label.slice(0, 60));

      // Collect data-testid as context hint
      const testid = cur.getAttribute('data-testid');
      if (testid && !parts.includes(testid)) parts.push(testid.slice(0, 60));

      cur = cur.parentElement;
      levels++;

      if (parts.length >= 3) break;
    }

    return parts.join(' | ');
  }

  // ── Click listener ────────────────────────────────────────────────────────

  function handleClick(event) {
    if (isSensitivePage()) return;

    const target = event.target;
    if (!target || !target.closest) return;

    // Find the nearest interactive element
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    if (!interactive) return;

    // Skip password-adjacent elements
    if (
      interactive.type === 'password' ||
      hasPasswordAncestor(interactive)
    ) {
      return;
    }

    const payload = {
      event_type: 'click',
      timestamp: new Date().toISOString(),
      source: 'chrome_extension',
      url: window.location.href,
      page_title: document.title,
      element_tag: interactive.tagName,
      element_text: extractLabel(interactive),
      element_role: interactive.getAttribute('role') || interactive.tagName.toLowerCase(),
      element_classes: (interactive.className || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      parent_context: getParentContext(interactive),
    };

    try {
      chrome.runtime.sendMessage({ type: 'click_event', payload });
    } catch (_) {
      // Extension context may have been invalidated (e.g. reload)
    }
  }

  document.addEventListener('click', handleClick, true);

  // ── SPA navigation detection ──────────────────────────────────────────────

  let lastUrl = window.location.href;

  function emitNavigation(url) {
    let domain = '';
    let path = '';
    try {
      const parsed = new URL(url);
      domain = parsed.hostname;
      path = parsed.pathname + parsed.search;
    } catch (_) {}

    const payload = {
      event_type: 'navigation',
      timestamp: new Date().toISOString(),
      source: 'chrome_extension',
      url,
      title: document.title,
      domain,
      path,
    };

    try {
      chrome.runtime.sendMessage({ type: 'navigation_event', payload });
    } catch (_) {}
  }

  function checkUrlChange() {
    const current = window.location.href;
    if (current !== lastUrl) {
      lastUrl = current;
      emitNavigation(current);
    }
  }

  // Monkey-patch history methods
  const _pushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _pushState(...args);
    checkUrlChange();
  };

  const _replaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _replaceState(...args);
    checkUrlChange();
  };

  window.addEventListener('popstate', checkUrlChange);

  // Also poll for hash changes and frameworks that bypass history API
  setInterval(checkUrlChange, 1000);
})();
