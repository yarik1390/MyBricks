// Importing the route never loads Three.js. This module and the existing vendor
// bundle are requested only after the collector presses Open 3D room.
export async function createCollectionRoom(stage, shelves, { isCurrent, onSelect, onUnavailable }) {
  if (Number(navigator.deviceMemory || 0) > 0 && navigator.deviceMemory <= 2) throw new Error('Low memory');
  const THREE = await import('../vendor/three-0.185.1.min.js');
  if (!stage.isConnected || !isCurrent()) return null;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x171c29);
  stage.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xfff5df, 0x27344b, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 8, 7);
  scene.add(light);
  const textures = [];
  const images = [];
  const selectable = [];
  let destroyed = false;
  let angle = 0;
  let zoom = 1;
  const abort = new AbortController();
  const wall = new THREE.MeshStandardMaterial({ color: 0x293347, roughness: 0.94 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb68950, roughness: 0.78 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x665343, roughness: 0.9 });
  const box = (width, height, depth, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };
  box(10.4, 7.2, 0.15, 0, 3.6, -0.65, wall);
  box(0.15, 7.2, 4.5, -5.2, 3.6, 1.55, wall);
  box(0.15, 7.2, 4.5, 5.2, 3.6, 1.55, wall);
  box(10.5, 0.15, 5.2, 0, -0.2, 1.8, floor);

  const render = () => {
    if (destroyed || document.hidden || !stage.isConnected || !isCurrent()) return;
    const aspect = camera.aspect;
    const distance = Math.max(11.5, 7.7 / Math.max(0.25, aspect)) * zoom;
    camera.position.set(Math.sin(angle) * distance, 4.1, Math.cos(angle) * distance);
    camera.lookAt(0, 3.3, 0);
    renderer.render(scene, camera);
  };
  const textCanvas = (width, height) => {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    const context = element.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    return { element, context };
  };
  const shorten = (context, text, width) => {
    let value = String(text);
    if (context.measureText(value).width <= width) return value;
    while (value.length && context.measureText(`${value}...`).width > width) value = value.slice(0, -1);
    return `${value}...`;
  };
  const texturedPlane = (element, width, height, x, y, z) => {
    const texture = new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return { mesh, texture };
  };
  const resize = () => {
    if (destroyed) return;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  let resizeObserver;
  let removalObserver;
  const controller = {
    move(action) {
      if (destroyed) return;
      if (action === 'left') angle = Math.max(-0.5, angle - 0.12);
      if (action === 'right') angle = Math.min(0.5, angle + 0.12);
      if (action === 'closer') zoom = Math.max(0.75, zoom - 0.12);
      if (action === 'farther') zoom = Math.min(1.45, zoom + 0.12);
      if (action === 'reset') { angle = 0; zoom = 1; }
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      resizeObserver?.disconnect();
      removalObserver?.disconnect();
      for (const image of images) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
      for (const texture of textures) texture.dispose();
      const materials = new Set();
      scene.traverse(object => {
        object.geometry?.dispose();
        if (object.material) materials.add(object.material);
      });
      for (const material of materials) material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  try {
    shelves.forEach((shelf, row) => {
      const y = 5.5 - row * 2.05;
      box(9.7, 0.14, 1.2, 0, y - 0.92, 0, wood);
      const label = textCanvas(1024, 64);
      label.context.fillStyle = '#b68950';
      label.context.fillRect(0, 0, 1024, 64);
      label.context.fillStyle = '#201c17';
      label.context.font = 'bold 30px sans-serif';
      label.context.fillText(shorten(label.context, shelf.theme, 960), 24, 44);
      texturedPlane(label.element, 9.7, 0.3, 0, y - 1, 0.62);
      shelf.items.forEach((item, column) => {
        const x = -3.6 + column * 2.4;
        box(2.23, 1.76, 0.13, x, y, -0.1, wood);
        const card = textCanvas(512, 400);
        const ctx = card.context;
        ctx.fillStyle = '#fcfaf5';
        ctx.fillRect(0, 0, 512, 400);
        ctx.fillStyle = '#364154';
        ctx.font = 'bold 38px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(shorten(ctx, item.set_num, 450), 256, 160);
        ctx.font = 'bold 25px sans-serif';
        ctx.fillText(shorten(ctx, item.name, 474), 256, 345);
        ctx.font = '22px sans-serif';
        const identityAndQuantity = `${item.set_num}  \u00d7 ${item.quantity}`;
        ctx.fillText(identityAndQuantity, 256, 380);
        const { mesh, texture } = texturedPlane(card.element, 2.16, 1.69, x, y, -0.025);
        mesh.userData.setNum = item.set_num;
        selectable.push(mesh);
        if (item.image_url) {
          const image = new Image();
          images.push(image);
          image.crossOrigin = 'anonymous';
          image.onload = () => {
            if (destroyed || !isCurrent() || !image.naturalWidth || !image.naturalHeight) return;
            const scale = Math.min(460 / image.naturalWidth, 286 / image.naturalHeight);
            ctx.fillStyle = '#fcfaf5';
            ctx.fillRect(0, 0, 512, 310);
            ctx.drawImage(image, (512 - image.naturalWidth * scale) / 2, 10 + (286 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
            texture.needsUpdate = true;
            render();
          };
          image.onerror = () => { /* The readable set-number card remains. */ };
          image.src = item.image_url;
        }
      });
    });
    const raycaster = new THREE.Raycaster();
    let drag = null;
    canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, angle, moved: false };
      canvas.setPointerCapture(event.pointerId);
    }, { signal: abort.signal });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      drag.moved ||= Math.hypot(dx, event.clientY - drag.y) > 6;
      angle = Math.max(-0.5, Math.min(0.5, drag.angle + dx / 450));
      render();
    }, { signal: abort.signal });
    canvas.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const click = !drag.moved;
      drag = null;
      if (!click) return;
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(selectable)[0];
      if (hit) onSelect(hit.object.userData.setNum);
    }, { signal: abort.signal });
    canvas.addEventListener('pointercancel', () => { drag = null; }, { signal: abort.signal });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      controller.destroy();
      onUnavailable();
    }, { signal: abort.signal });
    document.addEventListener('visibilitychange', render, { signal: abort.signal });
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    removalObserver = new MutationObserver(() => {
      if (!stage.isConnected || !isCurrent()) controller.destroy();
    });
    removalObserver.observe(document.body, { childList: true, subtree: true });
    resize();
    return controller;
  } catch (error) {
    controller.destroy();
    throw error;
  }
}
