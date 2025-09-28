const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cheatAPI', {
  onToggleRecord(callback) {
    ipcRenderer.on('toggle-record', (_event, payload) => {
      if (typeof callback === 'function') callback(payload);
    });
  },
  onClickThroughChanged(callback) {
    ipcRenderer.on('click-through-changed', (_event, payload) => {
      if (typeof callback === 'function') callback(payload);
    });
  },
  onStatusText(callback) {
    ipcRenderer.on('status-text', (_event, payload) => {
      if (typeof callback === 'function') callback(payload);
    });
  },
  async sendAudio(arrayBuffer, mimeType) {
    return await ipcRenderer.invoke('transcribe-and-ask', { audioArrayBuffer: arrayBuffer, mimeType });
  },
});

