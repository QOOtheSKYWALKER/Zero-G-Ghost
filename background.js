/**
 * ZERO-G GHOST — v6.5
 * Global Pause Toggle + Prohibited Mark Icon
 */

const GHOST_PATH = "M8,1C4.134,1,1,4.134,1,8v7c1.168,0,1.168-2,2.333-2s1.168,2,2.333,2s1.168-2,2.333-2s1.168,2,2.333,2s1.168-2,2.333-2s1.168,2,2.333,2V8C15,4.134,11.866,1,8,1z M6,8.25c-0.69,0-1.25-0.56-1.25-1.25s0.56-1.25,1.25-1.25s1.25,0.56,1.25,1.25S6.69,8.25,6,8.25z M10,8.25c-0.69,0-1.25-0.56-1.25-1.25s0.56-1.25,1.25-1.25s1.25,0.56,1.25,1.25S10.69,8.25,10,8.25z";

const COLORS = {
  active: '#00de00',
  alert: '#de0000',
  idleDark: '#dedede',
  idleLight: '#3a3a3a',
  prohibit: '#de0000'
};

let globalIsDark = false;

function createIconImageData(status, isDark, size = 32) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  const ghostStatus = (status === 'paused') ? 'idle' : status;
  let color = COLORS[ghostStatus];
  if (ghostStatus === 'idle') {
    color = isDark ? COLORS.idleDark : COLORS.idleLight;
  }

  ctx.clearRect(0, 0, size, size);
  const scale = size / 16;
  ctx.save();
  ctx.scale(scale, scale);

  // Draw Ghost
  const p = new Path2D(GHOST_PATH);
  ctx.fillStyle = color;
  ctx.fill(p);
  ctx.restore();

  // Draw Prohibited Mark if paused
  if (status === 'paused') {
    ctx.strokeStyle = COLORS.prohibit;
    ctx.lineWidth = size * 0.1;
    ctx.beginPath();
    const center = size / 2;
    const radius = size * 0.4;
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    const offset = radius * Math.cos(Math.PI / 4);
    ctx.moveTo(center - offset, center - offset);
    ctx.lineTo(center + offset, center + offset);
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}

function updateIcon(tabId, status, isDark) {
  const iconData = {
    "16": createIconImageData(status, isDark, 16),
    "32": createIconImageData(status, isDark, 32)
  };

  const params = { imageData: iconData };
  if (tabId) params.tabId = tabId;

  chrome.action.setIcon(params);

  // Badge handling
  if (tabId) {
    if (status === 'alert') {
      chrome.action.setBadgeText({ tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#de0000' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  }
}

// Global detection and message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'UPDATE_STATUS') {
    if (request.isDark !== undefined) {
      globalIsDark = request.isDark;
      // Update global default for all tabs (including those without content scripts)
      updateIcon(null, 'idle', globalIsDark);
    }
    if (sender.tab && request.status) {
      updateIcon(sender.tab.id, request.status, globalIsDark);
    }
    sendResponse({ received: true });
  }
});

// Toggle Pause State for Current Tab
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAUSE' }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => updateIcon(null, 'idle', globalIsDark));
chrome.runtime.onStartup.addListener(() => updateIcon(null, 'idle', globalIsDark));
