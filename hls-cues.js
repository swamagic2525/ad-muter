// Ad detection from HLS playlist cue tags, for live streams where ads are stitched into
// the video itself and nothing on the page changes (e.g. JioHotstar live cricket).
//
// Broadcasters mark ad breaks in the media playlist with SCTE-35 tags:
//   #EXT-X-CUE-OUT:15.040                          break starts, 15.04 s long
//   #EXT-X-CUE-OUT-CONT:...ElapsedTime=5.1,Duration=15.04...   still in the break
//   #EXT-X-CUE-IN                                  back to the programme
// We re-fetch the playlist the player is using, note which segments fall inside a break,
// then work out which segment is on screen from how far the playhead is behind the buffer end.
const HlsCues = (() => {
  const POLL_MS = 3000;
  const PLAYLIST_STALE_MS = 15000;
  const RECENT_SEGMENTS = 30;

  // url -> { lastSeen, segments: [{ name, dur, ad, label }] }
  const playlists = new Map();
  const recentSegments = []; // segment file names, oldest first
  let started = false;

  const fileName = url => {
    try { return new URL(url, location.href).pathname.split('/').pop(); } catch { return ''; }
  };

  function onResource(entry) {
    const name = fileName(entry.name);
    if (/\.m3u8$/i.test(name)) {
      const p = playlists.get(entry.name) || { segments: [] };
      p.lastSeen = Date.now();
      playlists.set(entry.name, p);
    } else if (/\.(ts|m4s|aac|mp4|m4v|m4a)$/i.test(name)) {
      const i = recentSegments.indexOf(name);
      if (i >= 0) recentSegments.splice(i, 1);
      recentSegments.push(name);
      if (recentSegments.length > RECENT_SEGMENTS) recentSegments.shift();
    }
  }

  // "CAID=0x423A50..." is hex-encoded text like "B:P4Inning2Over20,T:Over,S:20,..."
  function caidLabel(line) {
    const m = line.match(/CAID=0x([0-9a-f]+)/i);
    if (!m) return null;
    const text = m[1].match(/../g).map(h => String.fromCharCode(parseInt(h, 16))).join('');
    return /^[\x20-\x7e]+$/.test(text) ? text : null;
  }

  function parse(text) {
    // Master playlists list variants, not segments.
    if (!text.startsWith('#EXTM3U') || text.includes('#EXT-X-STREAM-INF')) return null;
    const segments = [];
    let dur = 0;
    let inCue = false;
    let cueLeft = Infinity; // seconds of the current break not yet covered by segments
    let label = null;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-CUE-OUT-CONT')) {
        const elapsed = parseFloat((line.match(/ElapsedTime=([\d.]+)/) || [])[1]);
        const total = parseFloat((line.match(/Duration=([\d.]+)/) || [])[1]);
        inCue = true;
        if (isFinite(elapsed) && isFinite(total)) cueLeft = total - elapsed;
        label = caidLabel(line) || label;
      } else if (line.startsWith('#EXT-X-CUE-OUT')) {
        const total = parseFloat(line.split(':')[1]);
        inCue = true;
        cueLeft = isFinite(total) ? total : Infinity;
      } else if (line.startsWith('#EXT-X-CUE-IN')) {
        inCue = false;
      } else if (line.startsWith('#EXT-X-ASSET')) {
        label = caidLabel(line) || label;
      } else if (line.startsWith('#EXTINF:')) {
        dur = parseFloat(line.slice(8)) || 0;
      } else if (!line.startsWith('#')) {
        // A break with no CUE-IN yet ends once its announced duration is used up.
        const ad = inCue && cueLeft > 0.05;
        segments.push({ name: fileName(line), dur, ad, label: ad ? label : null });
        if (inCue) cueLeft -= dur;
      }
    }
    return segments;
  }

  async function poll() {
    const now = Date.now();
    for (const [url, p] of playlists) {
      if (now - p.lastSeen > PLAYLIST_STALE_MS) { playlists.delete(url); continue; }
      try {
        const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) continue;
        const segments = parse(await res.text());
        if (segments) p.segments = segments;
        else playlists.delete(url); // master playlist; ignore from now on
      } catch {
        // Network hiccup; try again next poll.
      }
    }
  }

  function start() {
    if (started) return;
    started = true;
    // An observer still sees new entries after the page's resource-timing buffer fills up.
    new PerformanceObserver(list => list.getEntries().forEach(onResource))
      .observe({ type: 'resource', buffered: true });
    setInterval(poll, POLL_MS);
  }

  // The newest downloaded segment ends at the buffer end; step back from it by however far
  // the playhead trails the buffer end to find the segment on screen.
  function currentSegment(video) {
    const b = video.buffered;
    let bufferEnd = null;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= video.currentTime + 0.5 && video.currentTime <= b.end(i)) bufferEnd = b.end(i);
    }
    if (bufferEnd === null) return null;
    for (let r = recentSegments.length - 1; r >= 0; r--) {
      for (const p of playlists.values()) {
        let i = p.segments.findIndex(s => s.name === recentSegments[r]);
        if (i < 0) continue;
        let behind = bufferEnd - video.currentTime;
        while (i > 0 && behind > p.segments[i].dur) { behind -= p.segments[i].dur; i--; }
        return p.segments[i];
      }
    }
    return null;
  }

  function adReason(video) {
    start();
    const seg = currentSegment(video);
    if (!seg || !seg.ad) return null;
    return `HLS ad cue${seg.label ? ` (${seg.label})` : ''}`;
  }

  function debugInfo(video) {
    const seg = video ? currentSegment(video) : null;
    return {
      playlists: [...playlists.values()].map(p => ({
        segments: p.segments.length,
        adSegments: p.segments.filter(s => s.ad).length
      })),
      recentSegment: recentSegments[recentSegments.length - 1] || null,
      onScreen: seg ? { name: seg.name, ad: seg.ad, label: seg.label } : null
    };
  }

  return { adReason, debugInfo };
})();
