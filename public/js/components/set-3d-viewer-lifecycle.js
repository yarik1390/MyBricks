export async function createSet3dViewerLifecycle(sheet, mount, onReady, onError) {
  let closed = false;
  let viewer = null;
  let disposed = false;

  const disposeViewer = () => {
    if (!viewer || disposed) return;
    disposed = true;
    viewer.dispose();
  };
  const onClosing = () => {
    closed = true;
    disposeViewer();
  };

  sheet.addEventListener('sheet:closing', onClosing, { once: true });

  try {
    viewer = await mount();
  } catch (error) {
    sheet.removeEventListener('sheet:closing', onClosing);
    if (!closed) onError?.(error);
    return null;
  }

  if (closed) {
    disposeViewer();
    return null;
  }

  onReady?.(viewer);
  return viewer;
}
