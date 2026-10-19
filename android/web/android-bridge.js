// Provides window.electronAPI on Android, backed by the native AndroidBridge
// in MainActivity, so renderer.js runs unchanged.
(function () {
  const native = window.AndroidBridge;
  if (!native) return;

  const pending = new Map();
  let seq = 0;

  window.__nativeDone = (id, err) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (err) p.reject(new Error(err));
    else p.resolve(native.takeResult(id));
  };

  function call(method, ...args) {
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      pending.set(id, { resolve, reject });
      native[method](id, ...args);
    });
  }

  window.electronAPI = {
    platform: 'android',
    fetchM3U: (url) => call('fetchUrl', url),
    readFile: (path) => call('readFile', path),
    openFileDialog: async () => {
      try {
        return (await call('pickFile')) || null;
      } catch (e) {
        alert(e.message);
        return null;
      }
    },
    saveData: async (key, value) => native.saveData(key, JSON.stringify(value)),
    loadData: async (key) => {
      const s = native.loadData(key);
      return s == null ? null : JSON.parse(s);
    },
    onOpenFile: () => {},
  };
})();
