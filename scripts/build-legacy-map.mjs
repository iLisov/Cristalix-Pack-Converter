// Строит src/data/legacy-map.json — соответствия «новые версии → 1.12.2»,
// вычисленные по самим клиентам, а не вручную:
//   • текстуры блоков/предметов — по одноимённым моделям;
//   • прочие текстуры — по совпадению пикселей;
//   • спрайты GUI, частицы, иконки — поиском спрайта внутри атласов 1.12;
//   • ключи перевода — по совпадающим строкам en_us;
//   • звуковые события — по общим звуковым файлам.
//
//   node scripts/build-legacy-map.mjs --old <jar> --old-index <index.json> --old-objects <dir>
//        --new <jar> [--new <jar>] --new-index <index.json> --new-objects <dir> [--report <file>]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { PNG } from 'pngjs'

const args = { old: [], new: [], 'new-index': [], 'old-index': [] }
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '')
  const value = process.argv[i + 1]
  if (Array.isArray(args[key])) args[key].push(value)
  else args[key] = value
}

const MC = 'assets/minecraft/'

async function readJar(path) {
  const zip = await JSZip.loadAsync(await readFile(path))
  const textures = new Map()
  const models = new Map()
  const texts = new Map()
  const blockstates = new Map()
  const jobs = []
  zip.forEach((p, entry) => {
    if (entry.dir || !p.startsWith(MC)) return
    const rel = p.slice(MC.length)
    if (rel.startsWith('textures/') && rel.endsWith('.png')) {
      jobs.push(entry.async('nodebuffer').then((b) => textures.set(rel.slice(9, -4), b)))
    } else if (rel.startsWith('models/') && rel.endsWith('.json')) {
      jobs.push(entry.async('string').then((t) => {
        try {
          models.set(rel.slice(7, -5), JSON.parse(t))
        } catch {}
      }))
    } else if (rel.startsWith('blockstates/') && rel.endsWith('.json')) {
      jobs.push(entry.async('string').then((t) => {
        try {
          blockstates.set(rel.slice(12, -5), JSON.parse(t))
        } catch {}
      }))
    } else if (/^lang\/(en_us|ru_ru)\.(json|lang)$/.test(rel)) {
      jobs.push(entry.async('string').then((t) => texts.set(rel, t)))
    }
  })
  await Promise.all(jobs)
  return { textures, models, texts, blockstates }
}

async function readObject(indexPath, objectsDir, name) {
  const index = JSON.parse(await readFile(indexPath, 'utf8')).objects
  const obj = index[name]
  if (!obj) return null
  return readFile(join(objectsDir, obj.hash.slice(0, 2), obj.hash), 'utf8')
}

function decode(buf) {
  try {
    const png = PNG.sync.read(buf)
    return { w: png.width, h: png.height, d: png.data }
  } catch {
    return null
  }
}

// ── загрузка ─────────────────────────────────────────
const oldJar = { textures: new Map(), models: new Map(), texts: new Map(), blockstates: new Map() }
for (const p of args.old) {
  const j = await readJar(p)
  for (const k of ['textures', 'models', 'texts', 'blockstates']) for (const [a, b] of j[k]) oldJar[k].set(a, b)
}
const newJar = { textures: new Map(), models: new Map(), texts: new Map(), blockstates: new Map() }
const newJars = []
for (const p of args.new) {
  const j = await readJar(p)
  newJars.push(j)
  for (const k of ['textures', 'models', 'texts', 'blockstates']) for (const [a, b] of j[k]) if (!newJar[k].has(a)) newJar[k].set(a, b)
}
console.log(`1.12: ${oldJar.textures.size} текстур, ${oldJar.models.size} моделей; новые: ${newJar.textures.size} текстур, ${newJar.models.size} моделей`)

const stripNs = (r) => (typeof r === 'string' ? r.replace(/^minecraft:/, '') : r)
const oldTexSet = new Set(oldJar.textures.keys())

/** Путь новой версии, который совпадает с 1.12 после переименования папок block→blocks, item→items. */
function directOld(path) {
  const p = path.replace(/^block\//, 'blocks/').replace(/^item\//, 'items/')
  return oldTexSet.has(p) ? p : null
}

// ── A. текстуры по моделям ───────────────────────────
const votes = new Map()
for (const [name, nm] of newJar.models) {
  const om = oldJar.models.get(name)
  if (!om?.textures || !nm?.textures) continue
  for (const [key, nref] of Object.entries(nm.textures)) {
    const oref = om.textures[key]
    if (typeof nref !== 'string' || typeof oref !== 'string' || nref.startsWith('#') || oref.startsWith('#')) continue
    const n = stripNs(nref)
    const o = stripNs(oref)
    if (!oldTexSet.has(o) || !newJar.textures.has(n)) continue
    const v = votes.get(n) ?? new Map()
    v.set(o, (v.get(o) ?? 0) + 1)
    votes.set(n, v)
  }
}
const textures = {}
for (const [n, v] of votes) {
  const best = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]
  if (best !== n.replace(/^block\//, 'blocks/').replace(/^item\//, 'items/')) textures[n] = [best]
}
console.log(`A. по моделям: ${Object.keys(textures).length}`)

// ── B. по пикселям ───────────────────────────────────
function pixelKey(img) {
  const d = Buffer.from(img.d)
  let opaque = 0
  const colors = new Set()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) d.writeUInt32LE(0, i)
    else {
      opaque++
      if (colors.size < 3) colors.add(d.readUInt32LE(i))
    }
  }
  if (opaque < 8 || colors.size < 2) return null
  return `${img.w}x${img.h}:` + createHash('sha1').update(d).digest('hex')
}

const oldImgs = new Map()
const oldByHash = new Map()
for (const [path, buf] of oldJar.textures) {
  const img = decode(buf)
  if (!img) continue
  oldImgs.set(path, img)
  const key = pixelKey(img)
  if (!key) continue
  const list = oldByHash.get(key) ?? []
  list.push(path)
  oldByHash.set(key, list)
}
const newImgs = new Map()
let hashHits = 0
for (const [path, buf] of newJar.textures) {
  const img = decode(buf)
  if (!img) continue
  newImgs.set(path, img)
  if (textures[path] || directOld(path)) continue
  const key = pixelKey(img)
  const hits = key && oldByHash.get(key)
  if (hits && hits.length <= 3) {
    textures[path] = hits
    hashHits++
  }
}
console.log(`B. по пикселям: ${hashHits}`)

// ── C. спрайты внутри атласов 1.12 ───────────────────
const ATLAS_RE = /^(gui\/(?!title\/background)|particle\/particles$|map\/map_icons$|misc\/)/
const atlases = [...oldImgs.entries()].filter(([p, img]) => ATLAS_RE.test(p) && img.w <= 512 && img.h <= 512)
const atlasIndex = atlases.map(([path, img]) => {
  const byColor = new Map()
  const d = img.d
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4
      if (d[i + 3] === 0) continue
      const c = d.readUInt32LE(i)
      let list = byColor.get(c)
      if (!list) byColor.set(c, (list = []))
      list.push(x, y)
    }
  return { path, img, byColor }
})

function matchAt(s, a, ox, oy) {
  const sd = s.d
  const ad = a.d
  for (let y = 0; y < s.h; y++) {
    const ay = oy + y
    for (let x = 0; x < s.w; x++) {
      const si = (y * s.w + x) * 4
      const ai = (ay * a.w + ox + x) * 4
      const sa = sd[si + 3]
      const aa = ad[ai + 3]
      if (sa === 0 && aa === 0) continue
      if (sa === 0 || aa === 0) return false
      if (sd[si] !== ad[ai] || sd[si + 1] !== ad[ai + 1] || sd[si + 2] !== ad[ai + 2] || sa !== aa) return false
    }
  }
  return true
}

const SPRITE_RE = /^(gui\/sprites\/|particle\/|mob_effect\/|map\/decorations\/|gui\/)/
const sprites = {}
const unmatched = []
for (const [path, s] of newImgs) {
  if (!SPRITE_RE.test(path) || textures[path] || directOld(path)) continue
  if (s.w > 256 || s.h > 256) continue
  let fx = -1
  let fy = -1
  let opaque = 0
  const colors = new Set()
  for (let i = 0; i < s.w * s.h; i++) {
    if (s.d[i * 4 + 3] === 0) continue
    opaque++
    if (colors.size < 3) colors.add(s.d.readUInt32LE(i * 4))
    if (fx < 0) {
      fx = i % s.w
      fy = (i / s.w) | 0
    }
  }
  if (opaque < 4 || (colors.size < 2 && opaque < 24)) continue
  const color = s.d.readUInt32LE((fy * s.w + fx) * 4)
  const found = []
  for (const a of atlasIndex) {
    // Одинаковые ванильные пиксели не делают спрайты разных окон взаимозаменяемыми.
    const container = /^gui\/sprites\/container\/([^/]+)\//.exec(path)
    const context = container ? `gui/container/${container[1]}` : path.startsWith('gui/sprites/advancements/') ? 'gui/advancements' : undefined
    if (context && a.path !== context && !a.path.startsWith(context + '/')) continue
    if (s.w > a.img.w || s.h > a.img.h) continue
    const cand = a.byColor.get(color)
    if (!cand) continue
    for (let k = 0; k < cand.length && found.length <= 6; k += 2) {
      const ox = cand[k] - fx
      const oy = cand[k + 1] - fy
      if (ox < 0 || oy < 0 || ox + s.w > a.img.w || oy + s.h > a.img.h) continue
      if (matchAt(s, a.img, ox, oy)) found.push({ atlas: a.path, x: ox, y: oy, w: s.w, h: s.h })
    }
  }
  if (found.length > 0 && found.length <= 6) sprites[path] = found
  else if (/^(gui\/sprites|particle|mob_effect|map\/decorations)\//.test(path)) unmatched.push(path)
}
// ── C2. перерисованные элементы: координаты из кода 1.12 (GuiIngame, GuiButton,
// GuiLockIconButton, GuiContainerCreative, ParticleExplosionLarge, MapItemRenderer…)
const MANUAL = {
  'gui/sprites/hud/hotbar': [['gui/widgets', 0, 0]],
  'gui/sprites/hud/hotbar_selection': [['gui/widgets', 0, 22]],
  'gui/sprites/hud/hotbar_offhand_left': [['gui/widgets', 24, 22]],
  'gui/sprites/hud/hotbar_offhand_right': [['gui/widgets', 53, 22]],
  'gui/sprites/widget/button_disabled': [['gui/widgets', 0, 46]],
  'gui/sprites/widget/button': [['gui/widgets', 0, 66]],
  'gui/sprites/widget/button_highlighted': [['gui/widgets', 0, 86]],
  'gui/sprites/widget/locked_button': [['gui/widgets', 0, 146]],
  'gui/sprites/widget/locked_button_highlighted': [['gui/widgets', 0, 166]],
  'gui/sprites/widget/locked_button_disabled': [['gui/widgets', 0, 186]],
  'gui/sprites/widget/unlocked_button': [['gui/widgets', 20, 146]],
  'gui/sprites/widget/unlocked_button_highlighted': [['gui/widgets', 20, 166]],
  'gui/sprites/widget/unlocked_button_disabled': [['gui/widgets', 20, 186]],
  'gui/sprites/hud/armor_empty': [['gui/icons', 16, 9]],
  'gui/sprites/hud/armor_half': [['gui/icons', 25, 9]],
  'gui/sprites/hud/crosshair': [['gui/icons', 0, 0]],
  'gui/sprites/hud/effect_background': [['gui/container/inventory', 141, 166]],
  'gui/sprites/hud/effect_background_ambient': [['gui/container/inventory', 165, 166]],
  'gui/sprites/recipe_book/button': [['gui/container/inventory', 178, 0], ['gui/container/crafting_table', 178, 0]],
  'gui/sprites/recipe_book/button_highlighted': [['gui/container/inventory', 178, 19], ['gui/container/crafting_table', 178, 19]],
  'gui/sprites/container/creative_inventory/scroller': [['gui/container/creative_inventory/tabs', 232, 0]],
  'gui/sprites/container/creative_inventory/scroller_disabled': [['gui/container/creative_inventory/tabs', 244, 0]],
}
for (let i = 0; i < 16; i++) MANUAL[`particle/explosion_${i}`] = [['entity/explosion', (i % 4) * 32, ((i / 4) | 0) * 32]]
for (let i = 0; i < 4; i++) MANUAL[`particle/sweep_${i * 2}`] = [['entity/sweep', i * 32, 0]]
// Иконки эффектов: Potion.setIconIndex(x, y) → inventory.png (x*18, 198 + y*18)
const EFFECT_ICONS = 'speed:0,0 slowness:1,0 haste:2,0 mining_fatigue:3,0 strength:4,0 jump_boost:2,1 nausea:3,1 regeneration:7,0 resistance:6,1 fire_resistance:7,1 water_breathing:0,2 invisibility:0,1 blindness:5,1 night_vision:4,1 hunger:1,1 weakness:5,0 poison:6,0 wither:1,2 health_boost:7,2 absorption:2,2 glowing:4,2 levitation:3,2 luck:5,2 unluck:6,2'
for (const pair of EFFECT_ICONS.split(' ')) {
  const [name, xy] = pair.split(':')
  const [x, y] = xy.split(',').map(Number)
  MANUAL[`mob_effect/${name}`] = [['gui/container/inventory', x * 18, 198 + y * 18]]
}
const MAP_ICONS = ['player', 'frame', 'red_marker', 'blue_marker', 'target_x', 'target_point', 'player_off_map', 'player_off_limits', 'woodland_mansion', 'ocean_monument']
MAP_ICONS.forEach((n, i) => (MANUAL[`map/decorations/${n}`] = [['map/map_icons', (i % 4) * 8, ((i / 4) | 0) * 8]]))
// Вкладки креатива: шириной 28 через 28 px, 7 колонок (у клиента седьмая — своя вкладка), ряды: верх 0/32, низ 64/96. В новых версиях — 26 px:
// растягиваем до 28, сохраняя по 5 px с краёв (там скругления).
const TAB_SLICE = { w: 28, slice: { nw: 26, nh: 32, l: 5, t: 0, r: 5, b: 0 } }
for (let n = 1; n <= 7; n++) {
  const col = (n - 1) * 28
  for (const [kind, y] of [['top_unselected', 0], ['top_selected', 32], ['bottom_unselected', 64], ['bottom_selected', 96]]) {
    MANUAL[`gui/sprites/container/creative_inventory/tab_${kind}_${n}`] = [['gui/container/creative_inventory/tabs', col, y, TAB_SLICE]]
  }
}

let manualCount = 0
for (const [path, places] of Object.entries(MANUAL)) {
  if (sprites[path]) continue
  const s = newImgs.get(path)
  if (!s) continue
  const list = []
  for (const [atlas, x, y, opt] of places) {
    const a = oldImgs.get(atlas)
    if (!a) continue
    const place = { atlas, x, y, w: opt?.w ?? Math.min(s.w, a.w - x), h: Math.min(s.h, a.h - y) }
    if (opt?.slice) place.slice = opt.slice
    list.push(place)
  }
  if (list.length > 0) {
    sprites[path] = list
    manualCount++
    const u = unmatched.indexOf(path)
    if (u >= 0) unmatched.splice(u, 1)
  }
}
console.log(`C2. по координатам из кода 1.12: ${manualCount}`)

// ── F. цепочка между новыми версиями: путь из новейшего клиента, у которого та же картинка
// лежала в предыдущем под другим именем, наследует соответствие этого имени.
const knownMapping = (p) => textures[p] ?? (directOld(p) ? [directOld(p)] : null)
let chained = 0
for (let i = 0; i < newJars.length; i++) {
  for (let j = 0; j < newJars.length; j++) {
    if (i === j) continue
    const byHash = new Map()
    for (const [path, buf] of newJars[j].textures) {
      const img = decode(buf)
      const key = img && pixelKey(img)
      if (key && !byHash.has(key)) byHash.set(key, path)
    }
    for (const [path, buf] of newJars[i].textures) {
      if (textures[path] || sprites[path] || directOld(path)) continue
      const img = decode(buf)
      const key = img && pixelKey(img)
      const other = key && byHash.get(key)
      if (!other || other === path) continue
      const tex = knownMapping(other)
      if (tex) {
        textures[path] = tex
        chained++
      } else if (sprites[other]) {
        sprites[path] = sprites[other]
        chained++
      }
    }
  }
}
console.log(`F. по цепочке версий: ${chained}`)

// ── G. имена ванильных моделей: одноимённые блокстейты, вариант за вариантом ──
const stateModels = (state) => {
  const out = new Map()
  for (const [key, v] of Object.entries(state?.variants ?? {})) {
    const first = Array.isArray(v) ? v[0] : v
    if (first?.model) out.set(key, first.model.replace(/^minecraft:/, '').replace(/^block\//, ''))
  }
  return out
}
const parseKey = (k) => Object.fromEntries(k.split(',').filter((x) => x.includes('=')).map((x) => x.split('=')))
const modelVotes = new Map()
for (const [name, ns] of newJar.blockstates) {
  const os = oldJar.blockstates.get(name)
  if (!os) continue
  const oldVariants = stateModels(os)
  const oldProps = new Set([...oldVariants.keys()].flatMap((k) => Object.keys(parseKey(k))))
  for (const [key, model] of stateModels(ns)) {
    const props = parseKey(key)
    const k = Object.keys(props).filter((p) => oldProps.has(p)).sort().map((p) => `${p}=${props[p]}`).join(',') || 'normal'
    const oldModel = oldVariants.get(k)
    if (!oldModel || oldModel === model) continue
    const v = modelVotes.get(model) ?? new Map()
    v.set(oldModel, (v.get(oldModel) ?? 0) + 1)
    modelVotes.set(model, v)
  }
}
const models = {}
for (const [model, v] of modelVotes) {
  if (oldJar.models.has(`block/${model}`)) continue // такая модель в 1.12 есть — переименовывать нечего
  models[model] = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
console.log(`G. модели блоков: ${Object.keys(models).length}`)

const atlasSizes = {}
for (const list of Object.values(sprites)) for (const s of list) {
  const img = oldImgs.get(s.atlas)
  atlasSizes[s.atlas] = [img.w, img.h]
}
console.log(`C. спрайты: ${Object.keys(sprites).length}, не найдено: ${unmatched.length}`)

// ── D. ключи перевода ────────────────────────────────
function parseLang(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}
const norm = (v) => v.toLowerCase().replace(/%(\d+\$)?[sd]/g, '%s').trim()
const tokens = (k) => new Set(k.toLowerCase().split(/[._]/).filter((t) => t && t !== 'minecraft' && t !== 'name'))

const oldEn = parseLang(oldJar.texts.get('lang/en_us.lang') ?? '')
const newEn = JSON.parse(newJar.texts.get('lang/en_us.json') ?? '{}')
const oldByValue = new Map()
for (const [k, v] of Object.entries(oldEn)) {
  const n = norm(v)
  if (!n) continue
  const list = oldByValue.get(n) ?? []
  list.push(k)
  oldByValue.set(n, list)
}
const oldRu = {
  ...parseLang((await readObject(args['old-index'][0], args['old-objects'], 'minecraft/lang/ru_ru.lang')) ?? ''),
  ...parseLang(oldJar.texts.get('lang/ru_ru.lang') ?? ''),
}
let newRu = {}
for (const idx of args['new-index']) {
  const t = await readObject(idx, args['new-objects'], 'minecraft/lang/ru_ru.json')
  if (t) newRu = { ...JSON.parse(t), ...newRu }
}
const oldRuByValue = new Map()
for (const [k, v] of Object.entries(oldRu)) {
  const n = norm(v)
  if (!n) continue
  const list = oldRuByValue.get(n) ?? []
  list.push(k)
  oldRuByValue.set(n, list)
}
/** Семейство ключа: блоки/предметы новых версий соответствуют tile./item. в 1.12. */
function family(newKey, oldKey) {
  if (/^block\./.test(newKey)) return /^(tile|item)\./.test(oldKey)
  if (/^item\./.test(newKey)) return /^(item|tile)\./.test(oldKey)
  if (/^entity\./.test(newKey)) return /^entity\./.test(oldKey)
  if (/^effect\./.test(newKey)) return /^effect\./.test(oldKey)
  if (/^enchantment\./.test(newKey)) return /^enchantment\./.test(oldKey)
  return !/^(tile|item)\./.test(oldKey) || /^(tile|item)\./.test(newKey)
}
function pick(newKey, cands) {
  const list = cands.filter((c) => family(newKey, c))
  if (list.length === 1) return list[0]
  if (list.length < 2) return null
  const t = tokens(newKey)
  const scored = list.map((c) => [c, [...tokens(c)].filter((x) => t.has(x)).length]).sort((a, b) => b[1] - a[1])
  return scored[0][1] > 0 && scored[0][1] > scored[1][1] ? scored[0][0] : null
}
const lang = {}
for (const [k, v] of Object.entries(newEn)) {
  if (typeof v !== 'string' || k in oldEn) continue
  const en = oldByValue.get(norm(v)) ?? []
  const ruValue = typeof newRu[k] === 'string' ? norm(newRu[k]) : ''
  const ru = ruValue ? oldRuByValue.get(ruValue) ?? [] : []
  const both = en.filter((c) => ru.includes(c) && family(k, c))
  const any = [...new Set([...en, ...ru])].filter((c) => family(k, c))
  if (any.length >= 1 && any.length <= 3 && (both.length > 0 || /^(block|item)\./.test(k))) {
    lang[k] = any
    continue
  }
  if (both.length >= 1 && both.length <= 3) {
    lang[k] = both
    continue
  }
  const hit = pick(k, both) ?? pick(k, en) ?? pick(k, ru)
  if (hit) lang[k] = [hit]
}
console.log(`D. ключи перевода: ${Object.keys(lang).length} из ${Object.keys(newEn).length}`)

// ── E. звуковые события ──────────────────────────────
const soundNames = (entry) =>
  new Set((entry?.sounds ?? []).map((s) => stripNs(typeof s === 'string' ? s : s.name)).filter(Boolean))
const oldSounds = JSON.parse((await readObject(args['old-index'][0], args['old-objects'], 'minecraft/sounds.json')) ?? '{}')
let newSounds = {}
for (const idx of args['new-index']) {
  const s = JSON.parse((await readObject(idx, args['new-objects'], 'minecraft/sounds.json')) ?? '{}')
  newSounds = { ...s, ...newSounds }
}
// Название события: <категория>.<объект>.<действие>. Совпадать должны категория и действие,
// объект — с точностью до «_», суффикса _block или известного переименования.
const SUBJECT_ALIASES = {
  wool: 'cloth', enderman: 'endermen', evoker: 'evocation_illager', evoker_fangs: 'evocation_fangs',
  illusioner: 'illusion_illager', firework_rocket: 'firework', fishing_bobber: 'bobber',
  lightning_bolt: 'lightning', wooden_button: 'wood_button', wooden_pressure_plate: 'wood_pressureplate',
  stone_pressure_plate: 'stone_pressureplate', metal_pressure_plate: 'metal_pressureplate',
  wooden_door: 'wooden_door', wooden_trapdoor: 'wooden_trapdoor', zombie_villager: 'zombie_villager',
}
const ACTION_ALIASES = {
  'polar_bear.ambient_baby': 'polar_bear.baby_ambient', 'villager.trade': 'villager.trading',
  'zombie.attack_wooden_door': 'zombie.attack_door_wood', 'magma_cube.squish_small': 'small_magmacube.squish',
}
const plain = (x) => x.replace(/_/g, '')
const oldSubjects = new Map()
for (const e of Object.keys(oldSounds)) {
  const [cat, subj] = e.split('.')
  oldSubjects.set(`${cat}.${plain(subj)}`, subj)
}
const sounds = {}
for (const event of Object.keys(newSounds)) {
  if (event in oldSounds) continue
  const [cat, subj, ...rest] = event.split('.')
  const action = rest.join('.')
  const alias = ACTION_ALIASES[`${subj}.${action}`]
  if (alias && `${cat}.${alias}` in oldSounds) {
    sounds[event] = `${cat}.${alias}`
    continue
  }
  const candidates = [
    SUBJECT_ALIASES[subj],
    oldSubjects.get(`${cat}.${plain(subj)}`),
    subj.endsWith('_block') ? subj.slice(0, -6) : null,
    subj === 'note_block' ? 'note' : null,
  ].filter(Boolean)
  for (const c of candidates) {
    const old = `${cat}.${c}.${action}`
    if (old in oldSounds) {
      sounds[event] = old
      break
    }
  }
}
console.log(`E. звуки: ${Object.keys(sounds).length}`)

// ── запись ───────────────────────────────────────────
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
// Атласы 1.12, которых в новейшем клиенте нет как файлов: если пак их содержит,
// значит, нарисовал под старые версии — такой файл берётся как есть, без вклейки спрайтов.
const newest = newJars[0]
const legacyOnly = Object.keys(atlasSizes).filter((a) => !newest.textures.has(a)).sort()
console.log(`атласы только старых версий: ${legacyOnly.join(', ')}`)

const out = {
  legacyOnly,
  textures: sortObj(textures),
  sprites: sortObj(sprites),
  atlasSizes: sortObj(atlasSizes),
  lang: sortObj(lang),
  sounds: sortObj(sounds),
  models: sortObj(models),
}
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'legacy-map.json')
await mkdir(dirname(target), { recursive: true })
await writeFile(target, JSON.stringify(out))
if (args.report) await writeFile(args.report, unmatched.join('\n'))
console.log(`→ ${target}`)
