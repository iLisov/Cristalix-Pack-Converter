// «Мои варианты» шрифтов: zip-архивы в IndexedDB этого браузера.
// Если хранилище недоступно (приватный режим), функции просто ничего не сохраняют.

export interface SavedVariant {
  id: string
  name: string
  zip: Uint8Array
  savedAt: number
}

const DB = 'cpc-fonts'
const STORE = 'variants'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function listVariants(): Promise<SavedVariant[]> {
  try {
    const all = await tx<SavedVariant[]>('readonly', (s) => s.getAll())
    return all.sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

export async function saveVariant(v: SavedVariant): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.put(v))
    return true
  } catch {
    return false
  }
}

export async function deleteVariant(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id))
  } catch {
    /* нечего удалять */
  }
}
