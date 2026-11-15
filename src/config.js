// Peekaboo — central configuration. Edit values here; every module reads from P.config.
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});

  P.config = {
    // Annotation pen.
    stroke: {
      color: '#0a84ff',
      width: 4 // CSS pixels
    },

    // Screenshot capture.
    capture: {
      // Max time to wait for a video frame newer than the moment the controls were hidden.
      // On a completely static page no newer frame may arrive, so this is also the
      // worst-case delay per screenshot.
      freshFrameTimeoutMs: 400
    },

    // Microphone narration.
    audio: {
      enabled: true,
      mimeType: 'audio/webm;codecs=opus',
      // Audio is written to storage in slices so a page reload loses at most one slice.
      timesliceMs: 1000,
      constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    },

    // Shutter sound (the audible sync marker). Two short rising tones.
    shutter: {
      tones: [
        { frequency: 1568, durationMs: 70 },
        { frequency: 2093, durationMs: 90 }
      ],
      volume: 0.25
    },

    // Keyboard shortcut for the red button. Useful when clicking would close a menu
    // or move focus in the application under test. Set to null to disable.
    screenshotHotkey: { code: 'KeyS', altKey: true, shiftKey: true, ctrlKey: false },

    // After a page load, an active session resumes automatically (including the
    // microphone) only if it was last alive within this window. Older sessions are
    // kept but stay idle until the red button is clicked.
    autoResumeWindowMs: 10 * 60 * 1000,

    // Placement of the controls.
    ui: {
      offsetPx: 12,
      buttonSizePx: 22,
      zIndex: 2147483647
    }
  };
})();
