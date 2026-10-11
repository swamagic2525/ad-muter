// Per-site ad detection config. Shared by content.js, background.js and popup.js.
//
// adSelectors: CSS selectors for elements that only exist (with text) while an ad plays.
//   These are the fast, precise path. Sites rename classes when they ship player updates,
//   so when detection breaks, this list is the thing to fix.
// unmuteDelayMs: how long to wait after the last ad indicator before unmuting (default 1500).
// hlsCues: also read SCTE-35 ad-break markers from the HLS playlist (see hls-cues.js). Needed for
//   live streams where the ads are part of the video and the page shows no "Ad" label.
// Text fallback: any short visible text on top of the video that matches AD_TEXT_PATTERNS
//   ("Ad", "Ad 0:15", "Ad 1 of 3", "Advertisement", ...) also counts as an ad.

const SITES = [
  {
    id: 'primevideo',
    name: 'Prime Video',
    hosts: [/(^|\.)primevideo\.com$/, /(^|\.)amazon\.(com|in|co\.uk)$/],
    // The "Ad 1:02" countdown is span.atvwebplayersdk-ad-timer-remaining-time (matched by the
    // wildcard below); it is removed from the page when the ad ends.
    adSelectors: [
      '.atvwebplayersdk-ad-timer-text',
      '.atvwebplayersdk-adtimeindicator-text',
      '[class*="atvwebplayersdk-ad-timer"]'
    ]
  },
  {
    id: 'hotstar',
    name: 'JioHotstar',
    hosts: [/(^|\.)hotstar\.com$/, /(^|\.)jiohotstar\.com$/],
    // Live cricket: ads are stitched into the stream with no on-page label, so rely on the
    // playlist cue markers. On-demand shows may still show an "Ad" label (text fallback).
    hlsCues: true,
    adSelectors: []
  },
  {
    id: 'sonyliv',
    name: 'Sony LIV',
    hosts: [/(^|\.)sonyliv\.com$/],
    // Pre-rolls and live mid-roll breaks both show an "AD 19" countdown label over the player.
    // (The live playlist marks breaks with EXT-X-DATERANGE, not CUE-OUT, so hlsCues isn't used.)
    adSelectors: ['.ad-label-text'],
    // The label drops out for ~2 s between back-to-back ads.
    unmuteDelayMs: 3000
  }
];

const AD_TEXT_PATTERNS = [
  // "Ad", "Ads", "Ad 0:15", "Ad · 0:15", "Ad 1 of 3", "Ad 1/3 · 0:15"
  /^ads?(\s*[:·•|-]?\s*\d+\s*(of|\/)\s*\d+)?(\s*[:·•|-]?\s*\d{1,2}:\d{2})?$/i,
  /^advertisement(\s*[:·•|-]?\s*\d{1,2}:\d{2})?$/i,
  /^sponsored$/i,
  /^(your )?(video|show|content|programme|program) will (resume|play|continue) (in|after|shortly)/i
];

function siteForHost(hostname) {
  return SITES.find(site => site.hosts.some(re => re.test(hostname))) || null;
}
