// Прогон паков через план конвертации: что осталось неизвестным/пропущенным.
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { loadIndex } from '../src/core/client-index'
import { planPack } from '../src/core/convert'
import { DEFAULT_OPTIONS } from '../src/core/types'

const index = loadIndex()
for (const file of process.argv.slice(2)) {
  const zip = await JSZip.loadAsync(await readFile(file))
  const files = new Map<string, Uint8Array>()
  await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) => files.set(f.name, await f.async('uint8array'))))
  const plan = planPack({ files, index, options: DEFAULT_OPTIONS })
  const by: Record<string, string[]> = {}
  for (const e of plan.entries) (by[e.status] ??= []).push(e.source.slice(plan.root.length))
  console.log(`\n=== ${file.split('/').pop()}  format=${plan.packFormat}  files=${files.size}`)
  for (const [s, list] of Object.entries(by)) console.log(`  ${s}: ${list.length}`)
  const dirs = (list: string[]) => {
    const c: Record<string, number> = {}
    for (const p of list) { const k = p.split('/').slice(0, 4).join('/'); c[k] = (c[k] ?? 0) + 1 }
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v} ${k}`).join('\n      ')
  }
  for (const s of ['unknown', 'skipped']) if (by[s]) console.log(`  ${s} по папкам:\n      ${dirs(by[s])}`)
}
