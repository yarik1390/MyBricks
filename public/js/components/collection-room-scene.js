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
  renderer.setClearColor(0x2a211b);
  stage.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a211b);
  scene.fog = new THREE.Fog(0x2a211b, 22, 42);
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
  let destroyed = false;
  let unavailableNotified = false;
  let manuallyPaused = false;
  let frame = 0;
  let lastFrameTime = 0;
  let residentSegment = -1;
  let resizeObserver;
  let removalObserver;
  let pose = normalizeRoomPose(layout, options.initialPose);

  const material = parameters => {
    const value = new THREE.MeshStandardMaterial(parameters);
    sharedMaterials.add(value);
    return value;
  };
  const plaster = material({ color: 0xd7c7ae, roughness: 0.96 });
  const ceiling = material({ color: 0xeadfcb, roughness: 0.98 });
  const floor = material({ color: 0x6f4f36, metalness: 0.02, roughness: 0.88 });
  const aisle = material({ color: 0x8d7157, roughness: 0.94 });
  const wood = material({ color: 0x70462c, roughness: 0.82 });
  const darkWood = material({ color: 0x422a1c, roughness: 0.9 });
  const boxSide = material({ color: 0xd2c7b5, roughness: 0.78 });
  const boxFront = material({ color: 0xf2ede4, roughness: 0.82 });
  const accentMaterials = new Map();
  const boxGeometry = new THREE.BoxGeometry(ROOM_LAYOUT.boxDepth, ROOM_LAYOUT.boxHeight, ROOM_LAYOUT.boxWidth);
  sharedGeometries.add(boxGeometry);

  scene.add(new THREE.HemisphereLight(0xffefd2, 0x33261d, 2.15));
  const keyLight = new THREE.DirectionalLight(0xffe4b5, 1.85);
  keyLight.position.set(-3, 5.6, 4);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight(0xffb65c, 3.4, 19, 1.8);
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
    meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, ROOM_LAYOUT.segmentLength], [-ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, center], plaster, true);
    meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, ROOM_LAYOUT.segmentLength], [ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, center], plaster, true);

    for (const shelf of layout.shelves.filter(entry => entry.segmentIndex === index)) {
      const side = shelf.side;
      const shelfX = side * 4.48;
      const shelfMaterial = accent(shelf.theme);
      meshBox(group, [0.18, 5.22, ROOM_LAYOUT.segmentLength - 0.34], [side * 4.9, 2.61, center], darkWood, true);
      for (const y of [0.35, 1.67, 3.25, 4.83]) {
        meshBox(group, [1.25, 0.13, ROOM_LAYOUT.segmentLength - 0.34], [shelfX, y, center], wood, true);
      }
      for (const z of [start + 0.18, start + ROOM_LAYOUT.segmentLength - 0.18]) {
        meshBox(group, [1.16, 4.62, 0.12], [shelfX, 2.59, z], darkWood, true);
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
    if (index === 0) meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, ROOM_LAYOUT.ceilingHeight, 0.18], [0, ROOM_LAYOUT.ceilingHeight / 2, 0], plaster, true);
    if (index === layout.segmentCount - 1) {
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, ROOM_LAYOUT.ceilingHeight, 0.18], [0, ROOM_LAYOUT.ceilingHeight / 2, layout.bounds.maxZ], plaster, true);
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
        renderNow();
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
    record.body.material[record.frontIndex] = boxFront;
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

  function reconcileResidents(force = false) {
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
    const textured = new Set(selected.slice(0, IMAGE_TEXTURE_LIMIT).map(box => box.index));
    for (const [index, record] of residentBoxes) {
      if (textured.has(index)) addTexture(record);
      else removeTexture(record);
    }

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
    if (lastFrameTime) pose = moveRoomPose(layout, pose, keyInput(), (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    renderNow();
    frame = requestAnimationFrame(movementFrame);
  }

  function beginMovement() {
    if (active() && hasMovement() && !frame) frame = requestAnimationFrame(movementFrame);
  }

  function resetInputs() {
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

  function pick(clientX, clientY, center = false) {
    if (!active()) return;
    const bounds = canvas.getBoundingClientRect();
    const x = center ? 0 : ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
    const y = center ? 0 : -((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
    const targets = [...pickTargets];
    const toleranceX = 12 / Math.max(1, bounds.width);
    const toleranceY = 12 / Math.max(1, bounds.height);
    const aimOffsets = [[0, 0], [-toleranceX, 0], [toleranceX, 0], [0, -toleranceY], [0, toleranceY]];
    for (const [offsetX, offsetY] of aimOffsets) {
      raycaster.setFromCamera(new THREE.Vector2(x + offsetX, y + offsetY), camera);
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (hit?.object.userData.setNum) {
        onSelect(hit.object.userData.setNum);
        return;
      }
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
      renderer.forceContextLoss();
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
    setPaused(value) {
      manuallyPaused = Boolean(value);
      resetInputs();
      if (manuallyPaused && document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!manuallyPaused) renderNow();
    },
    teleportToSet(setNum) {
      if (destroyed) return false;
      const destination = roomPoseForSet(layout, setNum);
      if (!destination) return false;
      resetInputs();
      pose = destination;
      reconcileResidents(true);
      renderNow();
      return true;
    },
  };

  try {
    if (joystick) joystick.style.touchAction = 'none';
    window.addEventListener('keydown', event => {
      if (!active() || isTypingTarget(event.target) || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      beginMovement();
    }, { signal: abort.signal });
    window.addEventListener('keyup', event => {
      if (!keys.delete(event.code)) return;
      if (!hasMovement()) cancelFrame();
    }, { signal: abort.signal });
    window.addEventListener('blur', resetInputs, { signal: abort.signal });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) resetInputs();
    }, { signal: abort.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetInputs();
    }, { signal: abort.signal });
    // Pointer lock guarantees mouse events; some platforms do not dispatch the
    // corresponding pointer events. Handle the completed click while still
    // locked, before releasing the cursor to show the details panel.
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas && active()) look(event.movementX, event.movementY);
    }, { signal: abort.signal });
    document.addEventListener('click', event => {
      if (document.pointerLockElement !== canvas || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pick(0, 0, true);
    }, { capture: true, signal: abort.signal });
    canvas.addEventListener('pointerdown', event => {
      if (!active() || drag || event.button !== 0 || document.pointerLockElement === canvas) return;
      event.preventDefault();
      drag = { id: event.pointerId, moved: false, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }, { signal: abort.signal });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId || document.pointerLockElement === canvas) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 2) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      look(dx, dy);
    }, { signal: abort.signal });
    canvas.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const click = !drag.moved;
      drag = null;
      if (click) pick(event.clientX, event.clientY, document.pointerLockElement === canvas);
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
