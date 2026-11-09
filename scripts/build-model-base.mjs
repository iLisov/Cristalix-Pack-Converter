// Недостающие в клиенте модели и текстуры: node scripts/build-model-base.mjs <modern-client.jar> [jar...]
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const jars = process.argv.slice(2)
if (!jars.length) throw new Error('Укажите клиент новой версии Minecraft.')
const index = JSON.parse(await readFile(new URL('../src/data/cristalix-index.json', import.meta.url), 'utf8'))
const legacy = JSON.parse(await readFile(new URL('../src/data/legacy-map.json', import.meta.url), 'utf8'))
const models = {}
const textures = {}
for (const jar of jars) {
  const zip = await JSZip.loadAsync(await readFile(jar))
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const model = /^assets\/minecraft\/models\/(.+)\.json$/.exec(entry.name)
    if (model && !index.models.includes(model[1])) models[model[1]] = JSON.parse(await entry.async('string'))
    const texture = /^assets\/minecraft\/textures\/((?:block|item)\/.+)\.png$/.exec(entry.name)
    if (!texture) continue
    const ref = texture[1]
    const same = ref.replace(/^block\//, 'blocks/').replace(/^item\//, 'items/')
    if ([same, ...(legacy.textures[ref] ?? [])].some((p) => index.textures.includes(p))) continue
    const meta = zip.file(entry.name + '.mcmeta')
    textures[ref] = { png: await entry.async('base64'), ...(meta ? { mcmeta: await meta.async('string') } : {}) }
  }
}
await writeFile(new URL('../src/data/model-base.json', import.meta.url), JSON.stringify({ models, textures }) + '\n')
console.log(`Моделей: ${Object.keys(models).length}; текстур: ${Object.keys(textures).length}.`)
