// One interaction-gated attempt at Stack the Vault. Three.js stays behind the
// explicit start button; importing this module alone is dependency-free.
let activeScene = null;
const GAME_DURATION_MS = 15_000;
const STACK_TARGET = 6;
const MIN_OVERLAP = 0.42;

export function createStackVaultRules({ durationMs = GAME_DURATION_MS, target = STACK_TARGET } = {}) {
  let placed = 0;
  let outcome = null;
  let remainingMs = durationMs;

  const updateTime = (elapsedMs) => {
    remainingMs = Math.max(0, durationMs - elapsedMs);
    if (!outcome && remainingMs === 0) outcome = 'lost';
  };

  return {
    place(overlap, now = performance.now()) {
      if (outcome) return { accepted: false, placed, outcome };
      updateTime(now);
      if (outcome || overlap < MIN_OVERLAP) return { accepted: false, placed, outcome };
      placed += 1;
      if (placed >= target) outcome = 'won';
      return { accepted: true, placed, outcome };
    },
    tick(now = performance.now()) {
      if (!outcome) updateTime(now);
      return this.snapshot();
    },
    snapshot() {
      return { placed, target, remainingMs, outcome };
    },
  };
}

function canUseInteractive3D() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { ok: false, reason: 'Motion is reduced on this device' };
  }
  const memory = Number(navigator.deviceMemory || 0);
  if (memory > 0 && memory <= 2) {
    return { ok: false, reason: '3D is unavailable on low-memory devices' };
  }
  if (!window.WebGLRenderingContext && !window.WebGL2RenderingContext) {
    return { ok: false, reason: '3D is unavailable in this browser' };
  }
  return { ok: true, reason: '' };
}

export async function startEmptyVaultBrick3D(stage, copy = {}) {
  if (!(stage instanceof HTMLElement)) throw new TypeError('A 3D stage is required');
  activeScene?.destroy();

  const capability = canUseInteractive3D();
  if (!capability.ok) throw new Error(capability.reason);

  const THREE = await import('../vendor/three-0.185.1.min.js');
  if (!stage.isConnected) return null;

  const labels = {
    play: copy.play || 'Tap, click, or press Space when the brick lines up. Stack 6 in 15 seconds.',
    won: copy.won || 'Vault stacked! Add your first set to make it real.',
    lost: copy.lost || 'Time’s up. Add your first set and start the real vault.',
    progress: copy.progress || '{placed} of {target} bricks stacked. {seconds} seconds left.',
    miss: copy.miss || 'Missed — line up the next brick and try again.',
  };
  const canvas = document.createElement('canvas');
  canvas.className = 'empty-vault-brick-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', labels.play);

  const fallback = stage.querySelector('.empty-vault-brick-fallback');
  const trigger = stage.querySelector('.empty-vault-brick-3d-trigger');
  const status = stage.querySelector('.empty-vault-brick-3d-status');
  stage.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
  } catch (error) {
    canvas.remove();
    throw error;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 30);
  camera.position.set(5.3, 4.1, 7.4);
  camera.lookAt(0, 1.35, 0);

  const brickGeometry = new THREE.BoxGeometry(2.5, 0.55, 1.4);
  const studGeometry = new THREE.CylinderGeometry(0.22, 0.24, 0.16, 20);
  const orange = new THREE.MeshStandardMaterial({ color: 0xf47a1f, roughness: 0.34, metalness: 0.02 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffb428, roughness: 0.38, metalness: 0.02 });
  const meshes = [];

  function makeBrick(material = orange) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(brickGeometry, material);
    group.add(body);
    for (const x of [-0.88, -0.29, 0.29, 0.88]) {
      for (const z of [-0.4, 0.4]) {
        const stud = new THREE.Mesh(studGeometry, material);
        stud.position.set(x, 0.35, z);
        group.add(stud);
      }
    }
    scene.add(group);
    meshes.push(group);
    return group;
  }

  const base = makeBrick(gold);
  base.position.y = -0.6;

  scene.add(new THREE.HemisphereLight(0xfff4dd, 0x6b341b, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-3, 6, 5);
  scene.add(key);

  const game = createStackVaultRules();
  const controller = { destroy };
  let movingBrick = makeBrick();
  movingBrick.position.y = 0;
  let raf = 0;
  let visible = true;
  let destroyed = false;
  let activeElapsedMs = 0;
  let activeSince = null;
  let lastAnnouncedSecond = -1;
  let direction = 1;
  let lastFrame = 0;

  function gameTime(now) {
    return activeElapsedMs + (activeSince === null ? 0 : now - activeSince);
  }

  function pauseClock(now = performance.now()) {
    if (activeSince === null) return;
    activeElapsedMs += now - activeSince;
    activeSince = null;
  }

  function resumeClock(now = performance.now()) {
    if (activeSince !== null) return;
    activeSince = now;
    lastFrame = now;
  }

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  function announce(snapshot, force = false) {
    if (!status) return;
    const seconds = Math.ceil(snapshot.remainingMs / 1000);
    if (!force && seconds === lastAnnouncedSecond) return;
    lastAnnouncedSecond = seconds;
    status.textContent = labels.progress
      .replace('{placed}', snapshot.placed)
      .replace('{target}', snapshot.target)
      .replace('{seconds}', seconds);
  }

  function finish(outcome) {
    canvas.dataset.outcome = outcome;
    canvas.setAttribute('aria-label', outcome === 'won' ? labels.won : labels.lost);
    if (status) status.textContent = outcome === 'won' ? labels.won : labels.lost;
    stage.dataset.stackVaultOutcome = outcome;
    stage.classList.add('is-stack-vault-finished');
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function render(now = performance.now()) {
    raf = 0;
    if (destroyed || !visible || document.hidden || !stage.isConnected) return;
    const elapsed = gameTime(now);
    const delta = Math.min(34, Math.max(0, now - lastFrame));
    lastFrame = now;
    movingBrick.position.x += direction * delta * 0.0035;
    if (Math.abs(movingBrick.position.x) >= 2.25) {
      movingBrick.position.x = Math.sign(movingBrick.position.x) * 2.25;
      direction *= -1;
    }
    const snapshot = game.tick(elapsed);
    announce(snapshot);
    renderer.render(scene, camera);
    if (snapshot.outcome) finish(snapshot.outcome);
    else raf = requestAnimationFrame(render);
  }

  function placeBrick() {
    const snapshot = game.snapshot();
    if (snapshot.outcome || destroyed) return;
    const previous = meshes[snapshot.placed];
    const overlap = Math.max(0, 1 - Math.abs(movingBrick.position.x - previous.position.x) / 2.5);
    const result = game.place(overlap, gameTime(performance.now()));
    if (!result.accepted) {
      direction *= -1;
      canvas.classList.remove('is-miss');
      requestAnimationFrame(() => canvas.classList.add('is-miss'));
      if (status) status.textContent = labels.miss;
      return;
    }
    movingBrick.position.y = (result.placed - 1) * 0.56;
    if (result.outcome) {
      renderer.render(scene, camera);
      finish(result.outcome);
      return;
    }
    const next = makeBrick(result.placed === STACK_TARGET - 1 ? gold : orange);
    next.position.set(-2.25 * direction, result.placed * 0.56, 0);
    movingBrick = next;
    direction *= -1;
    announce(game.snapshot(), true);
  }

  const onPointerDown = (event) => {
    event.preventDefault();
    placeBrick();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      placeBrick();
    }
  };
  const onVisibility = () => {
    if (document.hidden) {
      pauseClock();
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (visible) {
      resumeClock();
      if (!game.snapshot().outcome && !raf) raf = requestAnimationFrame(render);
    }
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) {
      pauseClock();
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!document.hidden) {
      resumeClock();
      if (!game.snapshot().outcome && !raf) raf = requestAnimationFrame(render);
    }
  }, { threshold: 0.05 });

  const mountObserver = new MutationObserver(() => {
    if (!stage.isConnected) controller.destroy();
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    mountObserver.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('keydown', onKeyDown);
    scene.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose?.();
    });
    renderer.dispose();
    canvas.remove();
    if (activeScene === controller) activeScene = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  observer.observe(stage);
  mountObserver.observe(document.body, { childList: true, subtree: true });
  resize();
  stage.classList.add('is-stack-vault-active');
  fallback?.setAttribute('hidden', '');
  if (trigger) trigger.hidden = true;
  resumeClock();
  raf = requestAnimationFrame(render);
  activeScene = controller;
  canvas.focus({ preventScroll: true });
  return controller;
}
