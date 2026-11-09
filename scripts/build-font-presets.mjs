// Собирает встроенные варианты шрифтов в public/font-presets/*.zip + manifest.json,
// а из jar клиента — base.zip: страницы и ширины шрифта, поверх которых работают варианты.
//   node scripts/build-font-presets.mjs <папка с ресурспаками> [<jar клиента со шрифтом>]
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const PRESETS = [
  { id: 'cristalix-font', dir: 'Cristalix Font', name: 'Cristalix Font', description: 'Кириллица и эмодзи' },
  { id: 'faithful-font', dir: 'FAITHFUL-FONT', name: 'Faithful Font', description: 'Латиница, кириллица, греческий, рамки' },
  { id: 'daku-gold', dir: 'DAKU-GOLD', name: 'Daku Gold', description: 'Латиница, кириллица, греческий' },
]
// Только то, что относится к шрифту: страницы, ширины, эмодзи, векторные шрифты, обложка
const KEEP = /^(pack\.mcmeta|pack\.png|assets\/[^/]+\/(textures\/font\/|font\/|textures\/standard\/|textures\/emoji\/|fonts\/))/

async function walk(dir) {
  const out = []
  for (const name of await readdir(dir)) {
    const p = join(dir, name)
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

const src = process.argv[2]
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'font-presets')
await mkdir(target, { recursive: true })
const manifest = []
for (const p of PRESETS) {
  const root = join(src, p.dir)
  const zip = new JSZip()
  let count = 0
  for (const file of await walk(root)) {
    const rel = relative(root, file).split('\\').join('/')
    if (!KEEP.test(rel) || rel.endsWith('.zip')) continue
    zip.file(rel, await readFile(file))
    count++
  }
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(join(target, `${p.id}.zip`), data)
  manifest.push({ id: p.id, name: p.name, description: p.description, file: `${p.id}.zip` })
  console.log(`${p.id}: ${count} файлов, ${(data.length / 1024).toFixed(0)} КБ`)
}
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2))

const clientJar = process.argv[3]
if (clientJar) {
  const jar = await JSZip.loadAsync(await readFile(clientJar))
  const zip = new JSZip()
  let count = 0
  for (const [path, entry] of Object.entries(jar.files)) {
    if (entry.dir || !/^assets\/core_font_mod\/(textures\/font\/unicode_page_[0-9a-f]{2}\.png|font\/glyph_sizes\.bin)$/.test(path)) continue
    zip.file(path, await entry.async('uint8array'))
    count++
  }
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(join(target, 'base.zip'), data)
  console.log(`base: ${count} файлов, ${(data.length / 1024).toFixed(0)} КБ`)
}
