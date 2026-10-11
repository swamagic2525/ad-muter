const DEFAULT_SETTINGS = { enabled: true, sites: {}, debug: false };
const $ = id => document.getElementById(id);

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const { mutedCount = 0 } = await chrome.storage.local.get('mutedCount');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $('enabled').checked = settings.enabled;
  $('debug').checked = settings.debug;
  $('count').textContent = `Ads muted so far: ${mutedCount}`;

  $('enabled').addEventListener('change', e => chrome.storage.sync.set({ enabled: e.target.checked }));
  $('debug').addEventListener('change', e => chrome.storage.sync.set({ debug: e.target.checked }));

  const status = tab && await chrome.tabs.sendMessage(tab.id, { type: 'status' }).catch(() => null);
  if (!status) {
    $('status').textContent = 'Open Prime Video, JioHotstar or Sony LIV to use this.';
    return;
  }

  $('site-name').textContent = status.siteName;
  $('site-toggle-label').hidden = false;
  $('capture-section').hidden = false;
  $('site-enabled').checked = settings.sites[status.siteId] !== false;
  $('site-enabled').addEventListener('change', async e => {
    const { sites } = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    await chrome.storage.sync.set({ sites: { ...sites, [status.siteId]: e.target.checked } });
  });

  if (status.ad) {
    $('status').textContent = tab.mutedInfo?.muted ? 'Ad playing: tab muted' : 'Ad playing (not muted)';
    $('status').className = 'status ad';
  } else {
    $('status').textContent = 'No ad detected';
    $('status').className = 'status ok';
  }

  $('capture').addEventListener('click', async () => {
    const snap = await chrome.tabs.sendMessage(tab.id, { type: 'snapshot' }).catch(err => ({ error: String(err) }));
    $('capture-text').value = JSON.stringify(snap, null, 2);
    $('capture-out').hidden = false;
  });
  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('capture-text').value);
    $('copy').textContent = 'Copied';
  });
}

init();
