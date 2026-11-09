// Основа для неполных атласов GUI: node scripts/build-gui-base.mjs <mcassets.jar>
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const jar = process.argv[2]
if (!jar) throw new Error('Укажите jar с ассетами клиента 1.12.')
const zip = await JSZip.loadAsync(await readFile(jar))
const legacy = JSON.parse(await readFile(new URL('../src/data/legacy-map.json', import.meta.url), 'utf8'))
const textures = {}
for (const atlas of Object.keys(legacy.atlasSizes).filter((p) => p.startsWith('gui/')).sort()) {
  const path = `assets/minecraft/textures/${atlas}.png`
  const entry = zip.file(path)
  if (!entry) throw new Error(`Нет основы ${path}`)
  textures[path] = await entry.async('base64')
}
await writeFile(new URL('../src/data/gui-base.json', import.meta.url), JSON.stringify(textures) + '\n')
console.log(`Сохранено ${Object.keys(textures).length} основ GUI.`)
