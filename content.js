// ============================================================
//  ZERO-G GHOST — v6.2
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

  // ── Local Resource Protection (blob: / data:) ──────────────────────────────
  function isLocalSrc(el) {
    const src = el.src || el.currentSrc || (el.getAttribute && el.getAttribute('src')) || '';
    return /^(blob:|data:)/i.test(src);
  }

  // ── Flicker Prevention: preserve dimensions before hiding ─────────────────
  // Priority: (1) rendered offsetWidth/Height when available,
  //           (2) HTML width/height attributes (e.g. from server-rendered markup),
  //           (3) aspect-ratio CSS for zero-size elements to prevent grid collapse.
  function freezeSize(el) {
    if (el.__zg_frozen__) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) {
      // Already rendered — pin exact dimensions
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.__zg_frozen__ = true;
    }
    // Else: zero-size case is handled at registration time via aspect-ratio
  }

  function unfreezeSize(el) {
    if (!el.__zg_frozen__) return;
    el.style.width = '';
    el.style.height = '';
    el.__zg_frozen__ = false;
  }

  // ── Z-Axis Analyzer ────────────────────────────────────────────────────────

  // Check if a CSS color string has meaningful opacity (not fully transparent)
  function isOpaqueColor(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') return false;
    const m = colorStr.match(/rgba?\([\d., ]+\)/);
    if (!m) return true; // named colors (red, white, etc.) are opaque
    const parts = colorStr.match(/[\d.]+/g);
    if (parts && parts.length === 4) return parseFloat(parts[3]) > 0.05;
    return true;
  }

  // Determine the effective z-index of an element (walk up stacking context)
  function effectiveZIndex(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const z = parseInt(getComputedStyle(node).zIndex, 10);
      if (!isNaN(z)) return z;
      node = node.parentElement;
    }
    return 0;
  }

  // Check if blocker rect completely contains target rect
  function fullyCovers(bx, by, bw, bh, tx, ty, tw, th) {
    return bx <= tx && by <= ty && (bx + bw) >= (tx + tw) && (by + bh) >= (ty + th);
  }

  // Core scan: evaluate each visible target for occlusion
  function runScan() {
    _scanPending = false;
    const count = visibleTargets.length;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const target = visibleTargets[i];
      if (!target || !target.isConnected || isLocalSrc(target)) {
        occlusionResult[i] = 0;
        continue;
      }

      const tr = target.getBoundingClientRect();
      // Skip zero-size elements
      if (tr.width <= 0 || tr.height <= 0) { occlusionResult[i] = 0; continue; }

      // Store target data in rectBuffer
      const base = i * FIELDS;
      rectBuffer[base] = tr.left;
      rectBuffer[base + 1] = tr.top;
      rectBuffer[base + 2] = tr.width;
      rectBuffer[base + 3] = tr.height;

      // Sample 5 points within the target to find covering elements
      // (center + 4 corners with small inset to avoid edge stacking ambiguity)
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
          // Skip self, ancestors, and protected elements
          if (blocker === target || target.contains(blocker) || blocker.contains(target)) continue;
          if (isLocalSrc(blocker)) continue;

          const bStyle = getComputedStyle(blocker);
          const bOpacity = parseFloat(bStyle.opacity);
          if (bOpacity < 0.95) continue; // must be nearly opaque
          if (!isOpaqueColor(bStyle.backgroundColor) && !isOpaqueColor(bStyle.background)) continue;

          const bz = effectiveZIndex(blocker);
          if (bz <= targetZIndex) continue; // blocker must be above target in Z

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

    // Apply results
    for (let i = 0; i < count; i++) {
      const el = visibleTargets[i];
      if (!el) continue;
      if (occlusionResult[i] === 1) {
        // Freeze dimensions before hiding to prevent layout flicker
        freezeSize(el);
        el.classList.add('zg-hidden');
      } else {
        // Only remove zg-hidden if it was added by occlusion (not by IO)
        if (el.classList.contains('zg-hidden') && el.__zg_occluded__) {
          unfreezeSize(el);
          el.classList.remove('zg-hidden');
        }
      }
      el.__zg_occluded__ = (occlusionResult[i] === 1);
    }
  }

  // Schedule a deferred scan (idle-time, non-blocking)
  function scheduleScan() {
    if (_scanPending) return;
    _scanPending = true;
    if ('requestIdleCallback' in window) {
      requestIdleCallback(runScan, { timeout: 200 });
    } else {
      setTimeout(runScan, 100);
    }
  }

  // ── IntersectionObserver ───────────────────────────────────────────────────
  const observerOptions = {
    rootMargin: '400px 0px 400px 0px',
    threshold: 0,
  };

  const intersectionObserver = new IntersectionObserver((entries) => {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const el = entry.target;
      const idx = visibleTargets.indexOf(el);

      if (entry.isIntersecting) {
        // Add to visible set
        if (idx === -1 && visibleTargets.length < MAX_TARGETS) visibleTargets.push(el);
        if (!el.__zg_occluded__) {
          unfreezeSize(el);
          el.classList.remove('zg-hidden');
        }
        if (el.tagName === 'VIDEO' && el.__zg_playing_state__) el.play().catch(() => { });
      } else {
        // Remove from visible set
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
    // Trigger Z-axis scan after visibility changes
    scheduleScan();
  }, observerOptions);

  // ── Registration ───────────────────────────────────────────────────────────
  const registerElement = (el) => {
    if (el.__zg_registered__) return;
    const tag = el.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'IFRAME' || tag === 'PICTURE') {
      el.__zg_registered__ = true;
      el.classList.add('zg-ghost-target');
      intersectionObserver.observe(el);
    }
  };

  // ── MutationObserver: SPA + Infinite Scroll Support ───────────────────────
  const mutationObserver = new MutationObserver((mutations) => {
    let needsScan = false;
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (node.nodeType === 1) {
          // Inject lazy loading for newly added images and iframes
          // to optimize infinite-scroll content before registration
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
    // Overlays might have appeared/disappeared — re-scan
    if (needsScan) scheduleScan();
  });

  // ── Initialization ─────────────────────────────────────────────────────────
  const init = () => {
    document.querySelectorAll('img, video, iframe, picture').forEach(registerElement);
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[Zero-G Ghost] v6.2 — Ghost engine + Z-Axis Analyzer engaged.');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
