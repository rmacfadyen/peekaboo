// Peekaboo — annotation mode: a transparent full-viewport canvas for freehand strokes.
// Coordinates are CSS pixels relative to the viewport (clientX / clientY), so they do not
// depend on the application's layout. Nothing in the page itself is modified.
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});

  const SCROLL_KEYS = new Set([
    'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'
  ]);
  const round = (n) => Math.round(n * 10) / 10;

  function penCursor(color) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
      `<path d="M2 22 L4 15 L16 3 L21 8 L9 20 Z" fill="${color}" stroke="white" stroke-width="1.5"/>` +
      `<path d="M2 22 L4 15 L9 20 Z" fill="white" stroke="${color}" stroke-width="1"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 22, crosshair`;
  }

  // root: the shadow root to add the overlay to.
  // now(): session clock in ms.
  // onDone(strokes): called once when annotation mode ends. strokes is
  //   [{ startT, endT, points: [[x, y, t], ...] }]
  // Returns a function that ends annotation mode.
  function start({ root, now, onDone }) {
    const { color, width } = P.config.stroke;
    const strokes = [];
    let current = null;

    const canvas = document.createElement('canvas');
    canvas.className = 'overlay';
    canvas.style.cursor = penCursor(color);
    const done = document.createElement('button');
    done.className = 'done';
    done.textContent = 'Done';
    done.title = 'Finish annotating (Esc)';
    root.append(canvas, done);
    const g = canvas.getContext('2d');

    function applyStyle() {
      const dpr = window.devicePixelRatio || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.lineJoin = 'round';
    }

    function segment(a, b) {
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }

    function dot(p) {
      g.beginPath();
      g.arc(p[0], p[1], width / 2, 0, Math.PI * 2);
      g.fill();
    }

    // Size the backing store to device pixels; redraw because resizing clears the canvas.
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      // Explicit CSS size: the viewport including scrollbars, matching clientX/clientY
      // and the captured image.
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      applyStyle();
      for (const stroke of strokes) {
        dot(stroke.points[0]);
        for (let i = 1; i < stroke.points.length; i++) segment(stroke.points[i - 1], stroke.points[i]);
      }
    }

    function addPoint(event) {
      const point = [round(event.clientX), round(event.clientY), now()];
      const previous = current.points[current.points.length - 1];
      current.points.push(point);
      if (previous) segment(previous, point);
      else dot(point);
    }

    function onDown(event) {
      if (event.button !== 0 || current) return;
      canvas.setPointerCapture(event.pointerId);
      current = { pointerId: event.pointerId, startT: now(), points: [] };
      addPoint(event);
    }

    function onMove(event) {
      if (!current || event.pointerId !== current.pointerId) return;
      // Coalesced events give every raw sample, not just one per frame.
      const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
      (samples.length ? samples : [event]).forEach(addPoint);
    }

    function onUp(event) {
      if (!current || event.pointerId !== current.pointerId) return;
      strokes.push({ startT: current.startT, endT: now(), points: current.points });
      current = null;
    }

    // Keep the page still and deaf while drawing.
    function swallow(event) {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    }

    function onKey(event) {
      if (event.code === 'Escape') {
        swallow(event);
        finish();
      } else if (SCROLL_KEYS.has(event.code) && !event.ctrlKey && !event.altKey && !event.metaKey) {
        swallow(event);
      }
    }

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (current) strokes.push({ startT: current.startT, endT: now(), points: current.points });
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey, true);
      canvas.remove();
      done.remove();
      onDone(strokes);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    for (const type of ['wheel', 'contextmenu', 'touchstart', 'touchmove', 'dragstart']) {
      canvas.addEventListener(type, swallow, { passive: false });
    }
    done.addEventListener('click', finish);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKey, true);
    resize();

    return finish;
  }

  P.annotate = { start };
})();
