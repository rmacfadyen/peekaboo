// Peekaboo — controls, session state and wiring. Loaded last.
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});
  if (P.started || window.top !== window) return; // once per page, top frame only
  P.started = true;

  const { store, pad, config } = P;
  const report = (err) => console.error('[Peekaboo]', err);

  let session = null; // see startSession() for the shape
  let busy = false; // a screenshot or export is in progress
  let endAnnotation = null; // function while annotation mode is active
  let annotationSaved = Promise.resolve(); // the last annotation's write, so export can wait for it
  let micStarting = false;
  let writes = Promise.resolve(); // chain of audio chunk writes, so export can wait for them

  // Session clock: wall-clock ms since the session started. Survives page reloads,
  // unlike performance.now().
  const now = () => Date.now() - session.startedAtEpochMs;
  const active = () => !!session && session.status === 'active';
  const save = () => store.set('session', session).catch(report);

  function pageState() {
    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
    };
  }

  function logEvent(type, extra) {
    session.events.push({ type, t: now(), url: location.href, ...extra });
  }

  // ---------------------------------------------------------------- UI

  const host = document.createElement('div');
  host.id = 'peekaboo-host';
  const root = host.attachShadow({ mode: 'open' });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const bar = el('div', 'bar');
  const shotButton = el('button', 'round shot');
  const penButton = el('button', 'round pen', '✎');
  const exportButton = el('button', 'export', 'Export');
  const status = el('span', 'status');
  const toastBox = el('div', 'toast');
  let toastTimer = 0;

  function buildUi() {
    const { offsetPx: o, buttonSizePx: s, zIndex: z } = config.ui;
    // A constructed stylesheet is not subject to the page's style-src CSP.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; }
      .bar, .toast, .done { position: fixed; left: ${o}px; z-index: ${z}; font: 11px/1 system-ui, sans-serif; }
      .bar { bottom: ${o}px; display: flex; gap: 6px; align-items: center; }
      [hidden] { display: none !important; }
      button { cursor: pointer; padding: 0; margin: 0; font: inherit; }
      button:disabled { cursor: default; opacity: .35; }
      .round { width: ${s}px; height: ${s}px; border-radius: 50%; border: 2px solid #fff; color: #fff;
               box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 1px 4px rgba(0,0,0,.4); font-size: ${Math.round(s * 0.55)}px; }
      .shot { background: #e0262b; }
      .pen { background: #1fa53c; }
      .export, .done { height: ${s}px; padding: 0 8px; border-radius: ${s / 2}px; border: 2px solid #fff;
               background: #444; color: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 1px 4px rgba(0,0,0,.4); }
      .done { bottom: ${o}px; background: #1fa53c; font-weight: 600; }
      .status { color: #fff; background: rgba(0,0,0,.6); padding: 4px 7px; border-radius: 9px; user-select: none; }
      .toast { bottom: ${o + s + 10}px; max-width: 340px; padding: 7px 10px; border-radius: 6px;
               background: rgba(20,20,20,.92); color: #fff; font-size: 12px; line-height: 1.4; }
      .overlay { position: fixed; left: 0; top: 0; z-index: ${z - 1}; touch-action: none; }
    `);
    root.adoptedStyleSheets = [sheet];

    shotButton.title = 'Peekaboo: take a screenshot (Alt+Shift+S)';
    penButton.title = 'Peekaboo: annotate the last screenshot';
    exportButton.title = 'Peekaboo: finish the session and download the ZIP';
    toastBox.hidden = true;
    bar.append(shotButton, penButton, exportButton, status);
    root.append(bar, toastBox);

    shotButton.addEventListener('click', takeScreenshot);
    penButton.addEventListener('click', startAnnotation);
    exportButton.addEventListener('click', finishAndExport);

    // Keep the page from reacting to interaction with Peekaboo, and keep focus where it was.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick']) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }
    bar.addEventListener('mousedown', (event) => event.preventDefault());

    document.documentElement.append(host);
  }

  function render() {
    const shots = session ? session.screenshots.length : 0;
    shotButton.disabled = busy || !!endAnnotation;
    penButton.disabled = busy || !active() || shots === 0;
    exportButton.hidden = !session;
    exportButton.disabled = busy;
    status.hidden = !session;
    if (session) {
      const mic = P.audio.isRecording() ? 'mic on' : 'mic off';
      status.textContent = active()
        ? `${shots} shot${shots === 1 ? '' : 's'} · ${mic}`
        : `finished · ${shots} shot${shots === 1 ? '' : 's'}`;
    }
  }

  function toast(message, ms = 5000) {
    toastBox.textContent = message;
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastBox.hidden = true), ms);
  }

  const hideUi = () => (host.style.visibility = 'hidden');
  const showUi = () => (host.style.visibility = '');

  // ---------------------------------------------------------------- session

  async function startSession() {
    await writes;
    await store.clear(); // drops any previous (finished) session
    const started = Date.now();
    session = {
      formatVersion: 1,
      id: 'pk-' + started.toString(36),
      status: 'active', // 'active' | 'finished'
      startedAtEpochMs: started,
      startedAt: new Date(started).toISOString(),
      endedAt: null,
      userAgent: navigator.userAgent,
      screenshots: [],
      annotations: [], // index entries; strokes live under annotation-NNN
      audio: { status: 'not-requested', segments: [] },
      events: []
    };
    logEvent('sessionStart');
    await store.set('heartbeat', started);
    await save();
  }

  // ---------------------------------------------------------------- microphone

  async function startMic() {
    if (!config.audio.enabled || micStarting || P.audio.isRecording()) return;
    if (session.audio.status === 'denied' || session.audio.status === 'unavailable') return;
    micStarting = true;
    const owner = session;
    const index = owner.audio.segments.length + 1;
    const segment = {
      index,
      file: `audio/narration-${pad(index, 3)}.webm`,
      mimeType: null,
      shutterSoundMixed: false,
      startT: null,
      endT: null
    };
    let chunk = 0;

    const result = await P.audio.start({
      onStart: () => {
        segment.startT = now();
        logEvent('audioStart', { segment: index });
        save();
        render();
      },
      onChunk: (blob) => {
        if (session !== owner) return;
        const key = `audio-${pad(index, 3)}-${pad(++chunk, 6)}`;
        segment.endT = now();
        writes = writes.then(() => store.set(key, blob)).catch(report);
        save();
      },
      onEnded: () => {
        if (session !== owner) return;
        logEvent('audioEnded', { segment: index });
        save();
        render();
        toast('Microphone stopped. Screenshots and annotations still work.');
      }
    });
    micStarting = false;

    if (session !== owner || !active()) {
      if (result.ok) P.audio.stop();
      return;
    }
    if (result.ok) {
      segment.mimeType = result.mimeType;
      segment.shutterSoundMixed = result.shutterSoundMixed;
      session.audio.segments.push(segment);
      session.audio.status = 'recording';
    } else {
      session.audio.status = result.error === 'NotAllowedError' ? 'denied' : 'unavailable';
      session.audio.error = result.error;
      logEvent('audioUnavailable', { error: result.error });
      toast(`Microphone not available (${result.error}). Continuing without narration.`);
    }
    save();
    render();
  }

  // ---------------------------------------------------------------- screenshots

  function onCaptureEnded() {
    if (active()) {
      logEvent('captureEnded');
      save();
    }
    toast('Tab sharing stopped. The red button will ask for permission again.');
  }

  async function takeScreenshot() {
    if (busy || endAnnotation) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast('Screen capture is not available on this page (it needs HTTPS or localhost).');
      return;
    }
    busy = true;
    render();
    try {
      let captureStarted = false;
      if (!P.capture.hasStream()) {
        // Nothing may be awaited before this call: it needs the click's user activation.
        try {
          await P.capture.acquire(onCaptureEnded);
          captureStarted = true;
        } catch (err) {
          toast(
            err.name === 'NotAllowedError'
              ? 'Screen capture was cancelled or not permitted.'
              : `Screen capture failed: ${err.message || err.name}`
          );
          if (active()) {
            logEvent('captureError', { error: err.name });
            save();
          }
          return;
        }
      }
      if (!active()) await startSession();
      if (captureStarted) logEvent('captureStarted');
      startMic(); // not awaited: screenshots must not depend on the microphone

      const index = session.screenshots.length + 1;
      const state = pageState(); // before hiding, in case hiding changes layout
      let t = null;
      const shot = await P.capture.grab(hideUi, (copied) => {
        showUi();
        if (copied) {
          t = now();
          P.audio.playShutter();
        }
      });

      const entry = {
        index,
        file: `screenshots/screenshot-${pad(index, 3)}.png`,
        t,
        shutterSoundT: t,
        time: new Date(session.startedAtEpochMs + t).toISOString(),
        ...state,
        image: { width: shot.width, height: shot.height },
        displaySurface: shot.displaySurface
      };
      await store.set(`shot-${pad(index, 3)}`, shot.blob);
      session.screenshots.push(entry);
      logEvent('screenshot', { index });
      await save();
      if (shot.displaySurface && shot.displaySurface !== 'browser') {
        toast('A window or screen is being shared instead of this tab, so annotations will not line up.');
      }
    } catch (err) {
      report(err);
      toast(`Screenshot failed: ${err.message || err}`);
    } finally {
      showUi();
      busy = false;
      render();
    }
  }

  // ---------------------------------------------------------------- annotation

  function startAnnotation() {
    if (busy || endAnnotation || !active() || !session.screenshots.length) return;
    const startT = now();
    logEvent('annotationStart');
    bar.hidden = true;
    endAnnotation = P.annotate.start({
      root,
      now,
      onDone: (strokes) => {
        endAnnotation = null;
        bar.hidden = false;
        annotationSaved = finishAnnotation(startT, strokes).catch(report);
      }
    });
    render();
  }

  async function finishAnnotation(startT, strokes) {
    const shot = session.screenshots[session.screenshots.length - 1];
    const state = pageState();
    if (strokes.length) {
      const index = session.annotations.length + 1;
      const file = `annotations/annotation-${pad(index, 3)}.json`;
      const annotation = {
        index,
        file,
        screenshotIndex: shot.index,
        screenshotFile: shot.file,
        startT,
        endT: now(),
        ...state,
        pageStateMatchesScreenshot:
          state.url === shot.url &&
          state.viewport.width === shot.viewport.width &&
          state.viewport.height === shot.viewport.height &&
          state.scroll.x === shot.scroll.x &&
          state.scroll.y === shot.scroll.y,
        coordinateSpace: 'css-viewport-px',
        stroke: { ...config.stroke },
        strokes
      };
      await store.set(`annotation-${pad(index, 3)}`, annotation);
      session.annotations.push({
        index,
        file,
        screenshotIndex: shot.index,
        startT,
        endT: annotation.endT,
        strokeCount: strokes.length,
        pageStateMatchesScreenshot: annotation.pageStateMatchesScreenshot
      });
      logEvent('annotationEnd', { index, strokeCount: strokes.length });
    } else {
      logEvent('annotationEnd', { strokeCount: 0 });
    }
    await save();
    render();
  }

  // ---------------------------------------------------------------- export

  async function finishAndExport() {
    if (busy || !session) return;
    if (endAnnotation) endAnnotation();
    busy = true;
    render();
    try {
      await annotationSaved;
      if (active()) {
        await P.audio.stop();
        await writes;
        P.capture.release();
        logEvent('sessionEnd');
        session.status = 'finished';
        session.endedAt = new Date().toISOString();
        if (session.audio.status === 'recording') session.audio.status = 'recorded';
        await save();
      }
      toast('Building ZIP…', 60000);
      const blob = await P.exporter.build(session);
      const stamp = session.startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `peekaboo-${stamp}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      toast('Session exported. Export downloads it again; the red button starts a new session.', 8000);
    } catch (err) {
      report(err);
      toast(`Export failed: ${err.message || err}`);
    } finally {
      busy = false;
      render();
    }
  }

  // ---------------------------------------------------------------- startup

  async function init() {
    buildUi();
    try {
      session = (await store.get('session')) || null;
    } catch (err) {
      report(err);
    }

    if (active()) {
      // Resume after a reload or navigation. The capture stream is gone (the red button
      // will ask again); the microphone restarts by itself if the session is recent.
      const lastAlive = (await store.get('heartbeat').catch(() => 0)) || 0;
      const recent = Date.now() - lastAlive < config.autoResumeWindowMs;
      logEvent('pageLoad', { autoResumed: recent });
      save();
      if (recent && session.audio.status === 'recording') startMic();
    }
    render();

    setInterval(() => {
      if (active()) store.set('heartbeat', Date.now()).catch(report);
    }, 5000);

    // In-app (SPA) navigation: note the new URL on the timeline.
    if (window.navigation) {
      window.navigation.addEventListener('currententrychange', () => {
        if (active()) {
          logEvent('navigation');
          save();
        }
      });
    }

    const hotkey = config.screenshotHotkey;
    if (hotkey) {
      window.addEventListener(
        'keydown',
        (event) => {
          if (
            event.code === hotkey.code &&
            event.altKey === !!hotkey.altKey &&
            event.shiftKey === !!hotkey.shiftKey &&
            event.ctrlKey === !!hotkey.ctrlKey &&
            !event.repeat
          ) {
            event.preventDefault();
            event.stopPropagation();
            takeScreenshot();
          }
        },
        true
      );
    }
  }

  init().catch(report);
})();
