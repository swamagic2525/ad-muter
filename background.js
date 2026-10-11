// Mutes/unmutes tabs based on ad-state reports from content.js.
// Only unmutes tabs it muted itself, and backs off if the user touches the mute button.
importScripts('sites.js');

const DEFAULT_SETTINGS = { enabled: true, sites: {}, debug: false };

// Service workers restart often, so per-tab state lives in storage.session:
//   adTabs:    { [tabId]: { siteId, reason } } tabs currently showing an ad
//   mutedTabs: { [tabId]: true }               tabs this extension muted
async function loadState() {
  const { adTabs = {}, mutedTabs = {} } = await chrome.storage.session.get(['adTabs', 'mutedTabs']);
  return { adTabs, mutedTabs };
}

// Serialize updates so overlapping events can't clobber each other's state.
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch(err => console.error('[Ad Muter]', err));
  return queue;
}

function siteEnabled(settings, siteId) {
  return settings.enabled && settings.sites[siteId] !== false;
}

async function setMuted(tabId, muted) {
  try {
    await chrome.tabs.update(tabId, { muted });
  } catch {
    // Tab already closed.
  }
}

async function setBadge(tabId, on) {
  try {
    await chrome.action.setBadgeText({ tabId, text: on ? 'AD' : '' });
    if (on) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  } catch {}
}

// Bring one tab's mute state in line with (ad playing && site enabled).
async function apply(tabId, settings, state) {
  const info = state.adTabs[tabId];
  const want = !!info && siteEnabled(settings, info.siteId);

  if (want && !state.mutedTabs[tabId]) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && !tab.mutedInfo?.muted) {
      await setMuted(tabId, true);
      state.mutedTabs[tabId] = true;
      const { mutedCount = 0 } = await chrome.storage.local.get('mutedCount');
      await chrome.storage.local.set({ mutedCount: mutedCount + 1 });
    }
  } else if (!want && state.mutedTabs[tabId]) {
    await setMuted(tabId, false);
    delete state.mutedTabs[tabId];
  }
  await setBadge(tabId, !!state.mutedTabs[tabId]);
}

async function reconcileAll() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const state = await loadState();
  const tabIds = new Set([...Object.keys(state.adTabs), ...Object.keys(state.mutedTabs)].map(Number));
  for (const tabId of tabIds) await apply(tabId, settings, state);
  await chrome.storage.session.set(state);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'ad-state' || !sender.tab) return;
  const tabId = sender.tab.id;
  enqueue(async () => {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const state = await loadState();
    if (msg.ad) state.adTabs[tabId] = { siteId: msg.siteId, reason: msg.reason };
    else delete state.adTabs[tabId];
    if (settings.debug) console.log('[Ad Muter]', `tab ${tabId}`, msg.ad ? `ad (${msg.reason})` : 'no ad');
    await apply(tabId, settings, state);
    await chrome.storage.session.set(state);
  });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  // User muted or unmuted the tab themselves: their choice wins, stop managing it.
  if (change.mutedInfo?.reason === 'user') {
    enqueue(async () => {
      const state = await loadState();
      if (!state.mutedTabs[tabId]) return;
      delete state.mutedTabs[tabId];
      await chrome.storage.session.set(state);
      await setBadge(tabId, false);
    });
  }
  // Navigated off a supported site mid-ad: no content script left to report the ad ended.
  if (change.url) {
    let host = '';
    try { host = new URL(change.url).hostname; } catch {}
    if (!siteForHost(host)) {
      enqueue(async () => {
        const state = await loadState();
        if (!state.adTabs[tabId] && !state.mutedTabs[tabId]) return;
        delete state.adTabs[tabId];
        const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        await apply(tabId, settings, state);
        await chrome.storage.session.set(state);
      });
    }
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(async () => {
    const state = await loadState();
    delete state.adTabs[tabId];
    delete state.mutedTabs[tabId];
    await chrome.storage.session.set(state);
  });
});

// Turning the extension or a site off mid-ad unmutes right away; turning it on mutes right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.enabled || changes.sites)) enqueue(reconcileAll);
});
