'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('hali', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(c)),
  setInteractive: (on) => ipcRenderer.send('interactive', !!on),
  pathForFile: (file) => webUtils.getPathForFile(file),
  getState: () => ipcRenderer.invoke('get-state'),
  hideItems: (list) => ipcRenderer.invoke('hide-items', list),
  restoreItem: (p) => ipcRenderer.invoke('restore-item', p),
  openItem: (p) => ipcRenderer.invoke('open-item', p),
  moveItem: (p, x, y) => ipcRenderer.send('move-item', p, x, y),
  saveRug: (rug) => ipcRenderer.send('save-rug', rug),
  itemMenu: (p) => ipcRenderer.invoke('item-menu', p),
  rugMenu: () => ipcRenderer.invoke('rug-menu'),
});
