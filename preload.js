const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glasstv', {
  loadPlaylist: (opts) => ipcRenderer.invoke('playlist:load', opts || {}),
  loadSources: (opts) => ipcRenderer.invoke('sources:load', opts || {}),
  listSources: () => ipcRenderer.invoke('sources:list'),
  addSource: (src) => ipcRenderer.invoke('sources:add', src),
  removeSource: (id) => ipcRenderer.invoke('sources:remove', id),
  probeStreams: (items) => ipcRenderer.invoke('streams:probe', items),
  eplFixtures: () => ipcRenderer.invoke('fixtures:epl'),
  setStreamHeaders: (opts) => ipcRenderer.invoke('stream:headers', opts),
  toggleFullscreen: (flag) => ipcRenderer.invoke('window:fullscreen', flag),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
});
