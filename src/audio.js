// Peekaboo — microphone recording and the shutter sound.
//
// When possible the microphone is routed through Web Audio so the shutter sound can be
// mixed straight into the recording (echo cancellation would otherwise remove it, and
// headphones would keep it from reaching the microphone at all). If the AudioContext is
// not allowed to run (no user gesture yet after a reload) the raw microphone is recorded.
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});

  let ctx = null; // AudioContext
  let micStream = null;
  let micSource = null;
  let mixDestination = null; // shutter sound is also sent here while recording
  let recorder = null;
  let stopped = null; // resolves when the current recorder has fully stopped

  function getContext() {
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch (err) {
        return null;
      }
    }
    return ctx;
  }

  // resume() stays pending forever when autoplay is blocked, so give it a deadline.
  async function contextRunning() {
    const c = getContext();
    if (!c) return false;
    if (c.state !== 'running') {
      await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    }
    return c.state === 'running';
  }

  // Starts recording. Returns { ok: true, mimeType, shutterSoundMixed } or { ok: false, error }.
  //   onStart()       recording actually began (use for the segment start time)
  //   onChunk(blob)   a slice of audio, in order
  //   onEnded()       the microphone went away on its own (device unplugged, permission revoked)
  async function start({ onStart, onChunk, onEnded }) {
    if (recorder) return { ok: true, already: true };
    const cfg = P.config.audio;
    if (!navigator.mediaDevices || !window.MediaRecorder) return { ok: false, error: 'Unsupported' };

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: cfg.constraints });
    } catch (err) {
      return { ok: false, error: err.name || String(err) };
    }

    let recordStream = micStream;
    let mixed = false;
    if (await contextRunning()) {
      micSource = ctx.createMediaStreamSource(micStream);
      mixDestination = ctx.createMediaStreamDestination();
      micSource.connect(mixDestination);
      recordStream = mixDestination.stream;
      mixed = true;
    }

    const options = MediaRecorder.isTypeSupported(cfg.mimeType) ? { mimeType: cfg.mimeType } : {};
    const rec = new MediaRecorder(recordStream, options);
    recorder = rec;
    stopped = new Promise((resolve) => {
      rec.onstop = resolve;
    });
    rec.onstart = () => onStart();
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size) onChunk(event.data);
    };
    micStream.getAudioTracks()[0].addEventListener('ended', () => {
      if (recorder === rec) stop().then(onEnded);
    });
    rec.start(cfg.timesliceMs);
    return { ok: true, mimeType: rec.mimeType, shutterSoundMixed: mixed };
  }

  // Stops recording; resolves after the final chunk has been delivered to onChunk.
  async function stop() {
    if (!recorder) return;
    const rec = recorder;
    const done = stopped;
    recorder = null;
    if (rec.state !== 'inactive') rec.stop();
    await done;
    micStream.getTracks().forEach((track) => track.stop());
    if (micSource) micSource.disconnect();
    micStream = micSource = mixDestination = null;
  }

  // Plays the sync marker through the speakers and, when mixing, into the recording.
  function playShutter() {
    const c = getContext();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    const { tones, volume } = P.config.shutter;
    let at = c.currentTime + 0.01;
    for (const tone of tones) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const end = at + tone.durationMs / 1000;
      osc.type = 'sine';
      osc.frequency.value = tone.frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.005);
      gain.gain.setValueAtTime(volume, end - 0.01);
      gain.gain.linearRampToValueAtTime(0, end);
      osc.connect(gain);
      gain.connect(c.destination);
      if (mixDestination) gain.connect(mixDestination);
      osc.start(at);
      osc.stop(end);
      at = end;
    }
  }

  P.audio = { start, stop, playShutter, isRecording: () => !!recorder };
})();
