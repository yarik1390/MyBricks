import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

function currentWindow(win) {
  if (win) return win;
  return typeof window !== 'undefined' ? window : undefined;
}

function browserDownload(blob, fileName, win) {
  const url = win.URL.createObjectURL(blob);
  const link = win.document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  win.document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/**
 * Share a generated file through the native Android/iOS share sheet. Blob
 * downloads are unreliable inside a Capacitor WebView, so the native path
 * writes to the cache directory first. Web/PWA keeps the normal download.
 */
export async function exportBlob(blob, fileName, { title } = {}, win) {
  const w = currentWindow(win);
  if (isNativeCapacitor(w)) {
    const Filesystem = getCapacitorPlugin('Filesystem', w);
    const Share = getCapacitorPlugin('Share', w);
    if (Filesystem?.writeFile && Filesystem?.getUri && Share?.share) {
      const data = await blob.text();
      await Filesystem.writeFile({
        path: fileName,
        data,
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true,
      });
      const { uri } = await Filesystem.getUri({ path: fileName, directory: 'CACHE' });
      await Share.share({ title: title || fileName, files: [uri], dialogTitle: title || fileName });
      return 'shared';
    }
  }
  if (!w?.URL || !w?.document) return 'unsupported';
  return browserDownload(blob, fileName, w);
}
