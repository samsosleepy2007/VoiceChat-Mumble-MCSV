/* Visual tilt adapted from promt(3).txt. No foil, canvas or business logic.
 * Passive pointer listeners preserve clicks, form submission and native scrolling. */
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  const controls = 'input,textarea,select,button,a,label,[contenteditable],[role="button"]';
  const clamp = n => Math.min(1, Math.max(0, n));

  for (const card of document.querySelectorAll('main.page > .card:not(.history-card)')) {
    card.classList.add('holo-card');
    let frame = 0, last = 0, visible = true, stopped = false, pressed = null;
    let x = 0, y = 0, vx = 0, vy = 0, targetX = 0, targetY = 0;
    const blocked = () => reduced.matches || stopped || !visible || document.hidden ||
      card.contains(document.activeElement) || document.body.classList.contains('paying') ||
      Boolean(document.querySelector('dialog[open]'));

    function paint() {
      card.style.setProperty('--holo-rx', x.toFixed(3) + 'deg');
      card.style.setProperty('--holo-ry', y.toFixed(3) + 'deg');
    }
    function reset(immediate = false) {
      targetX = targetY = 0;
      pressed = null;
      if (card.classList.contains('is-pointing')) card.classList.remove('is-pointing');
      if (immediate) {
        cancelAnimationFrame(frame);
        frame = last = 0;
        x = y = vx = vy = 0;
        paint();
      } else wake();
    }
    function tick(now) {
      frame = 0;
      if (blocked()) { reset(true); return; }
      const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
      last = now;
      vx += ((targetX - x) * 180 - vx * 25) * dt;
      vy += ((targetY - y) * 180 - vy * 25) * dt;
      x += vx * dt; y += vy * dt;
      const settled = Math.abs(targetX - x) + Math.abs(targetY - y) +
        Math.abs(vx) + Math.abs(vy) < .015;
      if (settled) { x = targetX; y = targetY; vx = vy = 0; }
      paint();
      if (!settled) frame = requestAnimationFrame(tick);
    }
    function wake() {
      if (!frame && !blocked()) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }
    function point(event) {
      if (blocked()) return;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = clamp((event.clientX - rect.left) / rect.width);
      const py = clamp((event.clientY - rect.top) / rect.height);
      targetX = (.5 - py) * 20;
      targetY = (px - .5) * 20;
      card.classList.add('is-pointing');
      wake();
    }
    card.addEventListener('pointermove', event => {
      if ((event.pointerType === 'mouse' && hover.matches) || event.pointerId === pressed) point(event);
    }, { passive: true });
    card.addEventListener('pointerdown', event => {
      // Never move a control while it is being clicked or edited.
      if (event.target.closest(controls) || blocked() || event.button !== 0) return;
      pressed = event.pointerId;
      point(event);
    }, { passive: true });
    card.addEventListener('pointerleave', () => reset(), { passive: true });
    card.addEventListener('pointercancel', () => reset(), { passive: true });
    window.addEventListener('pointerup', event => {
      if (event.pointerId === pressed) reset();
    }, { passive: true });
    card.addEventListener('focusin', () => reset(true));
    document.addEventListener('visibilitychange', () => reset(true));
    window.addEventListener('blur', () => reset(true));
    window.addEventListener('pagehide', () => { stopped = true; reset(true); });
    window.addEventListener('pageshow', () => { stopped = false; reset(true); });
    reduced.addEventListener('change', () => reset(true));
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (!visible) reset(true);
    }).observe(card);
    new MutationObserver(() => { if (blocked()) reset(true); }).observe(document.body, {
      subtree: true, attributes: true, attributeFilter: ['class', 'open', 'hidden']
    });
  }
})();
