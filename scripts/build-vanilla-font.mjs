// Разметка ванильного шрифта новых версий (какой символ в какой клетке каких картинок)
// → src/data/vanilla-font.json. Нужна для паков, которые только подменяют картинки шрифта.
//   node scripts/build-vanilla-font.mjs <minecraft-client.jar>
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const jar = await JSZip.loadAsync(await readFile(process.argv[2]))
const read = async (p) => JSON.parse(await jar.file(p).async('string'))
const providers = []
async function load(id) {
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id]
  const json = await read(`assets/${ns}/font/${path}.json`)
  for (const p of json.providers) {
    if (p.type === 'reference') await load(p.id)
    else if (p.type === 'bitmap') providers.push({ file: p.file, height: p.height ?? 8, ascent: p.ascent, chars: p.chars })
  }
}
await load('minecraft:include/default')
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'vanilla-font.json')
await writeFile(out, JSON.stringify({ providers }))
console.log(providers.map((p) => `${p.file} (${p.chars.length} рядов)`).join(', '))
