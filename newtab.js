/* ============================================================
   ZERO-G GHOST v6.5 — Newtab Logic
   ============================================================ */
'use strict';

// ── Cache Clear ───────────────────────────────────────────────────────────────

let paperInterval = null;

function openCacheDialog() {
  document.getElementById('cache-overlay').style.display = 'flex';
  document.getElementById('cache-status-text').textContent =
    'Clears cache, IndexedDB, and service workers. Cookies and local storage are preserved.';
  document.getElementById('cache-progress-bar').style.display = 'none';
  document.getElementById('cache-progress-fill').style.width = '0%';
  document.getElementById('cache-start-btn').disabled = false;
  document.getElementById('cache-cancel-btn').textContent = 'Cancel';
  document.getElementById('cache-cancel-btn').disabled = false;
  stopPapers();
}

function closeCacheDialog() {
  stopPapers();
  document.getElementById('cache-overlay').style.display = 'none';
}

function spawnPaper() {
  const stage = document.getElementById('flying-stage');
  const p = document.createElement('div');
  p.className = 'paper';
  p.style.marginTop = ((Math.random() - 0.5) * 18) + 'px';
  stage.appendChild(p);
  requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('fly')));
  setTimeout(() => p.remove(), 1000);
}

function startPapers() {
  stopPapers();
  spawnPaper();
  paperInterval = setInterval(spawnPaper, 280);
}

function stopPapers() {
  if (paperInterval) { clearInterval(paperInterval); paperInterval = null; }
  document.getElementById('flying-stage').querySelectorAll('.paper').forEach(p => p.remove());
}

function startCacheClear() {
  const startBtn  = document.getElementById('cache-start-btn');
  const cancelBtn = document.getElementById('cache-cancel-btn');
  const statusEl  = document.getElementById('cache-status-text');
  const progBar   = document.getElementById('cache-progress-bar');
  const progFill  = document.getElementById('cache-progress-fill');

  startBtn.disabled = cancelBtn.disabled = true;
  progBar.style.display = 'block';
  statusEl.textContent = 'Clearing browser cache…';
  startPapers();

  let pct = 0;
  const progressTimer = setInterval(() => {
    pct = Math.min(pct + Math.random() * 12, 90);
    progFill.style.width = pct + '%';
  }, 200);

  chrome.browsingData.remove({ since: 0 }, {
    cache: true, cacheStorage: true, indexedDB: true,
    fileSystems: true, serviceWorkers: true, formData: true,
  }, () => {
    clearInterval(progressTimer);
    stopPapers();
    progFill.style.width = '100%';
    statusEl.textContent = chrome.runtime.lastError
      ? '⚠ Error: ' + chrome.runtime.lastError.message
      : '✅ Done! Cache, IndexedDB, Service Workers and form data cleared.';
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    setStatus('Cache cleared — Zero-G Ghost');
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(raw) {
  raw = raw.trim();
  if (!raw) return;
  if (!raw.includes('.') && !raw.startsWith('http'))
    raw = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
  else if (!/^https?:\/\//i.test(raw))
    raw = 'https://' + raw;
  window.location.href = raw;
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

// ── Bindings ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('url-input');

  document.getElementById('btn-go').addEventListener('click', () => navigate(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') navigate(input.value); });

  document.querySelectorAll('[data-url]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.url); });
  });

  document.getElementById('btn-cache')        .addEventListener('click', openCacheDialog);
  document.getElementById('cache-start-btn')  .addEventListener('click', startCacheClear);
  document.getElementById('cache-cancel-btn') .addEventListener('click', closeCacheDialog);
  document.getElementById('cache-close-x')    .addEventListener('click', closeCacheDialog);

  setTimeout(() => input.focus(), 100);
  // Sync theme
  const syncTheme = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_STATUS',
      isDark: window.matchMedia('(prefers-color-scheme: dark)').matches
    });
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
  syncTheme();

  setStatus('Ready — Zero-G Ghost v6.5');
});
