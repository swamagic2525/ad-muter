# Ad Muter (Prime Video, JioHotstar & Sony LIV)

Mutes the tab while an ad plays and unmutes it when the show comes back.

## Install
1. Download this repo (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `ad-muter` folder.
4. Refresh any streaming tab that was already open.
5. Pin the extension so you can see the red `AD` badge while it mutes.

## How it detects ads
- `sites.js` lists CSS selectors per site (fast path) plus text patterns ("Ad", "Ad 0:15",
  "Ad 1 of 3", "Advertisement", "Your video will resume in…").
- Text only counts if it is visible and drawn over the video, so "Ad" elsewhere on the page is ignored.
- JioHotstar live streams (e.g. cricket) stitch ads into the video with no on-page label.
  For those, `hls-cues.js` re-reads the stream's HLS playlist and mutes during segments marked
  with SCTE-35 ad-break tags (`#EXT-X-CUE-OUT` … `#EXT-X-CUE-IN`), timed to what's on screen.
- Sony LIV shows an "AD 19" countdown label for both pre-rolls and live ad breaks; that label is the trigger.
- After the last ad indicator disappears it waits 1.5 s (3 s on Sony LIV) before unmuting, to cover gaps between ads.

## If an ad isn't muted
While the ad is playing, open the popup, click **Capture player**, then **Copy**, and add the
selector for the ad label to `adSelectors` in `sites.js`. Reload the extension on `chrome://extensions`.

## Behaviour notes
- It only unmutes tabs it muted itself. If you mute or unmute the tab yourself during an ad, it leaves it alone.
- Turn it off globally or for a site from the popup; any tab it muted is unmuted right away.

## Known limitations
- Chrome only.
- Channel promos baked into a live feed with no ad label or stream marker are not muted.
- Sites rename their player classes from time to time; when detection breaks, `sites.js` is the file to fix.
- It mutes your own tab. It does not block, skip or remove ads.
