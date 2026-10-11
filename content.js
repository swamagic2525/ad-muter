// Watches the player for ad indicators and reports ad start/end to the background worker,
// which does the actual tab muting.
(() => {
  const site = siteForHost(location.hostname);
  if (!site) return;

  const CHECK_INTERVAL_MS = 500;
  // Ads often come back to back with a short gap; wait before declaring the break over.
  const UNMUTE_DELAY_MS = site.unmuteDelayMs || 1500;
  const MAX_TEXT_LEN = 40;

  let debug = false;
  let adState = null; // null until the first report, so we always send an initial state
  let lastReason = null;
  let lastAdSeenAt = 0;

  const log = (...args) => debug && console.log('[Ad Muter]', ...args);

  chrome.storage.sync.get({ debug: false }, s => { debug = s.debug; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.debug) debug = changes.debug.newValue;
  });

  function isShown(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function mainVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = v; bestArea = area; }
    }
    return best;
  }

  const normalize = s => s.replace(/\s+/g, ' ').trim();

  function detect() {
    const video = mainVideo();
    if (!video) return null;

    for (const sel of site.adSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isShown(el) && normalize(el.textContent)) return `selector ${sel}`;
      }
    }

    if (site.hlsCues) {
      const reason = HlsCues.adReason(video);
      if (reason) return reason;
    }

    // Fallback: short "Ad"-style text drawn over the video.
    const videoRect = video.getBoundingClientRect();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const own = normalize(node.nodeValue);
      if (!own || own.length > MAX_TEXT_LEN) continue;
      const el = node.parentElement;
      if (!el) continue;
      // Labels are sometimes split across spans ("Ad" + "1 of 3"), so also try the parent's text.
      const whole = normalize(el.textContent);
      const texts = whole.length <= MAX_TEXT_LEN ? [own, whole] : [own];
      const hit = texts.find(t => AD_TEXT_PATTERNS.some(re => re.test(t)));
      if (hit && isShown(el) && overlaps(el.getBoundingClientRect(), videoRect)) {
        return `text "${hit}"`;
      }
    }
    return null;
  }

  function report(ad, reason) {
    try {
      chrome.runtime.sendMessage({ type: 'ad-state', siteId: site.id, ad, reason });
    } catch {
      // Extension was reloaded; this orphaned content script can't talk to it any more.
      clearInterval(timer);
    }
  }

  function tick() {
    const reason = detect();
    const now = Date.now();
    if (reason) { lastAdSeenAt = now; lastReason = reason; }
    const ad = !!reason || (adState === true && now - lastAdSeenAt < UNMUTE_DELAY_MS);
    if (ad !== adState) {
      adState = ad;
      log(ad ? `Ad started (${reason})` : 'Ad ended');
      report(ad, ad ? reason : null);
    }
  }

  // Everything short-texted that sits over the video, for tuning adSelectors.
  function snapshot() {
    const video = mainVideo();
    if (!video) return { site: site.name, url: location.href, video: false, elements: [] };
    const hls = site.hlsCues ? HlsCues.debugInfo(video) : undefined;
    const videoRect = video.getBoundingClientRect();
    const elements = [];
    for (const el of document.body.querySelectorAll('*')) {
      const ownText = normalize(
        Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.nodeValue).join(' ')
      );
      const aria = el.getAttribute('aria-label');
      if ((!ownText || ownText.length > 60) && !aria) continue;
      if (!isShown(el) || !overlaps(el.getBoundingClientRect(), videoRect)) continue;
      elements.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        class: (typeof el.className === 'string' ? el.className : '').slice(0, 150) || undefined,
        testid: el.getAttribute('data-testid') || undefined,
        aria: aria || undefined,
        text: ownText || undefined
      });
      if (elements.length >= 80) break;
    }
    return { site: site.name, url: location.href, video: true, adDetected: !!adState, lastReason, hls, elements };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'status') sendResponse({ siteId: site.id, siteName: site.name, ad: !!adState, reason: lastReason });
    if (msg.type === 'snapshot') sendResponse(snapshot());
  });

  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  tick();
})();
