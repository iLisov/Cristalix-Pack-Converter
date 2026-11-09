// Конвертация паков из командной строки: npx vite-node scripts/convert-cli.ts -- <out-dir> [--base client.jar] pack.zip...
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import JSZip from 'jszip'
import { loadIndex } from '../src/core/client-index'
import { buildPack, planPack, type Files } from '../src/core/convert'
import { DEFAULT_OPTIONS } from '../src/core/types'
import { nodeImageOps } from './node-images'

async function readZip(path: string): Promise<Files> {
  const zip = await JSZip.loadAsync(await readFile(path))
  const files: Files = new Map()
  await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) => files.set(f.name, await f.async('uint8array'))))
  return files
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const outDir = args.shift()!
let base: Files | undefined
for (let bi = args.indexOf('--base'); bi >= 0; bi = args.indexOf('--base')) {
  const files = await readZip(args[bi + 1])
  base = new Map([...(base ?? []), ...files])
  args.splice(bi, 2)
}
await mkdir(outDir, { recursive: true })
const index = loadIndex()
for (const file of args) {
  const files = await readZip(file)
  const plan = planPack({ files, index, options: DEFAULT_OPTIONS, base })
  const counts: Record<string, number> = {}
  for (const e of plan.entries) counts[e.status] = (counts[e.status] ?? 0) + 1
  const out = await buildPack(plan, files, nodeImageOps, undefined, base)
  const zip = new JSZip()
  for (const [p, d] of out) zip.file(p, d)
  const name = basename(file).replace(/\.zip$/i, '') + '-1.12.2.zip'
  await writeFile(join(outDir, name), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  const atlases = plan.entries.filter((e) => e.transform.type === 'compose').map((e) => `${e.texture}${e.transform.type === 'compose' && e.transform.base ? '' : ' (без основы)'}`)
  console.log(`${basename(file)}: ${JSON.stringify(counts)}\n  атласы: ${atlases.join(', ')}`)
}
