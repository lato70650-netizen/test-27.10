(() => {
  const demo = document.querySelector('.vanta-demo');
  const host = document.getElementById('vanta-stage');
  if (!demo || !host) return;
  const status = demo.querySelector('.vanta-status');
  const buttons = [...demo.querySelectorAll('[data-effect]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px)');
  const scripts = new Map();
  let choice = 'net', effect, visible = false, version = 0;
  const load = src => {
    if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.append(s);
    }));
    return scripts.get(src);
  };
  async function render() {
    const current = ++version;
    if (effect) effect.destroy();
    effect = null;
    if (reduced.matches) { status.textContent = 'Анимация отключена в настройках устройства'; return; }
    if (!visible || document.hidden) return;
    status.textContent = 'Загрузка эффекта…';
    try {
      await load('assets/vendor/three-0.134.0.min.js');
      await load(`assets/vendor/vanta-${choice}-0.5.24.min.js`);
      if (current !== version) return;
      const settings = {
        net: {color: 0x579dff, backgroundColor: 0x071b3d, points: mobile.matches ? 7 : 11, maxDistance: 23, spacing: 17, showDots: true},
        globe: {color: 0x448aff, color2: 0x9cceff, backgroundColor: 0x071b3d, size: 1},
        fog: {highlightColor: 0x8bc5ff, midtoneColor: 0x255baf, lowlightColor: 0x091b48, baseColor: 0x071b3d, blurFactor: 0.55, speed: 1.1, zoom: 0.8}
      };
      effect = VANTA[choice.toUpperCase()]({el: host, mouseControls: true, touchControls: false, gyroControls: false, scale: 1, scaleMobile: 1.5, minHeight: 200, minWidth: 200, ...settings[choice]});
      status.textContent = mobile.matches ? 'VANTA.JS / СИНИЙ ЭКСПЕРИМЕНТ' : 'VANTA.JS / ДВИГАЙТЕ КУРСОРОМ';
    } catch {
      status.textContent = 'Эффект недоступен — показан статичный фон';
      if (effect) effect.destroy();
      effect = null;
    }
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    choice = button.dataset.effect;
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    render();
  }));
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting; render();
  }, {rootMargin: '100px'}).observe(demo);
  else { visible = true; render(); }
  reduced.addEventListener('change', render);
  mobile.addEventListener('change', render);
  document.addEventListener('visibilitychange', render);
})();
