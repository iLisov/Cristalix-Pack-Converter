// Строит src/data/cristalix-index.json — список известных путей ассетов.
//
//   node scripts/build-index.mjs [jar] [jar]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const jars = process.argv.slice(2)
const outArg = jars.indexOf('--out')
const customOutput = outArg >= 0 ? jars.splice(outArg, 2)[1] : undefined
if (jars.length === 0) {
  console.error('Укажите пути к jar-файлам с ассетами.')
  process.exit(1)
}

const MC = 'assets/minecraft/'
const textures = new Set()
const models = new Set()
const modelMaterials = {}
const blockstates = {}
const modelRefs = new Set()
const namespaces = new Set()

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** variants {"axis=y,lit=true": …} → {axis: [y], lit: [true]} */
function collectProps(variants) {
  const props = {}
  for (const key of Object.keys(variants)) {
    if (key === 'normal' || key === '' || key === 'inventory') continue
    for (const pair of key.split(',')) {
      const [name, value] = pair.split('=')
      if (value === undefined) continue
      ;(props[name] ??= new Set()).add(value)
    }
  }
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, [...v].sort()]))
}

function collectMultipartProps(parts) {
  const props = {}
  function visit(when) {
    if (!when || typeof when !== 'object') return
    for (const [key, value] of Object.entries(when)) {
      if ((key === 'OR' || key === 'AND') && Array.isArray(value)) value.forEach(visit)
      else if (typeof value === 'string' || typeof value === 'boolean') {
        const values = String(value).replace(/^!/, '').split('|')
        const set = props[key] ??= new Set()
        for (const v of values) set.add(v)
        if (values.some((v) => v === 'true' || v === 'false')) { set.add('true'); set.add('false') }
      }
    }
  }
  parts.forEach((p) => visit(p.when))
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, [...v].sort()]))
}

for (const jar of jars) {
  const zip = await JSZip.loadAsync(await readFile(jar))
  const jobs = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    const ns = /^assets\/([^/]+)\//.exec(path)
    if (ns) namespaces.add(ns[1])
    if (!path.startsWith(MC)) return
    const rel = path.slice(MC.length)

    if (rel.startsWith('textures/') && rel.endsWith('.png')) {
      textures.add(rel.slice('textures/'.length, -4))
    } else if (rel.startsWith('models/') && rel.endsWith('.json')) {
      const name = rel.slice('models/'.length, -5)
      models.add(name)
      jobs.push(
        entry.async('string').then((text) => {
          const model = parseJson(text)
          if (model) modelMaterials[name] = { ...(model.parent ? { parent: model.parent } : {}), ...(model.textures ? { textures: model.textures } : {}) }
          for (const ref of Object.values(model?.textures ?? {})) {
            if (typeof ref === 'string' && !ref.startsWith('#')) modelRefs.add(ref.replace(/^minecraft:/, ''))
          }
        }),
      )
    } else if (rel.startsWith('blockstates/') && rel.endsWith('.json')) {
      const name = rel.slice('blockstates/'.length, -5)
      jobs.push(
        entry.async('string').then((text) => {
          const state = parseJson(text)
          if (!state) return
          if (state.multipart) blockstates[name] = { multipart: true, props: collectMultipartProps(state.multipart) }
          else blockstates[name] = { props: collectProps(state.variants ?? {}), variants: Object.keys(state.variants ?? {}).filter((k) => k !== 'inventory'), defaultVariants: state.variants ?? {} }
        }),
      )
    }
  })
  await Promise.all(jobs)
  console.log(`${jar}: ok`)
}

const sorted = (set) => [...set].sort()
const index = {
  generatedAt: new Date().toISOString().slice(0, 10),
  namespaces: sorted(namespaces),
  textures: sorted(textures),
  models: sorted(models),
  modelMaterials: Object.fromEntries(Object.entries(modelMaterials).sort(([a], [b]) => a.localeCompare(b))),
  modelTextureRefs: sorted(modelRefs),
  blockstates: Object.fromEntries(Object.entries(blockstates).sort(([a], [b]) => a.localeCompare(b))),
}

const out = customOutput ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'cristalix-index.json')
await mkdir(dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(index))
console.log(
  `textures: ${index.textures.length}, models: ${index.models.length}, ` +
    `blockstates: ${Object.keys(index.blockstates).length}, refs: ${index.modelTextureRefs.length}`,
)
