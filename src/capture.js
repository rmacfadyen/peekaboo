// Peekaboo — tab capture. One getDisplayMedia() stream is kept for the life of the page
// and frames are grabbed from it on demand.
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});

  let stream = null;
  let video = null;
  let onEnded = null;

  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function release() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    stream = video = null;
  }

  // Must be called directly from a user gesture (click / key press) with nothing awaited
  // before it, or Chrome rejects the request. Throws on cancel or denial.
  async function acquire(endedCallback) {
    onEnded = endedCallback;
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: false,
      preferCurrentTab: true, // Chrome: offer just this tab instead of the full picker
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude'
    });
    const track = s.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      // "Stop sharing" was clicked, or the browser ended the capture.
      if (stream === s) {
        release();
        if (onEnded) onEnded();
      }
    });

    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = s;
    try {
      await v.play();
    } catch (err) {
      s.getTracks().forEach((t) => t.stop());
      throw err;
    }
    stream = s;
    video = v;
    return track.getSettings();
  }

  // Resolves once the video shows a frame captured at or after `since`
  // (a performance.now() value), or when the timeout passes.
  function freshFrame(since) {
    const v = video;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(finish, P.config.capture.freshFrameTimeoutMs);
      if (!v.requestVideoFrameCallback) return;
      const onFrame = (now, meta) => {
        if (done) return;
        const frameTime = meta.captureTime !== undefined ? meta.captureTime : meta.expectedDisplayTime;
        if (frameTime >= since) finish();
        else v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    });
  }

  // Takes one screenshot. hideUi() runs first; a frame painted after that is awaited;
  // restoreUi(copied) runs as soon as the frame has been copied (before PNG encoding),
  // or with copied=false if that failed.
  // Returns { blob, width, height, displaySurface }.
  async function grab(hideUi, restoreUi) {
    if (!stream) throw new Error('No capture stream');
    const canvas = document.createElement('canvas');
    let copied = false;
    hideUi();
    try {
      // First rAF runs before the paint that hides the controls, the second after it.
      await nextPaint();
      await nextPaint();
      await freshFrame(performance.now());
      if (!video || !video.videoWidth) throw new Error('Capture stream ended');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      copied = true;
    } finally {
      restoreUi(copied);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    const settings = stream ? stream.getVideoTracks()[0].getSettings() : {};
    return {
      blob,
      width: canvas.width,
      height: canvas.height,
      displaySurface: settings.displaySurface || null
    };
  }

  P.capture = { acquire, grab, release, hasStream: () => !!stream };
})();
