import JSZip from 'jszip'
import type { Files, Output } from '../core/convert'

export interface LoadedPack {
  name: string
  files: Files
}

const stripZip = (name: string) => name.replace(/\.(zip|jar)$/i, '')

export async function readZip(file: Blob, name: string): Promise<LoadedPack> {
  const zip = await JSZip.loadAsync(file)
  const files: Files = new Map()
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir)
      .map(async (f) => files.set(f.name.replace(/\\/g, '/'), await f.async('uint8array'))),
  )
  return { name: stripZip(name), files }
}

async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

/** Файлы из <input webkitdirectory>: путь берём из webkitRelativePath. */
export async function readFileList(list: FileList): Promise<LoadedPack | null> {
  const arr = [...list]
  if (arr.length === 0) return null
  if (arr.length === 1 && /\.(zip|jar)$/i.test(arr[0].name)) return readZip(arr[0], arr[0].name)
  const files: Files = new Map()
  let name = 'pack'
  await Promise.all(
    arr.map(async (f) => {
      const rel = f.webkitRelativePath || f.name
      name = rel.split('/')[0] || name
      files.set(rel, await readFile(f))
    }),
  )
  return { name, files }
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function walk(entry: FileSystemEntry, prefix: string, files: Files): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    files.set(prefix + entry.name, await readFile(file))
    return
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries отдаёт файлы пачками, читаем до пустой
  for (;;) {
    const batch = await readEntries(reader)
    if (batch.length === 0) break
    await Promise.all(batch.map((e) => walk(e, `${prefix}${entry.name}/`, files)))
  }
}

/** Перетаскивание: .zip или папка. */
export async function readDrop(dt: DataTransfer): Promise<LoadedPack | null> {
  const items = [...dt.items].filter((i) => i.kind === 'file')
  const entry = items[0]?.webkitGetAsEntry?.()
  if (entry?.isDirectory) {
    const files: Files = new Map()
    await walk(entry, '', files)
    return { name: entry.name, files }
  }
  const file = dt.files[0]
  if (!file) return null
  if (!/\.(zip|jar)$/i.test(file.name)) throw new Error('Нужен .zip с ресурспаком или папка пака.')
  return readZip(file, file.name)
}

export async function writeZip(out: Output): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, data] of out) zip.file(path, data)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
