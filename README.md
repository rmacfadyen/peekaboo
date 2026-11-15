# Peekaboo

A Tampermonkey userscript for capturing screenshots, freehand annotations and spoken
explanations while using a web application by hand. A session is exported as a ZIP for an AI
coding agent to turn into automated tests (initially Playwright tests for RMTrackNext), but
nothing in it is specific to one application.

Plain JavaScript, no build step, no server, no dependencies. Chrome on Windows.

## Using it

Three controls sit in the bottom-left corner of every page:

| Control | What it does |
| --- | --- |
| Red circle | Takes a screenshot. The first click (and the first click after each full page load) shows Chrome's "share this tab" prompt; allow it. The first click of a session also asks for the microphone. A short two-tone sound marks each screenshot. `Alt+Shift+S` does the same without a click, which helps when clicking would close a menu in the application. |
| Green circle with a pen | Enabled after the first screenshot. Draw with the left mouse button held down; click **Done** (bottom-left) or press `Esc` to finish. The strokes are attached to the most recent screenshot. Optional. |
| **Export** | Appears once a session exists. Ends the session and downloads `peekaboo-<date>-<time>.zip`. The data is kept until the next session starts, so Export can be clicked again to download it a second time. |

A small label next to the buttons shows the screenshot count and whether the microphone is
recording. If the microphone is refused or missing, everything else keeps working.

A session survives reloads and navigation within the same site (same origin): screenshots,
strokes and audio are written to IndexedDB as they happen. After a full page load the
microphone resumes by itself as a new audio file, and the next red click asks to share the tab
again. That prompt is a Chrome restriction and cannot be avoided from a userscript. If the
session has been idle for more than 10 minutes it is kept but the microphone waits for the
next red click.

## What is in the ZIP

```
manifest.json                             everything below, indexed, with timing
screenshots/screenshot-001.png            original captures at the stream's native resolution
annotations/annotation-001.json           raw strokes for one annotation pass
annotated/screenshot-001-annotated.png    copy of a screenshot with its strokes drawn on
audio/narration-001.webm                  microphone audio; a new file after each page load
```

- **Timing.** Every `t` value is milliseconds since the session's `startedAt`, shared by
  screenshots, stroke points, audio segments and events. A moment `t` is at offset
  `t - segment.startT` in that segment's audio file.
- **Shutter sound.** Its time is `shutterSoundT` on each screenshot. Where a segment says
  `shutterSoundMixed: true` the sound is also mixed into the audio file itself.
- **Coordinates.** Stroke points are `[x, y, t]`, with x and y in CSS pixels from the
  top-left of the viewport. Each screenshot and annotation records the viewport size, device
  pixel ratio and scroll position. Multiply by `image.width / viewport.width` to get
  screenshot pixels.
- **Alignment.** `pageStateMatchesScreenshot: false` on an annotation means the URL, viewport
  size or scroll position changed after the screenshot, so the strokes may not line up.
- **Events.** `manifest.events` is the timeline: session start/end, page loads, in-app
  navigation, screenshots, annotation start/end, audio start/stop, capture errors.

## Development setup

The source lives in `src/`. `peekaboo.dev.user.js` is only a Tampermonkey header whose
`@require` lines load those files straight from disk, so a change is picked up by reloading
the page under test.

One-time setup. Chrome and Tampermonkey rename these controls from time to time, so the
labels below may differ slightly.

1. **Let Tampermonkey run scripts.** Go to `chrome://extensions`, find the Tampermonkey card
   and click its **Details** button (bottom-left of the card). Turn on the **Allow User
   Scripts** toggle, part-way down the page. On older Chrome versions there is no such
   toggle; turn on **Developer mode** instead (toggle in the top-right corner of
   `chrome://extensions`).
2. **Let Tampermonkey read local files.** On the same Details page, turn on **Allow access
   to file URLs** (a toggle further down the list).
3. **Install the dev script.** Click the Tampermonkey icon in Chrome's toolbar (a dark
   square with two circles; it may be hidden under the puzzle-piece Extensions icon at the
   right of the address bar) and choose **Create a new script...**. Replace everything in
   the editor with the contents of `peekaboo.dev.user.js` and save with `Ctrl+S`.
4. If the repository is not at `C:\Users\Robert\source\repos\peekaboo`, change the paths in
   the `@require` lines.
5. Open or reload any page. The red and green circles should appear bottom-left.

If edits to `src/` do not show up after a reload, Tampermonkey is serving a cached copy. Open
the Tampermonkey dashboard (toolbar icon, then **Dashboard**), go to the **Settings** tab,
set **Config mode** at the top to **Advanced**, and under **Externals** set **Update
Interval** to **Always**. If local files still fail to load, look on the same Settings tab
under **Security** for an option about allowing scripts to access local files and make sure
it includes externals (`@require`).

To switch Peekaboo off, click the Tampermonkey toolbar icon and flip the toggle beside
"Peekaboo (dev)".

### Source files

| File | Purpose |
| --- | --- |
| `src/config.js` | All settings: pen colour and width, shutter sound, hotkey, audio options, placement. |
| `src/store.js` | Key/value storage on IndexedDB. |
| `src/zip.js` | Minimal ZIP writer (stored, no compression). |
| `src/audio.js` | Microphone recording and the shutter sound. |
| `src/capture.js` | `getDisplayMedia()` stream and frame grabbing. |
| `src/annotate.js` | Drawing overlay. |
| `src/exporter.js` | Builds the manifest and the ZIP. |
| `src/main.js` | Controls, session state, wiring. Must load last. |

Each file is a self-contained function that attaches to one shared object
(`window.__peekaboo`), so load order is the only coupling between them.

## Making a standalone release

No build system. To produce an installable `peekaboo.user.js`:

1. Copy the header from `peekaboo.dev.user.js`, delete the `@require` lines, rename it
   (drop "(dev)") and bump `@version`.
2. Append the contents of the `src/` files below the header, in the order the `@require`
   lines list them.
3. Commit the result. Its raw GitHub URL installs directly in Tampermonkey; adding
   `@updateURL` / `@downloadURL` pointing at that URL enables automatic updates.

## Limitations

- Capture needs HTTPS or `localhost`; browsers do not offer it on plain-HTTP sites.
- A session belongs to one origin. Moving to a different host starts from nothing there.
- The controls cannot appear above a modal `<dialog>` or a fullscreen element; use
  `Alt+Shift+S` there.
- Clicking the red button can still close menus that close on any outside click; the hotkey
  avoids that.
- On a completely static page each screenshot hides the controls for up to 0.4 s while
  waiting for a fresh frame (`capture.freshFrameTimeoutMs` in `src/config.js`).
- Pages inside iframes do not get their own controls.
