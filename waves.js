(() => {
  const section = document.getElementById('moscow');
  const host = document.getElementById('waves-background');
  if (!section || !host) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 701px)');
  let effect;
  let visible = false;
  let pending = false;
  let libraries;
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  const allowed = () => desktop.matches && !motion.matches && !document.hidden && visible;
  async function update() {
    if (!allowed()) {
      if (effect) effect.destroy();
      effect = undefined;
      return;
    }
    if (effect || pending) return;
    pending = true;
    try {
      libraries ||= load('assets/vendor/three-0.134.0.min.js')
        .then(() => load('assets/vendor/vanta-waves-0.5.24.min.js'));
      await libraries;
      if (allowed()) effect = VANTA.WAVES({
        el: host, mouseControls: true, touchControls: false,
        gyroControls: false, minHeight: 200, minWidth: 200,
        scale: 1, color: 0x103d87, shininess: 22,
        waveHeight: 12, waveSpeed: 0.35, zoom: 0.85
      });
    } catch {
      // The static blue background remains when WebGL is unavailable.
      if (effect) effect.destroy();
      effect = undefined;
    } finally { pending = false; }
  }
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    update();
  }, { rootMargin: '100px' }).observe(section);
  motion.addEventListener('change', update);
  desktop.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
})();
