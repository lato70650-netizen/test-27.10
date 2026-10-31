(() => {
  const scene = document.querySelector('.city-scene');
  const map = document.querySelector('.city-map');
  if (!scene || !map) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  const update = () => {
    const pause = reduced.matches || document.hidden || !visible;
    if (pause) map.pauseAnimations(); else map.unpauseAnimations();
    scene.classList.toggle('animation-paused', pause);
  };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      update();
    }).observe(scene);
  } else visible = true;
  reduced.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  update();
})();
