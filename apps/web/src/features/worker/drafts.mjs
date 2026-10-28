const clone = value => structuredClone(value);
export class MemoryDrafts {
  constructor() { this.values = new Map(); }
  async put(value) { this.values.set(value.storageKey, clone(value)); }
  async get(key) { const value = this.values.get(key); return value ? clone(value) : undefined; }
  async remove(key) { this.values.delete(key); }
  async list(scope, userId) { return [...this.values.values()].filter(x => x.scope === scope && x.userId === userId).map(clone); }
}
export class BrowserDrafts {
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open('green-pavlodar-worker-drafts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'storageKey' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('Не удалось открыть хранилище черновиков. Не закрывайте страницу до отправки.'));
    });
  }
  async run(mode, fn) {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      const req = fn(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(new Error('Не удалось сохранить черновик на устройстве. Не закрывайте страницу.'));
    });
  }
  put(value) { return this.run('readwrite', store => store.put(value)); }
  get(key) { return this.run('readonly', store => store.get(key)); }
  remove(key) { return this.run('readwrite', store => store.delete(key)); }
  async list(scope, userId) { return (await this.run('readonly', store => store.getAll())).filter(x => x.scope === scope && x.userId === userId); }
}
