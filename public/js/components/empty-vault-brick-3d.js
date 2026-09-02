// Optional, interaction-gated 3D brand moment for the empty Vault. This module
// stays dependency-free until the user explicitly asks for 3D; the heavy Three.js
// module is imported only after capability and accessibility checks pass.
let activeScene = null;
const REVEAL_DURATION_MS = 700;

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

export async function startEmptyVaultBrick3D(stage) {
  if (!(stage instanceof HTMLElement)) throw new TypeError('A 3D stage is required');
  activeScene?.destroy();

  const capability = canUseInteractive3D();
  if (!capability.ok) throw new Error(capability.reason);

  const THREE = await import('../vendor/three-0.185.1.min.js');
  if (!stage.isConnected) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'empty-vault-brick-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', 'Interactive 3D brick. Drag to rotate or press Enter to snap.');

  const fallback = stage.querySelector('.empty-vault-brick-fallback');
  const trigger = stage.querySelector('.empty-vault-brick-3d-trigger');
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
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  camera.position.set(5.2, 3.8, 6.2);
  camera.lookAt(0, 0.1, 0);

  const brick = new THREE.Group();
  brick.rotation.set(-0.15, -0.55, 0.06);
  scene.add(brick);

  const orange = new THREE.MeshStandardMaterial({ color: 0xf47a1f, roughness: 0.34, metalness: 0.02 });
  const darkOrange = new THREE.MeshStandardMaterial({ color: 0xb83f0a, roughness: 0.45, metalness: 0.01 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.55, 1.12, 2.15, 2, 1, 2), orange);
  body.position.y = 0.15;
  brick.add(body);

  const studGeometry = new THREE.CylinderGeometry(0.35, 0.38, 0.24, 32);
  for (const x of [-1.28, -0.43, 0.43, 1.28]) {
    for (const z of [-0.62, 0.62]) {
      const stud = new THREE.Mesh(studGeometry, orange);
      stud.position.set(x, 0.83, z);
      brick.add(stud);
    }
  }

  // A narrow darker underside gives the simple procedural brick more depth
  // without fetching a model or texture.
  const underside = new THREE.Mesh(new THREE.BoxGeometry(3.28, 0.12, 1.88), darkOrange);
  underside.position.y = -0.47;
  brick.add(underside);

  scene.add(new THREE.HemisphereLight(0xfff4dd, 0x6b341b, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb15c, 1.7);
  rim.position.set(5, 2, -4);
  scene.add(rim);

  let raf = 0;
  let visible = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let velocityX = 0;
  let velocityY = 0;
  let snapStart = 0;
  const revealStartedAt = performance.now();
  let revealing = true;
  const revealFrom = {
    rotationX: 0.46,
    rotationY: -0.82,
    positionY: 0.28,
    scale: 0.84,
  };
  const revealTo = {
    rotationX: brick.rotation.x,
    rotationY: brick.rotation.y,
    positionY: brick.position.y,
  };
  brick.rotation.set(revealFrom.rotationX, revealFrom.rotationY, 0.08);
  brick.position.y = revealFrom.positionY;
  brick.scale.setScalar(revealFrom.scale);

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const render = (now = performance.now()) => {
    raf = 0;
    if (!visible || document.hidden || !stage.isConnected) return;
    if (revealing) {
      const progress = Math.min(1, (now - revealStartedAt) / REVEAL_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      brick.rotation.x = THREE.MathUtils.lerp(revealFrom.rotationX, revealTo.rotationX, eased);
      brick.rotation.y = THREE.MathUtils.lerp(revealFrom.rotationY, revealTo.rotationY, eased);
      brick.rotation.z = THREE.MathUtils.lerp(0.08, 0, eased);
      brick.position.y = THREE.MathUtils.lerp(revealFrom.positionY, revealTo.positionY, eased);
      const scale = THREE.MathUtils.lerp(revealFrom.scale, 1, eased);
      brick.scale.setScalar(scale);
      revealing = progress < 1;
    }
    if (!dragging) {
      velocityX *= 0.9;
      velocityY *= 0.9;
      brick.rotation.y += velocityX;
      brick.rotation.x = THREE.MathUtils.clamp(brick.rotation.x + velocityY, -0.65, 0.45);
    }
    if (snapStart) {
      const progress = Math.min(1, (now - snapStart) / 520);
      brick.position.y = -Math.sin(progress * Math.PI) * 0.16;
      if (progress >= 1) snapStart = 0;
    }
    renderer.render(scene, camera);
    const snapping = snapStart > 0;
    const needsAnotherFrame = Math.abs(velocityX) > 0.0005 || Math.abs(velocityY) > 0.0005;
    if (dragging || snapping || revealing || needsAnotherFrame) raf = requestAnimationFrame(render);
  };

  const requestRender = () => {
    if (!raf && visible && !document.hidden && stage.isConnected) raf = requestAnimationFrame(render);
  };

  const onPointerDown = (event) => {
    revealing = false;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    velocityX = 0;
    velocityY = 0;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('is-dragging');
    requestRender();
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    velocityX = dx * 0.008;
    velocityY = dy * 0.006;
    brick.rotation.y += velocityX;
    brick.rotation.x = THREE.MathUtils.clamp(brick.rotation.x + velocityY, -0.65, 0.45);
  };
  const onPointerUp = () => {
    dragging = false;
    canvas.classList.remove('is-dragging');
  };
  const snapBrick = () => {
    revealing = false;
    snapStart = performance.now();
    requestRender();
  };
  const onTap = () => {
    if (Math.abs(velocityX) < 0.015 && Math.abs(velocityY) < 0.015) snapBrick();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      snapBrick();
    }
  };
  const onVisibility = () => requestRender();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('click', onTap);
  canvas.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (!visible && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    requestRender();
  }, { threshold: 0.05 });
  intersectionObserver.observe(stage);

  let mountObserver = null;
  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    mountObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('click', onTap);
    canvas.removeEventListener('keydown', onKeyDown);
    scene.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose?.();
    });
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
    fallback?.removeAttribute('hidden');
    trigger?.removeAttribute('hidden');
    stage.classList.remove('is-3d');
    if (activeScene?.destroy === destroy) activeScene = null;
  };

  activeScene = { destroy };
  resize();
  fallback?.setAttribute('hidden', '');
  trigger?.setAttribute('hidden', '');
  stage.classList.add('is-3d');
  requestRender();

  // Route renders replace #root wholesale. Observe only while mounted so GPU
  // resources are released as soon as this stage leaves the document.
  mountObserver = new MutationObserver(() => {
    if (!stage.isConnected) destroy();
  });
  mountObserver.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });

  return activeScene;
}
