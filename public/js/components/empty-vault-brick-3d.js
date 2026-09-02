// One interaction-gated attempt at Crack the Brickvault. Three.js stays behind
// the explicit start button; importing this module alone is dependency-free.
let activeScene = null;
const DEFAULT_SEQUENCES = [
  [0, 3],
  [2, 0, 1],
  [3, 1, 2, 0],
];

export function createCrackVaultRules({ sequences = DEFAULT_SEQUENCES } = {}) {
  const rounds = sequences.map((sequence) => [...sequence]);
  if (!rounds.length || rounds.some((sequence) => !sequence.length || sequence.some((stud) => !Number.isInteger(stud) || stud < 0 || stud > 3))) {
    throw new TypeError('Crack the Vault requires non-empty sequences using studs 0–3');
  }
  let round = 0;
  let phase = 'presenting';
  let expectedIndex = 0;
  let outcome = null;

  const snapshot = () => ({ round, totalRounds: rounds.length, phase, expectedIndex, outcome });
  return {
    ready() {
      if (!outcome && phase === 'presenting') phase = 'input';
      return snapshot();
    },
    press(stud) {
      if (outcome || phase !== 'input') return { accepted: false, correct: false, ...snapshot() };
      if (stud !== rounds[round][expectedIndex]) {
        expectedIndex = 0;
        phase = 'presenting';
        return { accepted: true, correct: false, ...snapshot() };
      }
      expectedIndex += 1;
      if (expectedIndex === rounds[round].length) {
        expectedIndex = 0;
        round += 1;
        if (round === rounds.length) {
          outcome = 'unlocked';
          phase = 'complete';
        } else {
          phase = 'presenting';
        }
      }
      return { accepted: true, correct: true, ...snapshot() };
    },
    sequence() {
      return outcome ? [] : [...rounds[round]];
    },
    snapshot,
  };
}

function canUseInteractive3D() {
  const memory = Number(navigator.deviceMemory || 0);
  if (memory > 0 && memory <= 2) return { ok: false, reason: '3D is unavailable on low-memory devices' };
  if (!window.WebGLRenderingContext && !window.WebGL2RenderingContext) return { ok: false, reason: '3D is unavailable in this browser' };
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
    play: copy.play || 'Watch the studs, then repeat the combination. Crack all 3 rounds.',
    watch: copy.watch || 'Watch the combination…',
    repeat: copy.repeat || 'Your turn — repeat the combination.',
    progress: copy.progress || 'Lock {round} of {total}.',
    wrong: copy.wrong || 'Not quite — watch this combination again.',
    unlocked: copy.unlocked || 'Vault cracked! Add your first set to make it real.',
    stud: copy.stud || 'Vault stud {number}',
    reward: copy.reward || 'Mystery set unlocked',
    replay: copy.replay || 'Replay',
  };
  const format = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionDuration = (ms) => reducedMotion ? Math.min(ms, 40) : ms;
  const pendingWaits = new Map();
  const fallback = stage.querySelector('.empty-vault-brick-fallback');
  const status = stage.querySelector('.empty-vault-brick-3d-status');

  const canvas = document.createElement('canvas');
  canvas.className = 'empty-vault-brick-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);

  const controls = document.createElement('div');
  controls.className = 'crack-vault-studs';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', labels.play);
  const buttons = Array.from({ length: 4 }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `crack-vault-stud crack-vault-stud-${index + 1}`;
    button.dataset.stud = String(index);
    button.setAttribute('aria-label', format(labels.stud, { number: index + 1 }));
    button.tabIndex = index === 0 ? 0 : -1;
    controls.append(button);
    return button;
  });

  const reward = document.createElement('div');
  reward.className = 'crack-vault-reward';
  reward.hidden = true;
  reward.setAttribute('aria-hidden', 'true');
  const rewardBox = document.createElement('div');
  rewardBox.className = 'crack-vault-reward-box';
  rewardBox.append(
    ...[0, 1, 2, 3].map(() => {
      const stud = document.createElement('span');
      stud.className = 'crack-vault-reward-stud';
      return stud;
    }),
  );
  const rewardLabel = document.createElement('span');
  rewardLabel.className = 'crack-vault-reward-label';
  rewardLabel.textContent = labels.reward;
  reward.append(rewardBox, rewardLabel);

  const replayButton = document.createElement('button');
  replayButton.type = 'button';
  replayButton.className = 'crack-vault-replay';
  replayButton.textContent = labels.replay;
  replayButton.hidden = true;
  stage.append(controls, reward, replayButton);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
  } catch (error) {
    canvas.remove();
    controls.remove();
    reward.remove();
    replayButton.remove();
    throw error;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(4.8, 3.1, 7.2);
  camera.lookAt(0, 0.35, 0);
  scene.add(new THREE.HemisphereLight(0xfff2d2, 0x382113, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(4, 6, 6);
  scene.add(keyLight);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x302920, roughness: 0.48, metalness: 0.54 });
  const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xffb428, roughness: 0.3, metalness: 0.32 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x171511, roughness: 0.7, metalness: 0.18 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.5, 0.7), frameMaterial);
  frame.position.z = -0.28;
  scene.add(frame);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(3.85, 2.82, 0.2), darkMaterial);
  recess.position.z = 0.13;
  scene.add(recess);
  const hinge = new THREE.Group();
  hinge.position.set(-1.72, 0, 0.26);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.42, 2.48, 0.28), goldMaterial);
  door.position.x = 1.71;
  hinge.add(door);
  scene.add(hinge);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 32), frameMaterial);
  badge.rotation.x = Math.PI / 2;
  badge.position.set(0, 0, 0.48);
  scene.add(badge);

  let game = createCrackVaultRules();
  let destroyed = false;
  let visible = true;
  let playing = false;
  let animationFrameId = 0;
  let unlockLastFrame = 0;
  let resumeUnlockAnimation = null;
  const visibilityWaiters = new Set();
  const visibleDurationInterruptors = new Set();
  const isVisible = () => !destroyed && visible && !document.hidden;
  const releaseVisibilityWaiters = () => {
    if (!isVisible()) return;
    for (const resolve of visibilityWaiters) resolve();
    visibilityWaiters.clear();
  };
  const interruptVisibleDurations = () => {
    for (const interrupt of [...visibleDurationInterruptors]) interrupt();
  };
  const waitUntilVisible = () => {
    if (isVisible()) return Promise.resolve();
    return new Promise((resolve) => visibilityWaiters.add(resolve));
  };
  const waitVisibleDuration = async (ms) => {
    let remaining = ms;
    while (!destroyed && remaining > 0) {
      await waitUntilVisible();
      if (destroyed) return;
      const startedAt = performance.now();
      await new Promise((resolve) => {
        let timerId = 0;
        const finish = () => {
          if (timerId) window.clearTimeout(timerId);
          pendingWaits.delete(timerId);
          visibleDurationInterruptors.delete(finish);
          resolve();
        };
        timerId = window.setTimeout(finish, remaining);
        pendingWaits.set(timerId, finish);
        visibleDurationInterruptors.add(finish);
      });
      remaining -= Math.max(0, performance.now() - startedAt);
    }
  };
  const render = () => {
    if (!destroyed && visible && !document.hidden && stage.isConnected) renderer.render(scene, camera);
  };
  const resize = () => {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const announce = (text) => {
    if (status) status.textContent = text;
  };
  const setEnabled = (enabled) => {
    for (const button of buttons) button.disabled = !enabled;
  };
  const pulse = async (index, duration = 300) => {
    if (destroyed) return;
    buttons[index].classList.add('is-lit');
    render();
    await waitVisibleDuration(motionDuration(duration));
    buttons[index].classList.remove('is-lit');
    render();
  };
  const playSequence = async (replay = false) => {
    if (destroyed || playing || game.snapshot().outcome) return;
    playing = true;
    setEnabled(false);
    announce(replay ? labels.wrong : `${format(labels.progress, { round: game.snapshot().round + 1, total: game.snapshot().totalRounds })} ${labels.watch}`);
    await waitVisibleDuration(motionDuration(replay ? 480 : 320));
    for (const stud of game.sequence()) {
      if (destroyed) return;
      await pulse(stud);
      await waitVisibleDuration(motionDuration(130));
    }
    game.ready();
    playing = false;
    setEnabled(true);
    announce(`${format(labels.progress, { round: game.snapshot().round + 1, total: game.snapshot().totalRounds })} ${labels.repeat}`);
    buttons.find((button) => button.tabIndex === 0)?.focus({ preventScroll: true });
  };
  const unlock = () => {
    setEnabled(false);
    stage.dataset.crackVaultOutcome = 'unlocked';
    controls.classList.add('is-unlocked');
    reward.hidden = false;
    reward.setAttribute('aria-hidden', 'false');
    replayButton.hidden = false;
    announce(labels.unlocked);
    if (reducedMotion) {
      hinge.rotation.y = -Math.PI * 0.58;
      render();
      return;
    }
    let unlockElapsed = 0;
    unlockLastFrame = performance.now();
    const animate = (now) => {
      if (destroyed) return;
      if (!isVisible()) {
        animationFrameId = 0;
        return;
      }
      unlockElapsed += Math.max(0, now - unlockLastFrame);
      unlockLastFrame = now;
      const progress = Math.min(1, unlockElapsed / 700);
      hinge.rotation.y = -Math.PI * 0.58 * (1 - (1 - progress) ** 3);
      render();
      if (progress < 1) animationFrameId = requestAnimationFrame(animate);
      else {
        animationFrameId = 0;
        resumeUnlockAnimation = null;
      }
    };
    resumeUnlockAnimation = () => {
      if (destroyed || animationFrameId || !isVisible()) return;
      unlockLastFrame = performance.now();
      animationFrameId = requestAnimationFrame(animate);
    };
    resumeUnlockAnimation();
  };
  const replay = () => {
    if (destroyed) return;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
    resumeUnlockAnimation = null;
    game = createCrackVaultRules();
    playing = false;
    hinge.rotation.y = 0;
    delete stage.dataset.crackVaultOutcome;
    controls.classList.remove('is-unlocked', 'is-wrong');
    reward.hidden = true;
    reward.setAttribute('aria-hidden', 'true');
    replayButton.hidden = true;
    render();
    announce(labels.play);
    playSequence();
  };
  const activate = async (index) => {
    if (destroyed || playing) return;
    const result = game.press(index);
    if (!result.accepted) return;
    await pulse(index, 130);
    if (!result.correct) {
      controls.classList.add('is-wrong');
      await waitVisibleDuration(motionDuration(260));
      controls.classList.remove('is-wrong');
      await playSequence(true);
    } else if (result.outcome === 'unlocked') {
      unlock();
    } else if (result.phase === 'presenting') {
      await playSequence();
    }
  };
  const onClick = (event) => {
    const button = event.target.closest('.crack-vault-stud');
    if (button) activate(Number(button.dataset.stud));
  };
  const onKeyDown = (event) => {
    const index = buttons.indexOf(event.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -2 : 2;
    const next = (index + delta + 4) % 4;
    buttons[index].tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
  };
  controls.addEventListener('click', onClick);
  controls.addEventListener('keydown', onKeyDown);
  replayButton.addEventListener('click', replay);

  const pauseHiddenWork = () => {
    interruptVisibleDurations();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  };
  const resumeVisibleWork = () => {
    releaseVisibilityWaiters();
    resumeUnlockAnimation?.();
    render();
  };
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) resumeVisibleWork();
    else pauseHiddenWork();
  }, { threshold: 0.1 });
  intersectionObserver.observe(stage);
  const onVisibilityChange = () => {
    if (document.hidden) pauseHiddenWork();
    else resumeVisibleWork();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  const mutationObserver = new MutationObserver(() => {
    if (!stage.isConnected) controller.destroy();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  const controller = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
      resumeUnlockAnimation = null;
      for (const [id, resolve] of pendingWaits) {
        clearTimeout(id);
        resolve();
      }
      pendingWaits.clear();
      visibleDurationInterruptors.clear();
      for (const resolve of visibilityWaiters) resolve();
      visibilityWaiters.clear();
      controls.removeEventListener('click', onClick);
      controls.removeEventListener('keydown', onKeyDown);
      replayButton.removeEventListener('click', replay);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      intersectionObserver.disconnect();
      mutationObserver.disconnect();
      scene.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
      renderer.dispose();
      canvas.remove();
      controls.remove();
      reward.remove();
      replayButton.remove();
      if (activeScene === controller) activeScene = null;
    },
  };
  activeScene = controller;
  fallback?.setAttribute('hidden', '');
  stage.classList.add('is-crack-vault-active');
  resize();
  window.addEventListener('resize', resize, { signal: (() => { const abort = new AbortController(); const originalDestroy = controller.destroy; controller.destroy = () => { abort.abort(); originalDestroy(); }; return abort.signal; })() });
  setEnabled(false);
  announce(labels.play);
  playSequence();
  return controller;
}
