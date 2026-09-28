# EyeJam — beats on Meta Ray-Ban Display

A pocket groovebox for Meta Ray-Ban Display glasses. Program drums, 808s and keys on a 16-step grid with the Meta Neural Band, chain patterns into a song, and export a WAV.

- 6 tracks: Kick, Snare, Hat, Perc, Bass, Keys
- Synthesized drums (punch kick, 808 kick, snare, clap, rim, hats, shaker, tom)
- Melodic sounds from the **g-WAVE** synth (Cosmic Keys, Void Bass, Dark Pluck, Starfall Lead, multisampled from gWAVE-MPC) plus a saturated 808 and synth bass/stab
- Notes are locked to the key (minor, major, minor pentatonic, dorian, phrygian), so everything you enter is in tune
- BPM, swing, per-track volume / mute / solo / octave
- 4 patterns (A–D), copy, clear, and Song mode that chains every pattern with notes
- Export to WAV (shares the file when the device supports it, otherwise downloads)
- Your project saves automatically on the device
- Opens with a starter boom-bap beat so ▶ does something straight away

No build step. Plain HTML/CSS/JS.

## Controls (Neural Band)

| Where | Gesture | Does |
|---|---|---|
| Anywhere | Swipe ◀ ▶ ▲ ▼ | Move around the grid and buttons |
| Drum step | Pinch | Add / remove a hit |
| Melodic step | Pinch | Add a note (or edit an existing one) |
| Editing a note | Swipe ▲ ▼ | Change the note (stays in key) |
| Editing a note | Swipe ◀ ▶ | Change how long it holds |
| Editing a note | Pinch | Done |
| Editing a note | Back | Delete it |
| Track name (left column) | Pinch | Sound, volume, octave, mute, solo, clear |
| BPM / Swing / Key | Pinch, then swipe | Change it (pinch again when done) |
| A B C D | Pinch | Edit that pattern |
| LOOP / SONG | Pinch | Loop the pattern you're on, or play every pattern with notes in order |
| ⧉ Copy | Pinch | Copy this pattern into the next one (build variations fast) |
| ✕ Clear | Pinch twice | Clear this pattern |
| ⤓ | Pinch | Export a WAV |

New notes on a track start from the last note and length you used there.

## Run it locally

```bash
python3 -m http.server 8620
```

Open http://localhost:8620 in Chrome. The arrow keys stand in for band swipes, Enter for a pinch, Escape for back, and Space plays/stops. You can also click cells and buttons. For a realistic preview, use Meta's **Ray-Ban Display Simulator** Chrome extension.

## Put it on the glasses

1. It's live at https://eyejam.vercel.app (redeploy with `vercel deploy --prod`).
2. In the Meta AI app, turn on developer mode for your glasses and add the web app by URL. See [Meta's web app docs](https://wearables.developer.meta.com/docs/develop/webapps).

## Files

| File | What |
|---|---|
| `app.js` | Grid, buttons, track menu, gestures, playhead |
| `engine.js` | Project model, scheduler (Web Audio clock, 120 ms lookahead), song order, WAV export |
| `sounds.js` | Drum synths, 808, sample playback for the g-WAVE instruments |
| `samples/` | g-WAVE multisamples: a few root notes per instrument, trimmed and AAC-compressed (360 KB total) |

To add another g-WAVE instrument, convert a few root notes from `gWAVE-MPC/out/<instrument>/` into `samples/<name>-<root>.m4a`, list the roots in `SAMPLE_SETS` in `sounds.js`, and add an entry to `MELODIC`.
