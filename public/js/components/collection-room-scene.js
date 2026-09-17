import {
  ROOM_LAYOUT,
  ROOM_RESIDENT_BOX_LIMIT,
  ROOM_TEXTURE_LIMIT,
  createRoomLayout,
  moveRoomPose,
  normalizeRoomPose,
  roomPoseForSet,
  selectRoomResidents,
} from '../lib/collection-room.js';

const IMAGE_TEXTURE_LIMIT = ROOM_TEXTURE_LIMIT;
const LOOK_SPEED = 0.0032;
const RESIDENT_SEGMENT_RADIUS = 4;

function themeColor(theme) {
  let hash = 2166136261;
  for (const character of String(theme)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const colors = [0x9a5b4b, 0x446b62, 0x556a8a, 0x8a6a43, 0x6e597c, 0x7a6847];
  return colors[Math.abs(hash) % colors.length];
}

function shorten(context, value, width) {
  let text = String(value || '');
  if (context.measureText(text).width <= width) return text;
  while (text.length && context.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}

function isTypingTarget(target) {
  return target instanceof Element && (target.matches('input, textarea, select') || target.isContentEditable);
}

export async function createCollectionRoom(stage, catalog, options = {}) {
  if (Number(navigator.deviceMemory || 0) > 0 && navigator.deviceMemory <= 2) throw new Error('Low memory');
  const THREE = await import('../vendor/three-0.185.1.min.js');
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : () => {};
  const onUnavailable = typeof options.onUnavailable === 'function' ? options.onUnavailable : () => {};
  const onInspectionRotate = typeof options.onInspectionRotate === 'function' ? options.onInspectionRotate : () => {};
  if (!stage?.isConnected || !isCurrent()) return null;

  const layout = createRoomLayout(catalog);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.width = '100%';

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas, powerPreference: 'low-power' });
  } catch (error) {
    canvas.remove();
    throw error;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x11161a);
  stage.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161a);
  scene.fog = new THREE.Fog(0x11161a, 24, 46);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 46);
  const raycaster = new THREE.Raycaster();
  // Keep boxes selectable from the aisle and from the room entrance. The
  // visible card remains the target; this only avoids forcing a close approach.
  raycaster.far = 30;
  const abort = new AbortController();
  const residentBoxes = new Map();
  const residentSegments = new Map();
  const pickTargets = new Set();
  const sharedGeometries = new Set();
  const sharedMaterials = new Set();
  const keys = new Set();
  const joystick = options.joystick instanceof Element ? options.joystick : null;
  const knob = joystick?.querySelector('.showroom-stick-knob') || null;
  const previousJoystickTouchAction = joystick?.style.touchAction || '';
  let joystickPointer = null;
  let joystickVector = { forward: 0, strafe: 0 };
  let drag = null;
  const pendingTextureLoads = new Set();
  let textureLoadScheduled = false;
  let textureRenderTimer = 0;
  let textureLoadPaused = false;
  let destroyed = false;
  let contextLost = false;
  let unavailableNotified = false;
  let manuallyPaused = false;
  let frame = 0;
  let lastFrameTime = 0;
  let residentSegment = -1;
  let resizeObserver;
  let removalObserver;
  let pose = normalizeRoomPose(layout, options.initialPose);
  let inspecting = false;
  let activePickup = null;

  const textureLoader = new THREE.TextureLoader();
  const loadVaultTexture = (url, repeatX = 1, repeatY = 1) => {
    try {
      const tex = textureLoader.load(url, () => { if (!inspecting && !manuallyPaused) renderNow(); });
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      return tex;
    } catch {
      return null;
    }
  };
  const steelTexture = loadVaultTexture('/img/vault-steel.webp', 2, 4);
  const floorTexture = loadVaultTexture('/img/vault-floor.webp', 3, 10);
  const doorTexture = loadVaultTexture('/img/vault-door.webp', 1, 1);

  const material = parameters => {
    const value = new THREE.MeshStandardMaterial(parameters);
    sharedMaterials.add(value);
    return value;
  };
  const wallSteel = material({ color: 0x444d53, map: steelTexture, metalness: 0.72, roughness: 0.44 });
  const ceiling = material({ color: 0x566066, map: steelTexture, metalness: 0.55, roughness: 0.52 });
  const floor = material({ color: 0x22282c, map: floorTexture, metalness: 0.3, roughness: 0.65 });
  const aisle = material({ color: 0x323a40, map: floorTexture, metalness: 0.26, roughness: 0.72 });
  const shelfSteel = material({ color: 0x2c3338, map: steelTexture, metalness: 0.78, roughness: 0.38 });
  const shelfEdge = material({ color: 0x161b1e, metalness: 0.82, roughness: 0.3 });
  // Product photos only cover the front. Every other face stays intentionally
  // neutral so the room never invents official package artwork.
  const boxSide = material({ color: 0xc2aa84, roughness: 0.93 });
  const boxFront = material({ color: 0xeee5d7, roughness: 0.86 });
  const accentMaterials = new Map();
  const boxGeometry = new THREE.BoxGeometry(ROOM_LAYOUT.boxDepth, ROOM_LAYOUT.boxHeight, ROOM_LAYOUT.boxWidth);
  sharedGeometries.add(boxGeometry);

  scene.add(new THREE.HemisphereLight(0xcbe0eb, 0x111518, 1.32));
  const keyLight = new THREE.DirectionalLight(0xe8f4fa, 2.05);
  keyLight.position.set(-3, 5.8, 4);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight(0xffd69b, 2.5, 18, 1.9);
  warmLight.position.set(0, 4.7, pose.z + 1);
  scene.add(warmLight);

  function accent(theme) {
    const color = themeColor(theme);
    if (!accentMaterials.has(color)) accentMaterials.set(color, material({ color, roughness: 0.78 }));
    return accentMaterials.get(color);
  }

  function meshBox(group, size, position, meshMaterial, selectable = false) {
    const geometry = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    mesh.position.set(...position);
    group.add(mesh);
    if (selectable) pickTargets.add(mesh);
    return mesh;
  }

  function disposeGroup(group) {
    group.traverse(object => {
      pickTargets.delete(object);
      if (object.geometry && !sharedGeometries.has(object.geometry)) object.geometry.dispose();
      if (object.userData.themeSign) {
        object.material.map.dispose();
        object.material.dispose();
      }
    });
    group.removeFromParent();
  }

  function addSegment(index) {
    const start = index * ROOM_LAYOUT.segmentLength;
    const center = start + ROOM_LAYOUT.segmentLength / 2;
    const group = new THREE.Group();
    group.userData.segment = index;
    scene.add(group);
    meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, 0.16, ROOM_LAYOUT.segmentLength], [0, -0.08, center], floor, true);
    meshBox(group, [ROOM_LAYOUT.aisleHalfWidth * 1.65, 0.018, ROOM_LAYOUT.segmentLength - 0.2], [0, 0.012, center], aisle, true);
    meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, 0.16, ROOM_LAYOUT.segmentLength], [0, ROOM_LAYOUT.ceilingHeight, center], ceiling, true);
    meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, ROOM_LAYOUT.segmentLength], [-ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, center], wallSteel, true);
    meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, ROOM_LAYOUT.segmentLength], [ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, center], wallSteel, true);
    // Shallow ribs and floor rails make each steel bay read at walking speed
    // without extra textures, shadows, or a continuous render loop.
    for (const z of [start + 0.08, start + ROOM_LAYOUT.segmentLength - 0.08]) {
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2 - 0.24, 0.055, 0.055], [0, 0.04, z], shelfEdge, true);
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2 - 0.24, 0.045, 0.045], [0, ROOM_LAYOUT.ceilingHeight - 0.04, z], shelfEdge, true);
    }

    for (const shelf of layout.shelves.filter(entry => entry.segmentIndex === index)) {
      const side = shelf.side;
      const shelfX = side * 4.48;
      const shelfMaterial = accent(shelf.theme);
      meshBox(group, [0.18, 5.22, ROOM_LAYOUT.segmentLength - 0.34], [side * 4.9, 2.61, center], shelfEdge, true);
      for (const y of [0.35, 1.67, 3.25, 4.83]) {
        meshBox(group, [1.25, 0.13, ROOM_LAYOUT.segmentLength - 0.34], [shelfX, y, center], shelfSteel, true);
      }
      for (const z of [start + 0.18, start + ROOM_LAYOUT.segmentLength - 0.18]) {
        meshBox(group, [1.16, 4.62, 0.12], [shelfX, 2.59, z], shelfEdge, true);
      }
      meshBox(group, [1.18, 0.36, ROOM_LAYOUT.segmentLength - 0.5], [shelfX, 5.08, center], shelfMaterial, true);
      const signCanvas = document.createElement('canvas');
      signCanvas.width = 1024;
      signCanvas.height = 80;
      const context = signCanvas.getContext('2d');
      if (context) {
        context.fillStyle = '#fff7e9';
        context.font = '600 48px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(shorten(context, shelf.theme, 960), 512, 57);
        const texture = new THREE.CanvasTexture(signCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 0.46), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
        sign.position.set(side * 3.88, 5.08, center);
        sign.rotation.y = -side * Math.PI / 2;
        sign.userData.themeSign = true;
        group.add(sign);
      }
    }
    if (index === 0) {
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, ROOM_LAYOUT.ceilingHeight, 0.18], [0, ROOM_LAYOUT.ceilingHeight / 2, 0], wallSteel, true);
      // Heavy outer vault frame ring
      const frameOuter = new THREE.Mesh(new THREE.CylinderGeometry(2.36, 2.36, 0.32, 32), shelfEdge);
      frameOuter.rotation.x = Math.PI / 2;
      frameOuter.position.set(0, 2.64, 0.16);
      group.add(frameOuter);

      // Main circular vault door with textured face
      const doorMaterials = [shelfSteel, material({ map: doorTexture, color: 0xdde4e8, metalness: 0.72, roughness: 0.38 }), shelfSteel];
      const door = new THREE.Mesh(new THREE.CylinderGeometry(2.14, 2.14, 0.26, 32), doorMaterials);
      door.rotation.x = Math.PI / 2;
      door.position.set(0, 2.64, 0.18);
      group.add(door);

      // Left cylindrical heavy hinges
      const hingeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.52, 16), shelfEdge);
      hingeTop.position.set(-2.02, 3.4, 0.2);
      group.add(hingeTop);
      const hingeBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.52, 16), shelfEdge);
      hingeBottom.position.set(-2.02, 1.88, 0.2);
      group.add(hingeBottom);

      // Radial locking bolts extending into frame
      for (let a = 0; a < 6; a++) {
        const angle = (a * Math.PI) / 3;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.44, 12), shelfEdge);
        bolt.rotation.z = angle;
        bolt.position.set(Math.cos(angle) * 2.06, 2.64 + Math.sin(angle) * 2.06, 0.18);
        group.add(bolt);
      }

      // Central locking wheel spokes and heavy hub
      meshBox(group, [1.8, 0.08, 0.12], [0, 2.64, 0.05], shelfEdge, true);
      meshBox(group, [0.08, 1.8, 0.12], [0, 2.64, 0.05], shelfEdge, true);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 24), shelfEdge);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, 2.64, -0.02);
      group.add(hub);
    }
    if (index === layout.segmentCount - 1) {
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, ROOM_LAYOUT.ceilingHeight, 0.18], [0, ROOM_LAYOUT.ceilingHeight / 2, layout.bounds.maxZ], wallSteel, true);
    }
    residentSegments.set(index, group);
  }

  function removeBox(record) {
    if (record.image) {
      record.image.onload = null;
      record.image.onerror = null;
      record.image.removeAttribute('src');
    }
    record.texture?.dispose();
    record.frontMaterial?.dispose();
    pickTargets.delete(record.body);
    record.body.removeFromParent();
  }

  function drawCard(record, image = null) {
    const { box, context, canvas: card } = record;
    context.fillStyle = '#f7f2e9';
    context.fillRect(0, 0, card.width, card.height);
    if (image?.naturalWidth && image?.naturalHeight) {
      const scale = Math.min(470 / image.naturalWidth, 330 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (512 - width) / 2, 8 + (330 - height) / 2, width, height);
    } else {
      context.fillStyle = '#dfd4c3';
      context.fillRect(35, 35, 442, 270);
      context.fillStyle = '#9b6044';
      for (let column = 0; column < 4; column++) context.fillRect(118 + column * 71, 105 + (column % 2) * 42, 55, 55);
    }
    context.fillStyle = '#30261f';
    context.font = '700 30px system-ui, sans-serif';
    context.textAlign = 'left';
    context.fillText(shorten(context, box.name, 470), 21, 374);
    context.font = '600 22px system-ui, sans-serif';
    context.fillStyle = '#6d5140';
    const facts = [box.set_num, box.year].filter(Boolean).join('  ·  ');
    context.fillText(shorten(context, facts, 470), 21, 407);
    record.texture.needsUpdate = true;
  }

  function addTexture(record) {
    if (record.texture) return;
    const card = document.createElement('canvas');
    card.width = 512;
    card.height = 432;
    const context = card.getContext('2d');
    if (!context) return;
    const texture = new THREE.CanvasTexture(card);
    texture.colorSpace = THREE.SRGBColorSpace;
    const frontMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72 });
    record.canvas = card;
    record.context = context;
    record.frontMaterial = frontMaterial;
    record.texture = texture;
    record.body.material[record.frontIndex] = frontMaterial;
    drawCard(record);
    if (record.box.image_url) {
      const image = new Image();
      record.image = image;
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (destroyed || residentBoxes.get(record.box.index) !== record) return;
        drawCard(record, image);
        requestTextureRender();
      };
      image.onerror = () => {};
      image.src = record.box.image_url;
    }
  }

  function removeTexture(record) {
    if (!record.texture) return;
    if (record.image) {
      record.image.onload = null;
      record.image.onerror = null;
      record.image.removeAttribute('src');
    }
    record.image = null;
    record.texture.dispose();
    record.frontMaterial.dispose();
    record.texture = null;
    record.frontMaterial = null;
    record.canvas = null;
    record.context = null;
    pendingTextureLoads.delete(record.box.index);
    record.body.material[record.frontIndex] = boxFront;
  }

  function requestTextureRender() {
    // Image completions can arrive as separate tasks. Debounce their texture
    // uploads so a cached image burst still produces one trailing idle frame.
    if (destroyed || textureLoadPaused || hasMovement()) return;
    if (textureRenderTimer) clearTimeout(textureRenderTimer);
    textureRenderTimer = window.setTimeout(() => {
      textureRenderTimer = 0;
      if (!destroyed && !textureLoadPaused && !hasMovement()) renderNow();
    }, 50);
  }

  function scheduleTextureLoads(records) {
    pendingTextureLoads.clear();
    for (const record of records) if (!record.texture) pendingTextureLoads.add(record.box.index);
    if (textureLoadScheduled || textureLoadPaused || hasMovement() || !pendingTextureLoads.size) return;
    textureLoadScheduled = true;
    const pump = deadline => {
      // Build cards in bounded idle slices. Rendering each card individually
      // uploaded the whole scene 60 times and delayed input by several seconds
      // under software WebGL. A single deferred render uploads the completed
      // batch while yielding whenever input begins.
      if (destroyed || textureLoadPaused || hasMovement() || !active()) {
        textureLoadScheduled = false;
        return;
      }
      const started = performance.now();
      do {
        const next = pendingTextureLoads.values().next().value;
        if (next === undefined) break;
        pendingTextureLoads.delete(next);
        const record = residentBoxes.get(next);
        if (record) addTexture(record);
      } while (pendingTextureLoads.size && performance.now() - started < 4 && (!deadline || deadline.timeRemaining() > 1));
      if (pendingTextureLoads.size) scheduleIdle(pump);
      else {
        textureLoadScheduled = false;
        requestTextureRender();
      }
    };
    scheduleIdle(pump);
  }

  function scheduleIdle(callback) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 100 });
    else window.setTimeout(() => callback(null), 0);
  }

  function addBox(box) {
    const frontIndex = box.side < 0 ? 0 : 1;
    const materials = [boxSide, boxSide, boxSide, boxSide, boxSide, boxSide];
    materials[frontIndex] = boxFront;
    const body = new THREE.Mesh(boxGeometry, materials);
    body.position.set(box.x, box.y, box.z);
    body.userData.setNum = box.set_num;
    scene.add(body);
    pickTargets.add(body);
    const record = { body, box, frontIndex, frontMaterial: null, image: null, texture: null };
    residentBoxes.set(box.index, record);
    return record;
  }

  function reconcileResidents(force = false, includeTextures = true) {
    const segment = Math.max(0, Math.min(layout.segmentCount - 1, Math.floor(pose.z / ROOM_LAYOUT.segmentLength)));
    if (!force && segment === residentSegment) return;
    residentSegment = segment;
    const selectionPose = { ...pose, x: 0, z: (segment + 0.5) * ROOM_LAYOUT.segmentLength };
    const selected = selectRoomResidents(layout, selectionPose, ROOM_RESIDENT_BOX_LIMIT);
    const desired = new Set(selected.map(box => box.index));
    for (const [index, record] of residentBoxes) {
      if (!desired.has(index)) {
        removeBox(record);
        residentBoxes.delete(index);
      }
    }
    for (const box of selected) if (!residentBoxes.has(box.index)) addBox(box);
    const textured = includeTextures ? selected.slice(0, IMAGE_TEXTURE_LIMIT).map(box => residentBoxes.get(box.index)).filter(Boolean) : [];
    const texturedIndexes = new Set(textured.map(record => record.box.index));
    for (const [index, record] of residentBoxes) if (!texturedIndexes.has(index)) removeTexture(record);
    if (includeTextures) scheduleTextureLoads(textured);

    const minimumSegment = Math.max(0, segment - RESIDENT_SEGMENT_RADIUS);
    const maximumSegment = Math.min(layout.segmentCount - 1, segment + RESIDENT_SEGMENT_RADIUS);
    for (const [index, group] of residentSegments) {
      if (index < minimumSegment || index > maximumSegment) {
        disposeGroup(group);
        residentSegments.delete(index);
      }
    }
    for (let index = minimumSegment; index <= maximumSegment; index++) {
      if (!residentSegments.has(index)) addSegment(index);
    }
    stage.dataset.residentBoxes = String(residentBoxes.size);
  }

  function active() {
    if (destroyed) return false;
    if (!stage.isConnected || !isCurrent()) {
      controller.destroy();
      return false;
    }
    return !manuallyPaused && !document.hidden;
  }

  function updateCamera() {
    const horizontal = Math.cos(pose.pitch);
    camera.position.set(pose.x, ROOM_LAYOUT.eyeHeight, pose.z);
    camera.lookAt(
      pose.x + Math.sin(pose.yaw) * horizontal,
      ROOM_LAYOUT.eyeHeight + Math.sin(pose.pitch),
      pose.z + Math.cos(pose.yaw) * horizontal,
    );
    warmLight.position.set(pose.x * 0.2, 4.7, pose.z + 1.5);
    stage.dataset.cameraX = pose.x.toFixed(3);
    stage.dataset.cameraZ = pose.z.toFixed(3);
    stage.dataset.cameraYaw = pose.yaw.toFixed(5);
    stage.dataset.cameraPitch = pose.pitch.toFixed(5);
  }

  function renderNow() {
    if (!active()) return;
    reconcileResidents();
    updateCamera();
    renderer.render(scene, camera);
  }

  function beginModalTransition() {
    textureLoadPaused = true;
    pendingTextureLoads.clear();
    if (textureRenderTimer) clearTimeout(textureRenderTimer);
    textureRenderTimer = 0;
  }

  function resumeAfterModal() {
    if (destroyed) return;
    restoreBoxPickup();
    textureLoadPaused = false;
    manuallyPaused = false;
    resetInputs();
    if (document.hidden) return;
    reconcileResidents(false, false);
    updateCamera();
    renderer.render(scene, camera);
    const segment = Math.max(0, Math.min(layout.segmentCount - 1, Math.floor(pose.z / ROOM_LAYOUT.segmentLength)));
    const selected = selectRoomResidents(layout, { ...pose, x: 0, z: (segment + 0.5) * ROOM_LAYOUT.segmentLength }, IMAGE_TEXTURE_LIMIT);
    scheduleTextureLoads(selected.map(box => residentBoxes.get(box.index)).filter(Boolean));
  }

  function keyInput() {
    const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    const strafe = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    return { forward: forward + joystickVector.forward, strafe: strafe + joystickVector.strafe };
  }

  function hasMovement() {
    const input = keyInput();
    return Math.abs(input.forward) > 0.01 || Math.abs(input.strafe) > 0.01;
  }

  function cancelFrame() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrameTime = 0;
  }

  function movementFrame(time) {
    frame = 0;
    if (!active() || !hasMovement()) {
      lastFrameTime = 0;
      return;
    }
    pose = moveRoomPose(layout, pose, keyInput(), (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    renderNow();
    frame = requestAnimationFrame(movementFrame);
  }

  function flushMovement(time = performance.now()) {
    if (!lastFrameTime || !active() || !hasMovement()) return;
    pose = moveRoomPose(layout, pose, keyInput(), (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    renderNow();
  }

  function beginMovement() {
    if (!active() || !hasMovement() || frame) return;
    if (textureRenderTimer) clearTimeout(textureRenderTimer);
    textureRenderTimer = 0;
    // Starting from rest otherwise spends the first RAF only establishing a
    // timestamp. Commit one bounded step immediately, then retain the event
    // timestamp so keyup can flush elapsed input if rendering delays every RAF.
    pose = moveRoomPose(layout, pose, keyInput(), 1 / 60);
    lastFrameTime = performance.now();
    renderNow();
    frame = requestAnimationFrame(movementFrame);
  }

  function resetInputs() {
    flushMovement();
    keys.clear();
    joystickPointer = null;
    joystickVector = { forward: 0, strafe: 0 };
    drag = null;
    if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
    cancelFrame();
  }

  function look(dx, dy) {
    pose.yaw = Math.atan2(Math.sin(pose.yaw - dx * LOOK_SPEED), Math.cos(pose.yaw - dx * LOOK_SPEED));
    pose.pitch = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, pose.pitch - dy * LOOK_SPEED));
    renderNow();
  }

  function animateBoxPickup(mesh) {
    if (activePickup?.mesh) restoreBoxPickup();
    activePickup = {
      mesh,
      origY: mesh.position.y,
      origRotX: mesh.rotation.x
    };
    mesh.position.y += 0.22;
    mesh.rotation.x -= 0.1;
    renderNow();
  }

  function restoreBoxPickup() {
    if (activePickup?.mesh) {
      activePickup.mesh.position.y = activePickup.origY;
      activePickup.mesh.rotation.x = activePickup.origRotX;
      activePickup = null;
      renderNow();
    }
  }

  function pick(clientX, clientY, center = false) {
    if (!active()) return;
    const bounds = canvas.getBoundingClientRect();
    const x = center ? 0 : ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
    const y = center ? 0 : -((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
    const targets = [...pickTargets];

    let selectedSetNum = null;
    let selectedMesh = null;

    // 1. Direct raycast
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const directHit = raycaster.intersectObjects(targets, false)[0];
    if (directHit?.object.userData.setNum) {
      selectedSetNum = directHit.object.userData.setNum;
      selectedMesh = directHit.object;
    }

    // 2. Multi-ring search if direct miss (forgiving touch target)
    if (!selectedSetNum) {
      const ringPixels = [14, 28, 44];
      for (const px of ringPixels) {
        const tolX = px / Math.max(1, bounds.width);
        const tolY = px / Math.max(1, bounds.height);
        const offsets = [
          [-tolX, 0], [tolX, 0], [0, -tolY], [0, tolY],
          [-tolX * 0.7, -tolY * 0.7], [tolX * 0.7, -tolY * 0.7],
          [-tolX * 0.7, tolY * 0.7], [tolX * 0.7, -tolY * 0.7]
        ];
        for (const [offsetX, offsetY] of offsets) {
          raycaster.setFromCamera(new THREE.Vector2(x + offsetX, y + offsetY), camera);
          const hit = raycaster.intersectObjects(targets, false)[0];
          if (hit?.object.userData.setNum) {
            selectedSetNum = hit.object.userData.setNum;
            selectedMesh = hit.object;
            break;
          }
        }
        if (selectedSetNum) break;
      }
    }

    // 3. Screen-space proximity fallback for mobile touch
    if (!selectedSetNum && residentBoxes.size > 0 && !center) {
      let closestDist = 52; // generous 52px touch radius
      const v = new THREE.Vector3();
      for (const record of residentBoxes.values()) {
        const body = record.body;
        if (!body.userData.setNum) continue;
        v.setFromMatrixPosition(body.matrixWorld);
        v.project(camera);
        if (v.z > 0 && v.z < 1) {
          const sx = ((v.x + 1) / 2) * bounds.width + bounds.left;
          const sy = ((-v.y + 1) / 2) * bounds.height + bounds.top;
          const dist = Math.hypot(clientX - sx, clientY - sy);
          if (dist < closestDist) {
            closestDist = dist;
            selectedSetNum = body.userData.setNum;
            selectedMesh = body;
          }
        }
      }
    }

    if (selectedSetNum) {
      if (selectedMesh) animateBoxPickup(selectedMesh);
      resetInputs();
      inspecting = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      onSelect(selectedSetNum);
      return;
    }
  }

  function updateJoystick(event) {
    if (!joystick) return;
    const bounds = joystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) / 2 - 22);
    let dx = event.clientX - (bounds.left + bounds.width / 2);
    let dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = dx / distance * radius;
      dy = dy / distance * radius;
    }
    joystickVector = { forward: -dy / radius, strafe: dx / radius };
    if (knob) knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    beginMovement();
  }

  const controller = {
    async capturePointer() {
      if (!active()) return;
      if (!canvas.requestPointerLock) throw new Error('Pointer capture unavailable');
      await canvas.requestPointerLock();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      restoreBoxPickup();
      steelTexture?.dispose();
      floorTexture?.dispose();
      doorTexture?.dispose();
      if (textureRenderTimer) clearTimeout(textureRenderTimer);
      textureRenderTimer = 0;
      resetInputs();
      abort.abort();
      resizeObserver?.disconnect();
      removalObserver?.disconnect();
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      for (const record of residentBoxes.values()) removeBox(record);
      residentBoxes.clear();
      for (const group of residentSegments.values()) disposeGroup(group);
      residentSegments.clear();
      for (const geometry of sharedGeometries) geometry.dispose();
      for (const meshMaterial of sharedMaterials) meshMaterial.dispose();
      renderer.dispose();
      // Calling forceContextLoss() from inside a real context-lost callback can
      // deadlock Chromium's GPU process. The context is already gone there.
      if (!contextLost) renderer.forceContextLoss();
      if (joystick) joystick.style.touchAction = previousJoystickTouchAction;
      if (knob) knob.style.transform = '';
      canvas.remove();
    },
    getPose() {
      return { pitch: pose.pitch, x: pose.x, yaw: pose.yaw, z: pose.z };
    },
    reset() {
      if (destroyed) return;
      resetInputs();
      pose = { ...layout.spawn };
      reconcileResidents(true);
      renderNow();
    },
    setInspecting(value) {
      const next = Boolean(value);
      if (inspecting === next) return;
      inspecting = next;
      manuallyPaused = inspecting;
      resetInputs();
      if (inspecting && document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!inspecting) {
        restoreBoxPickup();
        renderNow();
      }
    },
    rotateInspection(delta) {
      if (!inspecting || !Number.isFinite(delta)) return;
      onInspectionRotate(delta);
    },
    beginModalTransition,
    resumeAfterModal,
    setPaused(value, { render = true } = {}) {
      manuallyPaused = Boolean(value);
      resetInputs();
      if (manuallyPaused && document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!manuallyPaused && render) renderNow();
    },
    teleportToSet(setNum) {
      if (destroyed) return false;
      const destination = roomPoseForSet(layout, setNum);
      if (!destination) return false;
      resetInputs();
      pose = destination;
      // A search result may be hundreds of bays away. Rebuilding and uploading
      // the resident window synchronously inside the sheet's click task can
      // starve assistive-state/focus updates in software WebGL. Commit the pose
      // immediately and let the sheet-close resume render reconcile the bay.
      residentSegment = -1;
      updateCamera();
      return true;
    },
  };

  try {
    if (joystick) joystick.style.touchAction = 'none';
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
        return;
      }
      if (!active() || isTypingTarget(event.target) || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      beginMovement();
    }, { signal: abort.signal });
    window.addEventListener('keyup', event => {
      if (!keys.has(event.code)) return;
      flushMovement();
      keys.delete(event.code);
      if (!hasMovement()) cancelFrame();
    }, { signal: abort.signal });
    window.addEventListener('blur', resetInputs, { signal: abort.signal });
    let skipFirstPointerLockMove = false;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) resetInputs();
      else skipFirstPointerLockMove = true;
    }, { signal: abort.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetInputs();
    }, { signal: abort.signal });
    // Pointer lock guarantees mouse events; some platforms do not dispatch the
    // corresponding pointer events. Handle the completed click while still
    // locked, before releasing the cursor to show the details panel.
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas && active()) {
        if (skipFirstPointerLockMove) {
          skipFirstPointerLockMove = false;
          return;
        }
        look(event.movementX, event.movementY);
      }
    }, { signal: abort.signal });
    // Locked mouse input is completed at mouseup. Chromium on Linux may
    // retarget the later click to an overlay after the detail sheet unlocks
    // the cursor, so consume that trailing click before it reaches controls.
    let consumedLockedRelease = false;
    document.addEventListener('mouseup', event => {
      if (document.pointerLockElement !== canvas || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      consumedLockedRelease = true;
      requestAnimationFrame(() => { consumedLockedRelease = false; });
      pick(0, 0, true);
    }, { capture: true, signal: abort.signal });
    document.addEventListener('click', event => {
      if (event.button !== 0 || (!consumedLockedRelease && document.pointerLockElement !== canvas)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Do not select twice on platforms that send both mouseup and click.
      if (!consumedLockedRelease) pick(0, 0, true);
      consumedLockedRelease = false;
    }, { capture: true, signal: abort.signal });
    canvas.addEventListener('pointerdown', event => {
      if (!active() || drag || event.button !== 0 || document.pointerLockElement === canvas) return;
      event.preventDefault();
      drag = {
        id: event.pointerId,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        startTime: performance.now(),
        pointerType: event.pointerType || 'mouse'
      };
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }, { signal: abort.signal });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId || document.pointerLockElement === canvas) return;
      const totalDist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      const threshold = drag.pointerType === 'touch' ? 10 : 3;
      if (totalDist > threshold) drag.moved = true;
      if (drag.moved) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        look(dx, dy);
      }
    }, { signal: abort.signal });
    canvas.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const totalDist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      const duration = performance.now() - drag.startTime;
      const isTouchTap = drag.pointerType === 'touch' && totalDist < 16 && duration < 500;
      const isClick = !drag.moved || isTouchTap;
      const clickX = event.clientX;
      const clickY = event.clientY;
      drag = null;
      if (isClick) pick(clickX, clickY, document.pointerLockElement === canvas);
    }, { signal: abort.signal });
    canvas.addEventListener('pointercancel', () => { drag = null; }, { signal: abort.signal });
    canvas.addEventListener('dblclick', () => { void controller.capturePointer().catch(() => {}); }, { signal: abort.signal });
    joystick?.addEventListener('pointerdown', event => {
      if (!active() || joystickPointer !== null || event.button !== 0) return;
      event.preventDefault();
      joystickPointer = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      updateJoystick(event);
    }, { signal: abort.signal });
    joystick?.addEventListener('pointermove', event => {
      if (joystickPointer === event.pointerId) updateJoystick(event);
    }, { signal: abort.signal });
    const releaseJoystick = event => {
      if (joystickPointer !== event.pointerId) return;
      joystickPointer = null;
      joystickVector = { forward: 0, strafe: 0 };
      if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
      if (!hasMovement()) cancelFrame();
    };
    joystick?.addEventListener('pointerup', releaseJoystick, { signal: abort.signal });
    joystick?.addEventListener('pointercancel', releaseJoystick, { signal: abort.signal });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      if (!unavailableNotified) {
        unavailableNotified = true;
        controller.destroy();
        onUnavailable();
      }
    }, { signal: abort.signal });
    const checkRoute = () => {
      if (!destroyed && (!stage.isConnected || !isCurrent())) controller.destroy();
    };
    window.addEventListener('hashchange', checkRoute, { signal: abort.signal });
    window.addEventListener('popstate', checkRoute, { signal: abort.signal });
    window.addEventListener('pagehide', () => controller.destroy(), { signal: abort.signal });
    resizeObserver = new ResizeObserver(() => {
      if (destroyed) return;
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderNow();
    });
    resizeObserver.observe(stage);
    removalObserver = new MutationObserver(checkRoute);
    removalObserver.observe(document.body, { childList: true, subtree: true });
    reconcileResidents(true);
    updateCamera();
    renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), false);
    camera.aspect = Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return controller;
  } catch (error) {
    controller.destroy();
    throw error;
  }
}
