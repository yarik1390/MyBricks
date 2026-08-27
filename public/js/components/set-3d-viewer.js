const THREE_MODULE_URL = '../vendor/three.module.js';
const ORBIT_CONTROLS_URL = '../vendor/OrbitControls.js';

export function supportsSet3dViewer(win = globalThis.window) {
  if (!win?.WebGLRenderingContext || !win?.document) return false;
  try {
    const canvas = win.document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function viewerQuality(win = globalThis.window) {
  const memory = Number(win?.navigator?.deviceMemory || 4);
  const cores = Number(win?.navigator?.hardwareConcurrency || 4);
  const reducedMotion = Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  return {
    antialias: memory >= 4 && cores >= 4,
    pixelRatio: Math.min(Number(win?.devicePixelRatio || 1), memory < 4 ? 1 : 1.5),
    reducedMotion,
  };
}

export function setViewerCopy(set = {}) {
  const setNum = String(set.set_num || '').trim();
  const setName = String(set.name || setNum || 'LEGO set').trim();
  return {
    title: `3D preview of ${setName}`,
    description: `Interactive block-scale preview for set ${setNum}. This is an illustrative preview, not the official LEGO building model.`,
  };
}

function disposeObject(object) {
  object.traverse?.(child => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) value?.isTexture && value.dispose?.();
      material.dispose?.();
    }
  });
}

function addStuds(THREE, group, width, depth, height, color, unit) {
  const bodyGeometry = new THREE.BoxGeometry(width * unit, height * unit, depth * unit);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0.02 });
  const body = new THREE.Mesh(bodyGeometry, material);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = height * unit * 0.5;
  group.add(body);

  const studGeometry = new THREE.CylinderGeometry(unit * 0.235, unit * 0.235, unit * 0.18, 16);
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      const stud = new THREE.Mesh(studGeometry, material);
      stud.castShadow = true;
      stud.position.set((x - (width - 1) / 2) * unit, height * unit + unit * 0.09, (z - (depth - 1) / 2) * unit);
      group.add(stud);
    }
  }
}

function hashSetNum(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildPreview(THREE, set) {
  const group = new THREE.Group();
  const hash = hashSetNum(set.set_num);
  const palette = [0xd22630, 0xffc700, 0x1677c8, 0x22a559, 0xf27c22, 0x7a4eab];
  const unit = 0.55;
  const pieceCount = Math.max(1, Number(set.pieces || 1));
  const layers = Math.min(5, Math.max(2, Math.round(Math.log10(pieceCount + 10))));

  addStuds(THREE, group, 8, 6, 0.72, palette[hash % palette.length], unit);
  for (let layer = 1; layer < layers; layer += 1) {
    const width = Math.max(2, 8 - layer * 2);
    const depth = Math.max(2, 6 - layer);
    const color = palette[(hash + layer * 3) % palette.length];
    const brick = new THREE.Group();
    addStuds(THREE, brick, width, depth, 0.72, color, unit);
    brick.position.y = layer * unit * 0.72;
    brick.rotation.y = ((hash >> layer) & 1 ? 1 : -1) * layer * 0.08;
    group.add(brick);
  }

  const box = new THREE.Box3().setFromObject(group);
  group.position.y -= box.min.y;
  group.rotation.y = -0.45;
  return group;
}

export async function mountSet3dViewer(host, set, win = globalThis.window) {
  if (!host || !supportsSet3dViewer(win)) throw new Error('webgl-unavailable');
  const [THREE, { OrbitControls }] = await Promise.all([
    import(THREE_MODULE_URL),
    import(ORBIT_CONTROLS_URL),
  ]);
  const quality = viewerQuality(win);
  const copy = setViewerCopy(set);
  const canvas = host.querySelector('[data-set-3d-canvas]');
  if (!canvas) throw new Error('viewer-canvas-missing');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(6.2, 4.2, 6.9);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5d6680, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(5, 9, 6);
  key.castShadow = true;
  scene.add(key);

  const model = buildPreview(THREE, set);
  scene.add(model);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6.8, 64),
    new THREE.MeshStandardMaterial({ color: 0x20222c, transparent: true, opacity: 0.12, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !quality.reducedMotion;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0.7, 0);
  controls.update();

  let frame = 0;
  let active = true;
  let renderPending = false;
  const resize = () => {
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const renderNow = () => {
    renderPending = false;
    if (!active || win.document.hidden) return;
    controls.update();
    renderer.render(scene, camera);
  };
  const requestRender = () => {
    if (!active || win.document.hidden || renderPending) return;
    renderPending = true;
    frame = win.requestAnimationFrame(renderNow);
  };
  const onVisibility = () => {
    if (win.document.hidden) {
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
      renderPending = false;
    } else requestRender();
  };
  const resizeObserver = typeof win.ResizeObserver === 'function'
    ? new win.ResizeObserver(resize)
    : null;
  const intersectionObserver = typeof win.IntersectionObserver === 'function'
    ? new win.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) {
        if (frame) win.cancelAnimationFrame(frame);
        frame = 0;
        renderPending = false;
      } else if (!win.document.hidden) {
        requestRender();
      }
    }, { threshold: 0.01 })
    : null;
  resizeObserver?.observe(host);
  intersectionObserver?.observe(host);
  win.document.addEventListener('visibilitychange', onVisibility);
  controls.addEventListener('change', requestRender);
  resize();
  requestRender();
  canvas.setAttribute('aria-label', copy.title);
  host.dataset.viewerReady = 'true';

  return {
    reset() {
      camera.position.set(6.2, 4.2, 6.9);
      controls.target.set(0, 0.7, 0);
      controls.update();
      requestRender();
    },
    dispose() {
      active = false;
      if (frame) win.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      win.document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss?.();
      host.dataset.viewerReady = 'false';
    },
  };
}
