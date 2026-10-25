const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glasstv', {
  loadPlaylist: (opts) => ipcRenderer.invoke('playlist:load', opts || {}),
  setStreamHeaders: (opts) => ipcRenderer.invoke('stream:headers', opts),
  toggleFullscreen: (flag) => ipcRenderer.invoke('window:fullscreen', flag),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
});
