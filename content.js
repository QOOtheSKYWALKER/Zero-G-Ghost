// ============================================================
//  ZERO-G GHOST — v6.7 (Verified)
//  Ghost engine + Z-Axis Analyzer (Occlusion Detection)
// ============================================================
(function () {
  'use strict';
  if (window.__ZEROG_GHOST__) return;
  window.__ZEROG_GHOST__ = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const MAX_TARGETS = 512;
  const FIELDS = 6; // [x, y, w, h, zIndex, opacity]

  // Pre-allocated TypedArrays (GC-free)
  const rectBuffer = new Float32Array(MAX_TARGETS * FIELDS);
  const occlusionResult = new Uint8Array(MAX_TARGETS); // 0=visible, 1=occluded

  // Active targets tracked by IntersectionObserver
  const visibleTargets = []; // holds element refs, max MAX_TARGETS
  let _scanPending = false;
  let isTabPaused = false;

  // ── Dark mode: cached once, updated on system change ──────────────────────
  const _darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  let _isDark = _darkMQ.matches;

  // ── Local Resource Protection (blob: / data:) ──────────────────────────────
  function isLocalSrc(el) {
    const src = el.src || el.currentSrc || (el.getAttribute && el.getAttribute('src')) || '';
    return /^(blob:|data:)/i.test(src);
  }

  // ── Flicker Prevention: preserve dimensions before hiding ─────────────────
  function freezeSize(el) {
    if (el.__zg_frozen__) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) {
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.__zg_frozen__ = true;
    }
  }

  function unfreezeSize(el) {
    if (!el.__zg_frozen__) return;
    el.style.width = '';
    el.style.height = '';
    el.__zg_frozen__ = false;
  }

  // ── Z-Axis Analyzer ────────────────────────────────────────────────────────
  function isOpaqueColor(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') return false;
    const m = colorStr.match(/rgba?\([\d., ]+\)/);
    if (!m) return true;
    const parts = colorStr.match(/[\d.]+/g);
    if (parts && parts.length === 4) return parseFloat(parts[3]) > 0.05;
    return true;
  }

  function effectiveZIndex(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const z = parseInt(getComputedStyle(node).zIndex, 10);
      if (!isNaN(z)) return z;
      node = node.parentElement;
    }
    return 0;
  }

  function fullyCovers(bx, by, bw, bh, tx, ty, tw, th) {
    return bx <= tx && by <= ty && (bx + bw) >= (tx + tw) && (by + bh) >= (ty + th);
  }

  function runScan() {
    _scanPending = false;
    if (isTabPaused) return;
    const count = visibleTargets.length;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const target = visibleTargets[i];
      if (!target || !target.isConnected || isLocalSrc(target)) {
        occlusionResult[i] = 0;
        continue;
      }
      const tr = target.getBoundingClientRect();
      if (tr.width <= 0 || tr.height <= 0) { occlusionResult[i] = 0; continue; }

      const base = i * FIELDS;
      rectBuffer[base] = tr.left;
      rectBuffer[base + 1] = tr.top;
      rectBuffer[base + 2] = tr.width;
      rectBuffer[base + 3] = tr.height;

      const cx = tr.left + tr.width * 0.5;
      const cy = tr.top + tr.height * 0.5;
      const inset = 4;
      const samplePoints = [
        [cx, cy],
        [tr.left + inset, tr.top + inset],
        [tr.right - inset, tr.top + inset],
        [tr.left + inset, tr.bottom - inset],
        [tr.right - inset, tr.bottom - inset],
      ];

      const targetZIndex = effectiveZIndex(target);
      let blocked = false;
      for (let p = 0; p < samplePoints.length; p++) {
        const candidates = document.elementsFromPoint(samplePoints[p][0], samplePoints[p][1]);
        for (let c = 0; c < candidates.length; c++) {
          const blocker = candidates[c];
          if (blocker === target || target.contains(blocker) || blocker.contains(target)) continue;
          if (isLocalSrc(blocker)) continue;
          const bStyle = getComputedStyle(blocker);
          if (parseFloat(bStyle.opacity) < 0.95) continue;
          if (!isOpaqueColor(bStyle.backgroundColor) && !isOpaqueColor(bStyle.background)) continue;
          if (effectiveZIndex(blocker) <= targetZIndex) continue;
          const br = blocker.getBoundingClientRect();
          if (fullyCovers(br.left, br.top, br.width, br.height, tr.left, tr.top, tr.width, tr.height)) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
      occlusionResult[i] = blocked ? 1 : 0;
    }

    let anyHidden = false;
    for (let i = 0; i < count; i++) {
      const el = visibleTargets[i];
      if (!el) continue;
      if (occlusionResult[i] === 1) {
        freezeSize(el);
        el.classList.add('zg-hidden');
        anyHidden = true;
      } else {
        if (el.classList.contains('zg-hidden') && el.__zg_occluded__) {
          unfreezeSize(el);
          el.classList.remove('zg-hidden');
        }
      }
      el.__zg_occluded__ = (occlusionResult[i] === 1);
    }

    if (count >= MAX_TARGETS) sendStatus('alert');
    else sendStatus(anyHidden ? 'active' : 'idle');
  }

  function sendStatus(status) {
    if (isTabPaused && status !== 'paused') return;
    try {
      chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', status, isDark: _isDark });
    } catch (e) { }
  }

  function scheduleScan() {
    if (_scanPending || isTabPaused) return;
    _scanPending = true;
    if ('requestIdleCallback' in window) requestIdleCallback(runScan, { timeout: 200 });
    else setTimeout(runScan, 100);
  }

  // ── IntersectionObserver ───────────────────────────────────────────────────
  // Viewport-adaptive margin: 80% of screen height, clamped to [150, 600]px.
  // Avoids blank flashes on large displays and over-loading on mobile.
  const _margin = Math.round(Math.min(Math.max(window.innerHeight * 0.8, 150), 600));
  const _rootMargin = _margin + 'px 0px ' + _margin + 'px 0px';

  const intersectionObserver = new IntersectionObserver((entries) => {
    if (isTabPaused) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const el = entry.target;
      const idx = visibleTargets.indexOf(el);
      if (entry.isIntersecting) {
        if (idx === -1 && visibleTargets.length < MAX_TARGETS) visibleTargets.push(el);
        if (!el.__zg_occluded__) {
          unfreezeSize(el);
          el.classList.remove('zg-hidden');
        }
        if (el.tagName === 'VIDEO' && el.__zg_playing_state__) el.play().catch(() => { });
      } else {
        if (idx !== -1) { visibleTargets.splice(idx, 1); el.__zg_occluded__ = false; }
        if (isLocalSrc(el)) continue;
        freezeSize(el);
        el.classList.add('zg-hidden');
        if (el.tagName === 'VIDEO') {
          el.__zg_playing_state__ = !el.paused;
          el.pause();
        }
      }
    }
    scheduleScan();
  }, { rootMargin: _rootMargin, threshold: 0 });

  const registerElement = (el) => {
    if (el.__zg_registered__) return;
    const tag = el.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'IFRAME' || tag === 'PICTURE') {
      el.__zg_registered__ = true;
      el.classList.add('zg-ghost-target');
      intersectionObserver.observe(el);
    }
  };

  const mutationObserver = new MutationObserver((mutations) => {
    if (isTabPaused) return;
    let needsScan = false;
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (node.nodeType === 1) {
          if (node.tagName === 'IMG' || node.tagName === 'IFRAME') {
            if (!node.getAttribute('loading')) node.setAttribute('loading', 'lazy');
          }
          const lazyTargets = node.querySelectorAll('img, iframe');
          for (let k = 0; k < lazyTargets.length; k++) {
            if (!lazyTargets[k].getAttribute('loading')) lazyTargets[k].setAttribute('loading', 'lazy');
          }
          registerElement(node);
          const targets = node.querySelectorAll('img, video, iframe, picture');
          for (let k = 0; k < targets.length; k++) registerElement(targets[k]);
          needsScan = true;
        }
      }
    }
    if (needsScan) scheduleScan();
  });

  // ── Pause Support ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_PAUSE') {
      isTabPaused = !isTabPaused;
      if (isTabPaused) {
        document.querySelectorAll('.zg-ghost-target').forEach(el => {
          unfreezeSize(el); el.classList.remove('zg-hidden');
        });
        sendStatus('paused');
      } else {
        scheduleScan();
      }
    }
  });

  // ── Initialization ─────────────────────────────────────────────────────────
  const init = () => {
    document.querySelectorAll('img, video, iframe, picture').forEach(registerElement);
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

    // Update cached flag and notify background when system theme changes
    _darkMQ.addEventListener('change', e => {
      _isDark = e.matches;
      try { chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', isDark: _isDark }); } catch (e) { }
    });

    // Initial theme sync (covers pages with no observable elements)
    try { chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', isDark: _isDark }); } catch (e) { }

    console.log('[Zero-G Ghost] v6.7 — Ghost engine + Z-Axis Analyzer engaged.');
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
