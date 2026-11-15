// Peekaboo — assembles the session ZIP from what is in the store.
//
//   manifest.json                              index of everything, with timing
//   screenshots/screenshot-NNN.png             original captures, never modified
//   annotations/annotation-NNN.json            raw strokes, one file per annotation pass
//   annotated/screenshot-NNN-annotated.png     convenience copy with strokes drawn on
//   audio/narration-NNN.webm                   one file per uninterrupted recording
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});

  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const json = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2));

  // Draws annotations over a copy of the screenshot. Stroke coordinates are CSS pixels in
  // the annotation's viewport; the screenshot is that viewport at capture resolution.
  async function composite(shotBlob, annotations) {
    const image = await createImageBitmap(shotBlob);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const g = canvas.getContext('2d');
    g.drawImage(image, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const annotation of annotations) {
      const sx = image.width / annotation.viewport.width;
      const sy = image.height / annotation.viewport.height;
      g.strokeStyle = annotation.stroke.color;
      g.lineWidth = annotation.stroke.width * sx;
      for (const stroke of annotation.strokes) {
        g.beginPath();
        stroke.points.forEach(([x, y], i) => (i ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)));
        if (stroke.points.length === 1) g.lineTo(stroke.points[0][0] * sx + 0.01, stroke.points[0][1] * sy);
        g.stroke();
      }
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  async function build(session) {
    const { store, pad } = P;
    const files = [];

    const annotations = [];
    for (const entry of session.annotations) {
      const annotation = await store.get(`annotation-${pad(entry.index, 3)}`);
      if (!annotation) continue;
      annotations.push(annotation);
      files.push({ name: entry.file, data: json(annotation) });
    }

    const screenshots = [];
    for (const shot of session.screenshots) {
      const blob = await store.get(`shot-${pad(shot.index, 3)}`);
      if (!blob) continue;
      files.push({ name: shot.file, data: await bytes(blob) });
      const own = annotations.filter((a) => a.screenshotIndex === shot.index);
      const entry = { ...shot, annotations: own.map((a) => a.file) };
      if (own.length) {
        entry.annotatedFile = `annotated/screenshot-${pad(shot.index, 3)}-annotated.png`;
        files.push({ name: entry.annotatedFile, data: await bytes(await composite(blob, own)) });
      }
      screenshots.push(entry);
    }

    const segments = [];
    for (const segment of session.audio.segments) {
      const keys = await store.keys(`audio-${pad(segment.index, 3)}-`);
      if (!keys.length) continue;
      const chunks = [];
      for (const key of keys) chunks.push(await store.get(key));
      files.push({ name: segment.file, data: await bytes(new Blob(chunks)) });
      segments.push(segment);
    }

    const manifest = {
      tool: 'Peekaboo',
      formatVersion: session.formatVersion,
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      exportedAt: new Date().toISOString(),
      userAgent: session.userAgent,
      notes: {
        time:
          'Every "t" / "...T" value is milliseconds since startedAt (wall clock), shared by ' +
          'screenshots, strokes, audio segments and events. Offset into an audio file = t - segment.startT.',
        shutterSound:
          'A short two-tone sound plays at each screenshot (shutterSoundT). When a segment has ' +
          'shutterSoundMixed=true the sound is mixed into that audio file and can be used to verify alignment.',
        coordinates:
          'Stroke points are [x, y, t] with x/y in CSS pixels relative to the top-left of the viewport ' +
          'at annotation time. Multiply by screenshot image.width / viewport.width to get screenshot pixels.',
        alignment:
          'An annotation belongs to the most recent screenshot. pageStateMatchesScreenshot=false means the ' +
          'URL, viewport size or scroll position changed in between, so strokes may not line up with it.'
      },
      screenshots,
      annotations: session.annotations,
      audio: { status: session.audio.status, error: session.audio.error || null, segments },
      events: session.events
    };
    files.unshift({ name: 'manifest.json', data: json(manifest) });

    return P.zip.build(files);
  }

  P.exporter = { build };
})();
