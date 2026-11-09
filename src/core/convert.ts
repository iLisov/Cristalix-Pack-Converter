import type { ClientIndex } from './client-index'
import {
  convertBlockstate,
  convertLang,
  convertModel,
  convertPackMcmeta,
  convertProperties,
  convertSounds,
  parseJson,
} from './json'
import { LEGACY, legacySpritePlaces, type LegacyMap, type SpritePlace } from './legacy'
import { patchGlyphSizes, planFonts } from './font'
import { DOUBLE_CHESTS, SINGLE_CHESTS, doubleChestParts, singleChestParts } from './chest'
import { guiBaseAsset, playerSlotGrids } from './gui'
import { avoidPredicateOrBug, blockstateTargets } from './blockstates'
import { buildCitRules, itemBase } from './items'
import { buildWolfProperties, getWolfVariantIndex, getWolfVariantTarget } from './random-entities'
import { getLayoutMismatch, pngSize } from './entity-layouts'
import { MODEL_BASE, stateModelRefs, type ModelBase } from './model-base'
import { PAINTING_ATLAS, PAINTING_LAYOUT, SYNONYMS } from './mappings'
import { resolveTexture, type TextureResolution } from './textures'
import type { ComposePart, ConvertOptions, Group, Note, Overrides, Plan, PlanEntry, Preset, Slice } from './types'

export type Files = Map<string, Uint8Array>

const decoder = new TextDecoder()
const text = (data: Uint8Array) => decoder.decode(data)
const T = 'assets/minecraft/textures/'
export const BASE_PREFIX = 'base:'

/** Папки ассетов новых версий, которым нет места в 1.12. */
const SKIP_DIRS: Record<string, string> = {
  atlases: 'Атласы появились в 1.19.3: в 1.12 текстуры собираются в атлас автоматически.',
  equipment: 'Описания экипировки из 1.21.2+: в 1.12 их нет.',
  particles: 'Описания частиц из 1.14+: в 1.12 частицы лежат в одном атласе.',
  shaders: 'Шейдеры новых версий несовместимы с 1.12.',
  post_effect: 'Пост-эффекты новых версий несовместимы с 1.12.',
  font: 'Описания шрифтов из 1.13+: в 1.12 шрифт берётся из textures/font.',
  waypoint_style: 'Нет в 1.12.',
}

const TEXTURE_GROUPS: Record<string, Group> = { block: 'blocks', blocks: 'blocks', item: 'items', items: 'items' }

function textureGroup(rel: string): Group {
  const top = rel.split('/')[0]
  return TEXTURE_GROUPS[top] ?? (top === 'entity' || top === 'painting' || top === 'models' ? 'entity' : 'other')
}

/** Где в архиве лежит пак (некоторые архивы содержат его во вложенной папке). */
export function findRoot(paths: string[]): string {
  const metas = paths.filter((p) => p === 'pack.mcmeta' || p.endsWith('/pack.mcmeta')).sort((a, b) => a.length - b.length)
  if (metas.length > 0) return metas[0].slice(0, -'pack.mcmeta'.length)
  const withAssets = paths.find((p) => p.startsWith('assets/') || p.includes('/assets/'))
  if (withAssets) return withAssets.slice(0, withAssets.indexOf('assets/'))
  return ''
}

export interface PlanInput {
  files: Files
  index: ClientIndex
  options: ConvertOptions
  preset?: Preset
  overrides?: Overrides
  /** Ассеты 1.12 (клиент или пак), откуда берутся основы атласов. Пути — от корня: assets/minecraft/… */
  base?: Files
  legacy?: LegacyMap
  modelBase?: ModelBase
}

export function planPack({ files, index, options, preset, overrides = {}, base, legacy = LEGACY, modelBase = MODEL_BASE }: PlanInput): Plan {
  const root = findRoot([...files.keys()])
  const entries: PlanEntry[] = []
  const taken = new Map<string, PlanEntry>()
  /** Текстуры пака: новый путь (block/x) → пути 1.12 (blocks/y). Для ссылок в моделях. */
  const resolved = new Map<string, string[]>()

  const meta = files.get(root + 'pack.mcmeta')
  const mcmeta = convertPackMcmeta(meta ? parseJson(text(meta)) : null)
  entries.push({
    source: root + 'pack.mcmeta',
    group: 'other',
    targets: ['pack.mcmeta'],
    status: 'converted',
    notes: [{ level: 'info', text: `pack_format ${mcmeta.format ?? '—'} → 3.` }],
    transform: { type: 'text', text: mcmeta.text },
  })

  /** Резервирует цели; занятые другим файлом убирает с пометкой. */
  function claim(entry: PlanEntry) {
    const free: string[] = []
    for (const target of entry.targets) {
      const owner = taken.get(target)
      if (owner) entry.notes.push({ level: 'warn', text: `${target} уже занят файлом ${owner.source}.` })
      else {
        taken.set(target, entry)
        free.push(target)
      }
    }
    entry.targets = free
    if (free.length === 0 && entry.status !== 'skipped' && entry.transform.type !== 'compose') entry.status = 'skipped'
    entries.push(entry)
  }

  function manualTargets(source: string, rel: string): (TextureResolution & { manual: PlanEntry['manual'] }) | null {
    const override = overrides[source]
    if (override) {
      if ('exclude' in override) return { targets: [], status: 'skipped', notes: [{ level: 'info', text: 'Исключено вручную.' }], manual: 'override' }
      return { targets: override.targets, status: 'renamed', notes: [{ level: 'info', text: 'Путь задан вручную.' }], manual: 'override' }
    }
    const fromPreset = preset?.textures[rel]
    if (fromPreset) {
      if (fromPreset.length === 0) return { targets: [], status: 'skipped', notes: [{ level: 'info', text: `Исключено пресетом «${preset!.name}».` }], manual: 'preset' }
      return { targets: fromPreset.map((t) => `${T}${t}.png`), status: 'renamed', notes: [{ level: 'info', text: `Правило из пресета «${preset!.name}».` }], manual: 'preset' }
    }
    return null
  }

  const pngs: { source: string; rel: string }[] = []
  const rest: string[] = []

  // Оверлеи (1.20.2+) — для новых версий; клиент 1.12 их не читает
  const overlayDirs = ((parseJson(meta ? text(meta) : '{}')?.overlays as { entries?: { directory?: string }[] } | undefined)?.entries ?? [])
    .map((e) => e.directory)
    .filter((d): d is string => !!d)
  const nestedPacks = [...new Set([...files.keys()].flatMap((path) => {
    if (!path.startsWith(root)) return []
    const local = path.slice(root.length)
    const assets = local.indexOf('/assets/')
    return assets >= 0 && !local.startsWith('assets/') ? [local.slice(0, assets + 1)] : []
  }))]
  const fonts = planFonts(files, root, index)

  for (const path of files.keys()) {
    if (!path.startsWith(root) || path.endsWith('/')) continue
    const local = path.slice(root.length)
    if (local === 'pack.mcmeta') continue
    // служебные файлы архиваторов macOS
    if (local.startsWith('__MACOSX/') || local.endsWith('.DS_Store') || /(^|\/)\._/.test(local)) continue
    const overlay = overlayDirs.find((d) => local.startsWith(d + '/'))
    if (overlay) {
      entries.push({ source: path, group: 'other', targets: [], status: 'skipped', notes: [{ level: 'info', text: `Оверлей «${overlay}» для новых версий: в 1.12 не используется.` }], transform: { type: 'copy' } })
      continue
    }
    const nested = nestedPacks.find((dir) => local.startsWith(dir))
    if (nested) {
      entries.push({ source: path, group: 'other', targets: [], status: 'skipped',
        notes: [{ level: 'info', text: `Дополнительный вариант «${nested.slice(0, -1)}» не входит в основной пак.` }], transform: { type: 'copy' } })
      continue
    }
    if (local.endsWith('.rpo') || /\/[a-z_]+_rpo\//.test(local)) {
      entries.push({ source: path, group: 'other', targets: [], status: 'skipped', notes: [{ level: 'info', text: 'Файлы мода Respackopts: без мода клиент берёт обычные папки.' }], transform: { type: 'copy' } })
      continue
    }
    if (fonts?.consumed.has(path)) {
      entries.push({
        source: path,
        texture: /\/textures\/(.+)\.png$/.exec(local)?.[1],
        group: 'other',
        targets: [],
        status: 'converted',
        notes: [{ level: 'info', text: path.endsWith('.json') ? 'Шрифт перенесён на страницы unicode_page 1.12.' : 'Глифы перенесены на страницы шрифта 1.12.' }],
        transform: { type: 'copy' },
      })
      continue
    }
    const tex = /^assets\/minecraft\/textures\/(.+)\.png$/.exec(local)
    if (tex) pngs.push({ source: path, rel: tex[1] })
    else rest.push(path)
  }

  const textureUsers = new Map<string, Set<string>>()
  function textureReference(ref: string, source: string) {
    if (ref.startsWith('#') || (ref.includes(':') && !ref.startsWith('minecraft:'))) return
    const rel = ref.replace(/^minecraft:/, '')
    const names = [rel, rel.replace(/^blocks\//, 'block/').replace(/^items\//, 'item/')]
    for (const name of names) {
      const users = textureUsers.get(name) ?? new Set<string>()
      users.add(source.slice(root.length))
      textureUsers.set(name, users)
    }
  }
  for (const path of rest) {
    if (!/\/(?:models\/|(?:optifine|mcpatcher)\/cit\/).+\.json$/.test(path)) continue
    const json = parseJson(text(files.get(path)!))
    if (!json) continue
    for (const ref of Object.values((json.textures ?? {}) as Record<string, unknown>)) if (typeof ref === 'string') textureReference(ref, path)
    for (const el of Array.isArray(json.elements) ? json.elements : []) {
      for (const face of Object.values((el.faces ?? {}) as Record<string, { texture?: string }>)) if (typeof face.texture === 'string') textureReference(face.texture, path)
    }
  }

  // Точные имена раньше синонимов, чтобы синоним не занял чужую цель.
  pngs.sort((a, b) => Number(SYNONYMS.has(a.rel)) - Number(SYNONYMS.has(b.rel)) || a.rel.localeCompare(b.rel))

  /** Куски атласов 1.12: атлас → спрайты пака, которые в него вклеиваются. */
  const atlasParts = new Map<string, ComposePart[]>()
  const pngTargets = new Map<string, string[]>()

  // Сундуки новой развёртки (1.15+): пересобираются под 1.12, половины склеиваются в _double
  const modern = (packFormatOf(files, root) ?? 99) >= 5
  const chestHalves = new Map<string, { left?: string; right?: string }>()

  const blockTextures = new Set(Object.entries(index.modelMaterials ?? {}).flatMap(([name, m]) => name.startsWith('block/') ? Object.values(m.textures ?? {}) : []))
  /** Текстура блока → отдельная иконка предмета, если пак рисует предмет иначе, чем блок. */
  const itemIcons = new Map<string, string>()
  const wolfIndex = getWolfVariantIndex(pngs.map((png) => png.rel))
  const blockWidths = pngs.filter((png) => png.rel.startsWith('block/')).slice(0, 400)
    .map((png) => pngSize(files.get(png.source)!)?.w).filter((width): width is number => !!width).sort((left, right) => left - right)
  const packScale = Math.max(1, (blockWidths[Math.floor(blockWidths.length / 2)] ?? 16) / 16)
  if (wolfIndex.size) {
    claim({ source: '__converter/mcpatcher/mob/wolf/wolf.properties', group: 'other', targets: ['assets/minecraft/mcpatcher/mob/wolf/wolf.properties'],
      status: 'converted', notes: [{ level: 'info', text: `Окраски волков по биомам: ${[...wolfIndex.keys()].join(', ')}.` }],
      transform: { type: 'text', text: buildWolfProperties(wolfIndex) } })
  }
  for (const { source, rel } of pngs) {
    const group = textureGroup(rel)
    const manual = manualTargets(source, rel)
    if (!manual && rel === 'gui/sprites/container/slot') {
      const grids = playerSlotGrids(source, files, root)
      for (const atlas of grids.keys()) {
        if (manualTargets(`${root}${T}${atlas}.png`, atlas)) grids.delete(atlas)
      }
      if (grids.size > 0) {
        for (const [atlas, parts] of grids) atlasParts.set(atlas, [...(atlasParts.get(atlas) ?? []), ...parts])
        entries.push({ source, texture: rel, group, targets: [], status: 'converted',
          notes: [{ level: 'info', text: 'Слоты добавляются на фоны инвентарей, если сетка ещё не нарисована.' }], transform: { type: 'copy' } })
        continue
      }
    }
    const chest = /^entity\/chest\/([a-z_]+?)(?:_(left|right))?$/.exec(rel)
    if (!manual && modern && chest && (chest[2] ? DOUBLE_CHESTS.has(chest[1]) : SINGLE_CHESTS.has(chest[1]))) {
      if (chest[2]) {
        const pair = chestHalves.get(chest[1]) ?? {}
        pair[chest[2] as 'left' | 'right'] = source
        chestHalves.set(chest[1], pair)
        entries.push({
          source,
          texture: rel,
          group,
          targets: [],
          status: 'converted',
          notes: [{ level: 'info', text: `Половина двойного сундука: склеивается в entity/chest/${chest[1]}_double.` }],
          transform: { type: 'copy' },
        })
      } else {
        claim({
          source,
          texture: rel,
          group,
          targets: [`${T}${rel}.png`],
          status: 'converted',
          notes: [{ level: 'info', text: 'Развёртка 1.15+ пересобрана под 1.12: модель повёрнута на 180°.' }],
          transform: { type: 'compose', size: [64, 64], parts: singleChestParts(source) },
        })
      }
      continue
    }
    const painting = /^painting\/([a-z0-9_]+)$/.exec(rel)
    const places: SpritePlace[] | undefined = manual
      ? undefined
      : painting && PAINTING_LAYOUT[painting[1]]
        ? [{ atlas: PAINTING_ATLAS, ...xywh(PAINTING_LAYOUT[painting[1]]) }]
        : legacySpritePlaces(rel, legacy)

    if (places) {
      for (const p of places) {
        const list = atlasParts.get(p.atlas) ?? []
        list.push({ source, x: p.x, y: p.y, w: p.w, h: p.h, ...spriteMeta(files.get(source + '.mcmeta'), p.slice) })
        atlasParts.set(p.atlas, list)
      }
      const where = places.map((p) => `${p.atlas}.png (${p.x}, ${p.y})`).join(', ')
      entries.push({
        source,
        texture: rel,
        group,
        targets: [],
        status: 'converted',
        notes: [{ level: 'info', text: `Вклеено в атлас 1.12: ${where}.` }],
        transform: { type: 'copy' },
      })
      continue
    }

    const wolfTarget = manual ? undefined : getWolfVariantTarget(rel, wolfIndex)
    if (wolfTarget) {
      const entry: PlanEntry = { source, texture: rel, group, targets: [wolfTarget], status: 'renamed',
        notes: [{ level: 'info', text: 'Окраска волка 1.20.5+ → вариант Random Entities OptiFine с правилом по биомам (mcpatcher/mob/wolf).' }], transform: { type: 'copy' } }
      claim(entry)
      pngTargets.set(source, entry.targets)
      continue
    }
    const r = manual ?? resolveTexture(rel, index, legacy)
    let status = r.status
    const notes = [...r.notes]
    if (!manual && rel.startsWith('item/')) {
      const shared = r.targets.filter((t) => blockTextures.has(t))
      if (shared.length) {
        const icon = `items/${rel.slice('item/'.length)}`
        r.targets.splice(0, r.targets.length, ...r.targets.filter((t) => !blockTextures.has(t)), ...(r.targets.includes(icon) ? [] : [icon]))
        for (const t of shared) itemIcons.set(t, icon)
        notes.push({ level: 'info', text: `Модель предмета берёт текстуру блока ${shared.join(', ')}: иконка записана в ${icon}, модель предмета перенаправлена на неё.` })
      }
    }
    const users = textureUsers.get(rel)
    if (status === 'unknown' && users?.size) {
      status = r.targets[0] === rel ? 'same' : 'renamed'
      notes.length = 0
      notes.push({ level: 'info', text: `Дополнительная текстура модели: ${[...users][0]}${users.size > 1 ? ` и ещё ${users.size - 1}` : ''}. Сохраняется вместе с моделью.` })
    }
    if (status === 'unknown' && !options.keepUnknown) {
      status = 'skipped'
      notes.push({ level: 'info', text: 'Не добавлено: включите «Оставлять неизвестные файлы», если нужно.' })
    }
    const targets = (status === 'skipped' ? [] : r.targets.map((t) => (t.startsWith('assets/') ? t : `${T}${t}.png`))).filter((target) => {
      const mismatch = !manual && target.startsWith(T) && getLayoutMismatch(target.slice(T.length, -'.png'.length), files.get(source)!, packScale)
      if (mismatch) notes.push({ level: 'warn', text: `Не перенесено в ${target.slice(T.length)}: раскладка модели другая (${mismatch}). Клиент оставит свою текстуру.` })
      return !mismatch
    })
    if (!targets.length && status !== 'skipped' && r.targets.length) status = 'skipped'
    const resize = options.maxResolution > 0 && (group === 'blocks' || group === 'items')
    const entry: PlanEntry = {
      source,
      texture: rel,
      group,
      targets,
      status,
      notes,
      transform: resize ? { type: 'resize', width: options.maxResolution } : { type: 'copy' },
      manual: manual?.manual,
    }
    claim(entry)
    if (rel === 'gui/container/inventory' && !pngs.some((p) => p.rel.startsWith('gui/container/creative_inventory/') || p.rel.startsWith('gui/sprites/container/creative_inventory/'))) {
      entry.notes.push({ level: 'info', text: 'В исходном паке нет текстур креатива. Креатив использует оформление клиента; этот файл меняет инвентарь выживания.' })
    }
    pngTargets.set(source, entry.targets)
    if (entry.targets.length > 0) {
      resolved.set(rel, entry.targets.map((t) => t.slice(T.length, -'.png'.length)))
    }
  }

  // Жители: с 1.14 — слои (тело + тип + профессия), в 1.12 — цельная текстура на профессию
  const villagerBase = files.get(`${root}${T}entity/villager/villager.png`)
  if (villagerBase && modern) {
    const layer = (rel: string) => {
      const src = `${root}${T}entity/villager/${rel}.png`
      return files.has(src) ? [{ source: src, x: 0, y: 0, w: 64, h: 64, blend: true }] : []
    }
    const body = [...layer('villager'), ...layer('type/plains')]
    const professions: [string, string][] = [['villager', ''], ['farmer', 'farmer'], ['librarian', 'librarian'], ['priest', 'cleric'], ['smith', 'weaponsmith'], ['butcher', 'butcher']]
    for (const [old, prof] of professions) {
      const parts = [...body, ...(prof ? layer(`profession/${prof}`) : [])]
      if (prof && parts.length === body.length) continue
      const target = `${T}entity/villager/${old}.png`
      const owner = taken.get(target)
      if (owner) {
        owner.targets = owner.targets.filter((t) => t !== target)
        taken.delete(target)
      }
      claim({
        source: `${root}${target}#villager`,
        texture: `entity/villager/${old}`,
        group: 'entity',
        targets: [target],
        status: 'converted',
        notes: [{ level: 'info', text: `Собрано из слоёв 1.14+: тело, тип plains${prof ? `, профессия ${prof}` : ''}.` }],
        transform: { type: 'compose', size: [64, 64], parts },
      })
    }
  }

  for (const [name, { left, right }] of chestHalves) {
    if (!left || !right) {
      const only = (left ?? right)!
      const e = entries.find((x) => x.source === only)
      e?.notes.push({ level: 'warn', text: 'Нет второй половины сундука — двойной сундук не собран.' })
      continue
    }
    claim({
      source: `${root}${T}entity/chest/${name}_double#chest`,
      texture: `entity/chest/${name}_double`,
      group: 'entity',
      targets: [`${T}entity/chest/${name}_double.png`],
      status: 'converted',
      notes: [{ level: 'info', text: `Склеено из ${name}_left и ${name}_right с разворотом под 1.12.` }],
      transform: { type: 'compose', size: [128, 64], parts: doubleChestParts(left, right) },
    })
  }

  if (fonts && fonts.pages.size > 0) {
    // Пишем и в minecraft (ванильный рендер), и в core_font_mod (шрифтовой мод клиента)
    const namespaces = ['minecraft', 'core_font_mod']
    for (const [page, parts] of fonts.pages) {
      const hex = page.toString(16).padStart(2, '0')
      const ratio = Math.max(...parts.map((p) => (p.sw ?? p.w) / p.w))
      claim({
        source: `${root}font/unicode_page_${hex}#font`,
        texture: `font/unicode_page_${hex}`,
        group: 'other',
        targets: namespaces.map((ns) => `assets/${ns}/textures/font/unicode_page_${hex}.png`),
        status: 'converted',
        notes: [{ level: 'info', text: `Страница шрифта U+${hex.toUpperCase()}00–${hex.toUpperCase()}FF: ${parts.length} глифов.` }, ...fonts.notes],
        transform: { type: 'compose', size: [256, 256], parts, scale: Math.min(4, Math.max(1, Math.round(ratio))) },
      })
    }
    let patched = 0
    for (const ns of namespaces) {
      const path = `assets/${ns}/font/glyph_sizes.bin`
      const glyphBase = base?.get(path)
      if (!glyphBase) continue
      patched++
      claim({
        source: `${root}${path}#font`,
        group: 'other',
        targets: [path],
        status: 'converted',
        notes: [{ level: 'info', text: `Ширины ${fonts.widths.size} новых глифов дописаны к glyph_sizes.bin основы (${ns}).` }],
        transform: { type: 'bytes', data: patchGlyphSizes(glyphBase, fonts.widths) },
      })
    }
    if (patched === 0) {
      entries.push({
        source: `${root}font/glyph_sizes.bin#font`,
        group: 'other',
        targets: [],
        status: 'skipped',
        notes: [{ level: 'warn', text: 'Иконки в тексте не будут видны: 1.12 нужна ширина каждого символа в glyph_sizes.bin, а взять её можно только из клиента. Подключите основу 1.12.' }],
        transform: { type: 'copy' },
      })
    }
  }

  // Склейка атласов: основа — файл пака на этом месте, иначе файл подключённого клиента.
  const legacyOnly = new Set(legacy.legacyOnly)
  for (const [atlas, parts] of atlasParts) {
    const target = `${T}${atlas}.png`
    // Пак сам содержит атлас старого формата — он нарисован под 1.12, спрайты новых версий не нужны
    // Одноимённый атлас креатива может содержать вкладки 26 px; в 1.12 они имеют ширину 28.
    const rebuildTabs = atlas === 'gui/container/creative_inventory/tabs' && (mcmeta.format ?? 99) > 3
      && parts.some((p) => p.source.includes('/gui/sprites/container/creative_inventory/tab_'))
    if (legacyOnly.has(atlas) && taken.get(target) && !rebuildTabs) {
      const owner = taken.get(target)!
      owner.notes.push({ level: 'info', text: `Готовый ${atlas}.png старого формата из пака: используется как есть.` })
      for (const p of parts) {
        const e = entries.find((x) => x.source === p.source && x.targets.length === 0 && x.status === 'converted')
        if (e) {
          e.status = 'skipped'
          e.notes = [{ level: 'info', text: `Не нужен: в паке есть готовый ${atlas}.png для старых версий.` }]
        }
      }
      continue
    }
    const size = atlas === PAINTING_ATLAS ? ([256, 256] as [number, number]) : legacy.atlasSizes[atlas] ?? [256, 256]
    const notes: Note[] = [{ level: 'info', text: `Собрано из ${parts.length} спрайтов пака.` }]
    let baseKey: string | undefined
    const owner = taken.get(target)
    if (owner) {
      baseKey = owner.source
      owner.targets = owner.targets.filter((t) => t !== target)
      owner.notes.push({ level: 'info', text: `Стал основой атласа ${atlas}.png — спрайты пака вклеены поверх.` })
      if (owner.targets.length === 0) owner.status = 'converted'
      taken.delete(target)
      notes.push({ level: 'info', text: `Основа — ${owner.source.slice(root.length)}.` })
    } else if (guiBaseAsset(target, base)) {
      baseKey = BASE_PREFIX + target
      notes.push({ level: 'info', text: base?.has(target) ? 'Основа — из подключённого клиента 1.12.' : 'Недостающие элементы — из встроенной основы GUI 1.12.' })
    } else {
      notes.push({
        level: 'warn',
        text: 'Нет основы: всё, чего нет в паке, останется прозрачным. Подключите клиент 1.12 в настройках, чтобы взять недостающее оттуда.',
      })
    }
    if (atlas === PAINTING_ATLAS) {
      const have = new Set(parts.map((p) => p.source.replace(/^.*\/painting\/(.+)\.png$/, '$1')))
      const missing = Object.keys(PAINTING_LAYOUT).filter((n) => !have.has(n))
      if (missing.length > 0 && !baseKey) notes.push({ level: 'warn', text: `Нет в паке: ${missing.join(', ')}.` })
    }
    claim({
      source: `${root}${target}#atlas`,
      texture: atlas,
      group: textureGroup(atlas),
      targets: [target],
      status: 'converted',
      notes,
      transform: { type: 'compose', size, base: baseKey, parts },
    })
  }

  /** Ванильная модель, которой нет ни в паке, ни в клиенте, — её имя в 1.12 (end_portal_frame → end_portal_frame_empty). */
  const packModels = new Set(
    [...files.keys()]
      .map((p) => /^assets\/minecraft\/models\/block\/(.+)\.json$/.exec(p.slice(root.length))?.[1])
      .filter((x): x is string => !!x),
  )
  const modelName = (local: string): string => {
    if (local === 'grass' && (mcmeta.format ?? 99) > 3) return 'tall_grass'
    if (packModels.has(local) || index.models.size === 0 || index.models.has(`block/${local}`)) return local
    return legacy.models[local] ?? local
  }

  // Блокстейт новых версий ссылается на модель от models/, а 1.12 всегда дописывает block/: «tripwire/dot» → block/tripwire/dot
  const looseStateModels = new Set(rest.filter((path) => /^assets\/minecraft\/blockstates\/.+\.json$/.test(path.slice(root.length)))
    .flatMap((path) => stateModelRefs(parseJson(text(files.get(path)!))))
    .map((ref) => ref.replace(/^minecraft:/, ''))
    .filter((ref) => !ref.includes(':') && !/^(block|item|builtin)\//.test(ref)))
  function modelTargets(name: string): string[] {
    if ((name === 'block/grass' || name === 'item/grass') && (mcmeta.format ?? 99) > 3) return [name.replace(/grass$/, 'tall_grass')]
    const candidates = [name]
    if (looseStateModels.has(name)) candidates.push(`block/${name}`)
    const m = /^(block|item)\/([^/]+)$/.exec(name)
    if (!m) return candidates
    const mapped = legacy.models[m[2]]
    if (mapped) candidates.push(`${m[1]}/${mapped}`)
    const stateTarget = blockstateTargets(m[2], {}, index)[0]
    if (stateTarget && !stateTarget.select && !stateTarget.targetProps) candidates.push(`${m[1]}/${stateTarget.name}`)
    return [...new Set(candidates)].filter((p) => p === name || (index.models.has(p) && !files.has(`${root}assets/minecraft/models/${p}.json`)))
  }

  const knownModels = new Set(rest.map((p) => /^assets\/minecraft\/models\/(.+)\.json$/.exec(p.slice(root.length))?.[1]).filter((p): p is string => !!p))
  const defaults = new Map<string, Record<string, unknown>>()
  function ensureTexture(ref: string) {
    if (ref.startsWith('#') || (ref.includes(':') && !ref.startsWith('minecraft:'))) return
    const rel = ref.replace(/^minecraft:/, '')
    if (resolved.has(rel)) return
    const r = resolveTexture(rel, index, legacy)
    if (r.targets.some((t) => index.textures.has(t))) return
    const asset = modelBase.textures[rel]
    if (!asset) return
    const targets = r.targets.map((t) => `${T}${t}.png`)
    const entry: PlanEntry = { source: `vanilla:${T}${rel}.png`, texture: rel, group: textureGroup(rel), targets,
      status: 'converted', notes: [{ level: 'info', text: 'В паке и клиенте нет текстуры, на которую ссылается модель. Добавлена ванильная из новой версии.' }],
      transform: { type: 'bytes', data: Uint8Array.from(atob(asset.png), (c) => c.charCodeAt(0)) } }
    claim(entry)
    resolved.set(rel, targets.map((p) => p.slice(T.length, -4)))
    if (asset.mcmeta && entry.targets.length) claim({ source: entry.source + '.mcmeta', group: entry.group,
      targets: entry.targets.map((t) => t + '.mcmeta'), status: 'converted', notes: [], transform: { type: 'text', text: asset.mcmeta } })
  }
  function ensureModel(ref: string) {
    if (ref.includes(':') && !ref.startsWith('minecraft:')) return
    let path = ref.replace(/^minecraft:/, '')
    if (path.startsWith('block/')) path = `block/${modelName(path.slice(6))}`
    if (knownModels.has(path) || index.models.has(path)) return
    const model = modelBase.models[path]
    if (!model) return
    knownModels.add(path)
    defaults.set(path, model)
    if (path.startsWith('block/')) packModels.add(path.slice(6))
    if (typeof model.parent === 'string') ensureModel(model.parent)
    for (const ref of Object.values((model.textures ?? {}) as Record<string, unknown>)) if (typeof ref === 'string') ensureTexture(ref)
  }
  for (const path of rest) {
    const local = path.slice(root.length)
    if (!/^assets\/[^/]+\/(?:(models|blockstates|items)\/.+|(?:optifine|mcpatcher)\/cit\/.+)\.json$/.test(local)) continue
    const json = parseJson(text(files.get(path)!))
    if (!json) continue
    if (local.includes('/items/')) {
      for (const ref of stateModelRefs(json)) ensureModel(ref)
    } else if (local.includes('/blockstates/')) {
      for (const ref of stateModelRefs(json)) {
        const [ns, name] = ref.includes(':') ? ref.split(':', 2) : ['minecraft', ref]
        ensureModel(`${ns}:${name.startsWith('block/') ? name : 'block/' + name}`)
      }
    } else {
      if (typeof json.parent === 'string') ensureModel(json.parent)
      for (const ref of Object.values((json.textures ?? {}) as Record<string, unknown>)) if (typeof ref === 'string') ensureTexture(ref)
    }
  }
  for (const [path, json] of defaults) {
    const r = convertModel(json, index, resolved, modelName, knownModels)
    claim({ source: `vanilla:assets/minecraft/models/${path}.json`, group: 'models', targets: r.text ? [`assets/minecraft/models/${path}.json`] : [], status: r.text ? 'converted' : 'skipped',
      notes: [{ level: 'info', text: 'Добавлена ванильная модель новой версии: её нет в паке и клиенте 1.12.' }, ...r.notes], transform: { type: 'text', text: r.text ?? '' } })
  }

  function claimState(entry: PlanEntry) {
    const owner = taken.get(entry.targets[0])
    if (owner?.group === 'blockstates' && owner.transform.type === 'text' && entry.transform.type === 'text') {
      const first = parseJson(owner.transform.text)!
      const next = parseJson(entry.transform.text)!
      if (first.variants && next.variants) {
        const multipart = [...(Array.isArray(first.multipart) ? first.multipart : []), ...(Array.isArray(next.multipart) ? next.multipart : [])]
        owner.transform.text = JSON.stringify({ variants: { ...(next.variants as object), ...(first.variants as object) }, ...(multipart.length ? { multipart } : {}) }, null, 2)
      } else if (Array.isArray(first.multipart) && Array.isArray(next.multipart)) {
        owner.transform.text = JSON.stringify({ multipart: [...first.multipart, ...next.multipart] }, null, 2)
      } else { claim(entry); return }
      entry.notes.push({ level: 'info', text: `Объединено с ${owner.source} в ${entry.targets[0]}.` })
      entry.targets = []
      entries.push(entry)
    } else claim(entry)
  }

  for (const path of rest.sort()) {
    const local = path.slice(root.length)
    const m = /^assets\/([^/]+)\/(.+)$/.exec(local)

    if (!m) {
      claim({ source: path, group: 'other', targets: [local], status: 'same', notes: [], transform: { type: 'copy' } })
      continue
    }
    const [, ns, inner] = m
    const dir = inner.split('/')[0]
    const isMc = ns === 'minecraft'
    if (dir === 'items' && inner.endsWith('.json')) continue

    // .mcmeta анимаций идёт следом за своей текстурой
    const anim = /^textures\/(.+)\.png\.mcmeta$/.exec(inner)
    if (isMc && anim) {
      const owner = pngTargets.get(path.slice(0, -'.mcmeta'.length))
      if (owner) {
        claim({
          source: path,
          texture: anim[1],
          group: textureGroup(anim[1]),
          targets: owner.map((t) => t + '.mcmeta'),
          status: owner.length > 0 ? 'same' : 'skipped',
          notes: [{ level: 'info', text: 'Анимация: следует за своей текстурой.' }],
          transform: { type: 'copy' },
        })
        continue
      }
      if (legacySpritePlaces(anim[1], legacy)) {
        entries.push({ source: path, group: 'other', targets: [], status: 'skipped', notes: [{ level: 'info', text: 'Анимация спрайта: в атласе 1.12 используется первый кадр.' }], transform: { type: 'copy' } })
        continue
      }
    }

    if (SKIP_DIRS[dir]) {
      entries.push({ source: path, group: 'other', targets: [], status: 'skipped', notes: [{ level: 'info', text: SKIP_DIRS[dir] }], transform: { type: 'copy' } })
      continue
    }

    if (dir === 'models' && inner.endsWith('.json')) {
      const json = parseJson(text(files.get(path)!))
      if (!json) {
        entries.push({ source: path, group: 'models', targets: [], status: 'skipped', notes: [{ level: 'warn', text: 'Битый JSON.' }], transform: { type: 'copy' } })
        continue
      }
      const name = inner.slice('models/'.length, -'.json'.length)
      const r = convertModel(json, index, isMc ? resolved : new Map(), modelName, knownModels)
      const known = !isMc || index.models.size === 0 || index.models.has(name)
      if (!known) r.notes.push({ level: 'info', text: 'Новая модель: будет использоваться, если на неё ссылается блокстейт или предмет.' })
      const targets = isMc ? modelTargets(name).map((p) => `assets/minecraft/models/${p}.json`) : [local]
      if (targets.length > 1) r.notes.push({ level: 'info', text: `Модель также записана под именем клиента 1.12: ${targets.slice(1).join(', ')}.` })
      claim({ source: path, group: 'models', targets: r.text ? targets : [], status: r.text ? 'converted' : 'skipped', notes: r.notes, transform: { type: 'text', text: r.text ?? '' } })
      continue
    }

    if (dir === 'blockstates' && inner.endsWith('.json')) {
      const json = parseJson(text(files.get(path)!))
      const name = inner.slice('blockstates/'.length, -'.json'.length)
      if (!json) {
        entries.push({ source: path, group: 'blockstates', targets: [], status: 'skipped', notes: [{ level: 'warn', text: 'Битый JSON.' }], transform: { type: 'copy' } })
        continue
      }
      const targets = isMc && !(name === 'grass' && (mcmeta.format ?? 99) <= 3) ? blockstateTargets(name, json, index) : [{ name }]
      for (const [i, target] of targets.entries()) {
        const client = isMc ? index.blockstates[target.name] : undefined
        const unknown = isMc && !client && Object.keys(index.blockstates).length > 0
        const keep = !unknown || options.keepUnknown
        const r = convertBlockstate(name, json, client, modelName, target)
        const notes = [...r.notes]
        if (unknown) notes.unshift({ level: 'warn', text: `Для блокстейта «${name}» не найдено соответствие в индексе клиента. Нужна проверка целевого имени.` })
        if (target.name !== name) notes.unshift({ level: 'info', text: `${name} → ${target.name}: имя блокстейта в StateMapper 1.12.` })
        claimState({ source: i === 0 ? path : `${path}#${target.name}`, group: 'blockstates',
          targets: keep && r.text ? [`assets/${ns}/blockstates/${target.name}.json`] : [],
          status: keep && r.text ? unknown ? 'unknown' : 'converted' : 'skipped', notes,
          transform: { type: 'text', text: r.text ?? '' } })
      }
      continue
    }

    if (dir === 'lang' && inner.endsWith('.json') && options.convertLang) {
      const json = parseJson(text(files.get(path)!))
      if (json) {
        const r = convertLang(json, isMc ? legacy.lang : {}, fonts?.remap)
        claim({
          source: path,
          group: 'other',
          targets: [`assets/${ns}/${inner.slice(0, -'.json'.length).toLowerCase()}.lang`],
          status: 'converted',
          notes: r.notes,
          transform: { type: 'text', text: r.text! },
        })
        continue
      }
    }

    if (inner === 'sounds.json') {
      const json = parseJson(text(files.get(path)!))
      if (json) {
        const r = convertSounds(json, isMc ? legacy.sounds : {})
        claim({ source: path, group: 'other', targets: [local], status: 'converted', notes: r.notes, transform: { type: 'text', text: r.text! } })
        continue
      }
    }

    // OptiFine в новых версиях лежит в optifine/, в 1.12 — в mcpatcher/
    const isOptifine = dir === 'optifine' || dir === 'mcpatcher'
    const outInner = dir === 'optifine' ? 'mcpatcher' + inner.slice('optifine'.length) : inner
    const outPath = `assets/${ns}/${outInner}`
    if (isOptifine && inner.endsWith('.properties')) {
      const source = readOptifineProperties(path, files, root)
      const folder = path.slice(0, path.lastIndexOf('/') + 1)
      const r = convertProperties(source.text, index, { resolved: isMc ? resolved : undefined, modern: dir === 'optifine' || (mcmeta.format ?? 0) >= 4,
        hasLocalTile: (name) => files.has(`${folder}${name}.png`) })
      if (dir === 'optifine') r.notes.unshift({ level: 'info', text: 'optifine/ → mcpatcher/.' })
      r.notes.unshift(...source.notes)
      claim({ source: path, group: 'other', targets: r.text === null ? [] : [outPath], status: r.text === null ? 'skipped' : 'converted', notes: r.notes, transform: { type: 'text', text: r.text ?? '' } })
      continue
    }
    if (isOptifine && /\/cit\/.+\.json$/.test(inner)) {
      const json = parseJson(text(files.get(path)!))
      if (json) {
        const r = convertModel(json, index, resolved, modelName, knownModels)
        claim({ source: path, group: 'models', targets: r.text ? [outPath] : [], status: r.text ? 'converted' : 'skipped', notes: r.notes,
          transform: { type: 'text', text: r.text ?? '' } })
        continue
      }
      entries.push({ source: path, group: 'models', targets: [], status: 'skipped', notes: [{ level: 'warn', text: 'Битый JSON модели CIT.' }], transform: { type: 'copy' } })
      continue
    }

    const notes: Note[] = []
    if (dir === 'optifine') notes.push({ level: 'info', text: 'optifine/ → mcpatcher/.' })
    claim({
      source: path,
      group: dir === 'textures' ? textureGroup(inner.slice('textures/'.length)) : 'other',
      targets: [outPath],
      status: dir === 'optifine' ? 'renamed' : 'same',
      notes,
      transform: { type: 'copy' },
    })
  }

  for (const path of rest.filter((p) => /^assets\/[^/]+\/items\/.+\.json$/.test(p.slice(root.length)))) {
    const local = path.slice(root.length)
    const [, ns, name] = /^assets\/([^/]+)\/items\/(.+)\.json$/.exec(local)!
    const definition = parseJson(text(files.get(path)!))
    const baseModel = itemBase(definition?.model)
    const notes: Note[] = []
    if (baseModel.conditional && ns === 'minecraft') {
      const { rules, skipped } = buildCitRules(definition?.model, name)
      let written = 0
      for (const [i, rule] of rules.entries()) {
        const source = [`items=${name}`, ...rule.conditions, `model=${rule.model.replace(/^minecraft:/, '')}`,
          ...Object.entries(rule.models).map(([k, m]) => `model.${k}=${m.replace(/^minecraft:/, '')}`), `weight=${rule.weight}`].join('\n')
        const r = convertProperties(source, index, { resolved, modern: true })
        if (r.text === null) continue
        claim({ source: `${path}#cit${i}`, group: 'other', targets: [`assets/minecraft/mcpatcher/cit/converted_items/${name}/${i}.properties`],
          status: 'converted', notes: [{ level: 'info', text: `Условная ветка предмета → правило CIT: ${rule.conditions.join(', ')}.` }, ...r.notes],
          transform: { type: 'text', text: r.text } })
        written++
      }
      if (written) notes.push({ level: 'info', text: `Условные модели 1.21.4 переведены в ${written} правил CIT (mcpatcher/cit/converted_items/${name}).` })
      if (skipped.size) notes.push({ level: 'warn', text: `Условия без аналога в CIT 1.12, взята запасная ветка: ${[...skipped].join(', ')}.` })
    } else if (baseModel.conditional) notes.push({ level: 'warn', text: 'Переносится базовая ветка предмета. Условные модели 1.21.4 требуют правил overrides или CIT 1.12.' })
    if (!baseModel.model) {
      entries.push({ source: path, group: 'models', targets: [], status: 'skipped', notes: [...notes,
        { level: 'warn', text: 'В описании предмета не найдена базовая модель, которую можно привязать к models/item 1.12.' }], transform: { type: 'copy' } })
      continue
    }
    const targets = (ns === 'minecraft' ? modelTargets(`item/${name}`) : [`item/${name}`]).map((p) => `assets/${ns}/models/${p}.json`)
    const parent = baseModel.model.replace(/^minecraft:/, '')
    const [parentNs, parentPath] = parent.includes(':') ? parent.split(':', 2) : ['minecraft', parent]
    if (!taken.has(`assets/${parentNs}/models/${parentPath}.json`) && !(parentNs === 'minecraft' && index.models.has(parentPath))) {
      entries.push({ source: path, group: 'models', targets: [], status: 'skipped', notes: [...notes,
        { level: 'warn', text: `Базовая модель ${parent} не найдена среди перенесённых моделей и в индексе клиента.` }], transform: { type: 'copy' } })
      continue
    }
    const free = targets.filter((t) => !taken.has(t) && t !== `assets/${parentNs}/models/${parentPath}.json`)
    if (!free.length) {
      entries.push({ source: path, group: 'models', targets: [], status: 'converted', notes: [...notes,
        { level: 'info', text: 'Базовая модель предмета уже задана в models/item пака или клиента.' }], transform: { type: 'copy' } })
      continue
    }
    claim({ source: path, group: 'models', targets: free, status: 'converted', notes: [...notes,
      { level: 'info', text: `ClientItem → модель предмета 1.12, родитель: ${parent}.` }], transform: { type: 'text', text: JSON.stringify({ parent }, null, 2) } })
  }

  for (const [name, model] of Object.entries(index.modelMaterials ?? {})) {
    if (!name.startsWith('item/') || !model.textures) continue
    const textures = Object.fromEntries(Object.entries(model.textures).map(([k, v]) => [k, itemIcons.get(v) ?? v]))
    if (Object.entries(textures).every(([k, v]) => model.textures![k] === v)) continue
    const target = `assets/minecraft/models/${name}.json`
    if (taken.has(target)) continue
    claim({ source: `__converter/${name}`, group: 'models', targets: [target], status: 'converted',
      notes: [{ level: 'info', text: 'Модель предмета перенаправлена на иконку из пака: текстура блока остаётся для самого блока.' }],
      transform: { type: 'text', text: JSON.stringify({ ...(model.parent ? { parent: model.parent } : {}), textures }, null, 2) } })
  }

  const outputPaths = new Set(entries.flatMap((e) => e.targets))
  const modelEntries = new Map(entries.flatMap((e) => e.group === 'models' ? e.targets.map((p) => [p, e] as const) : []))
  const assetEntries = new Map(entries.flatMap((e) => e.targets.map((p) => [p, e] as const)))
  function modelPath(ref: string, state = false): string {
    const [ns, raw] = ref.includes(':') ? ref.split(':', 2) : ['minecraft', ref]
    return `assets/${ns}/models/${state ? 'block/' : ''}${raw}.json`
  }
  function resolvedModel(path: string, chain = new Set<string>()): boolean {
    if (chain.has(path)) return false
    const entry = modelEntries.get(path)
    if (!entry) return path.startsWith('assets/minecraft/models/') && index.models.has(path.slice('assets/minecraft/models/'.length, -5))
    if (entry.transform.type !== 'text') return false
    const model = parseJson(entry.transform.text)
    if (!model) return false
    if (typeof model.parent !== 'string' || model.parent.startsWith('builtin/')) return true
    return resolvedModel(modelPath(model.parent), new Set([...chain, path]))
  }
  for (const entry of entries) {
    if (entry.group !== 'blockstates' || entry.transform.type !== 'text' || !entry.targets.length) continue
    const name = /^assets\/minecraft\/blockstates\/(.+)\.json$/.exec(entry.targets[0])?.[1]
    const native = name ? index.blockstates[name]?.defaultVariants : undefined
    if (!native) continue
    const state = parseJson(entry.transform.text)
    if (!state || !state.variants) continue
    for (const [key, value] of Object.entries(state.variants as Record<string, unknown>)) {
      if (stateModelRefs(value).every((ref) => resolvedModel(modelPath(ref, true)))) continue
      const fallback = native[key]
      if (fallback && stateModelRefs(fallback).every((ref) => resolvedModel(modelPath(ref, true)))) {
        (state.variants as Record<string, unknown>)[key] = fallback
        entry.notes.push({ level: 'warn', text: `Для ${key} использован вариант готового блокстейта клиента: исходная модель или её родитель отсутствует.` })
      }
    }
    entry.transform.text = JSON.stringify(state, null, 2)
  }
  fillChildTextureFallbacks(modelEntries, index)
  for (const entry of entries) {
    if (entry.group !== 'blockstates' || entry.transform.type !== 'text' || !entry.targets.length) continue
    const state = parseJson(entry.transform.text)
    if (!state || !Array.isArray(state.multipart)) continue
    const name = /^assets\/minecraft\/blockstates\/(.+)\.json$/.exec(entry.targets[0])?.[1]
    const r = avoidPredicateOrBug(state.multipart, (name && index.blockstates[name]?.props) || {})
    if (!r.changed) continue
    entry.notes.push({ level: 'info', text: `Части multipart разделены по одному значению в условии (${state.multipart.length} → ${r.parts.length}).` })
    state.multipart = r.parts
    entry.transform = { type: 'text', text: JSON.stringify(state, null, 2) }
  }
  const absoluteModels = new Set<string>()
  function inheritedMaterials(path: string, chain = new Set<string>()): Record<string, unknown> {
    if (chain.has(path)) return {}
    const entry = modelEntries.get(path)
    const model = entry?.transform.type === 'text' ? parseJson(entry.transform.text)
      : path.startsWith('assets/minecraft/models/') ? index.modelMaterials?.[path.slice('assets/minecraft/models/'.length, -5)] : undefined
    if (!model) return {}
    const parent = typeof model.parent === 'string' && !model.parent.startsWith('builtin/')
      ? inheritedMaterials(modelPath(model.parent), new Set([...chain, path])) : {}
    return { ...parent, ...((model.textures ?? {}) as Record<string, unknown>) }
  }
  function absoluteCitTextures(path: string) {
    if (absoluteModels.has(path)) return
    absoluteModels.add(path)
    const entry = modelEntries.get(path)
    if (!entry || entry.transform.type !== 'text') return
    const model = parseJson(entry.transform.text)
    if (!model) return
    const textures = model.textures as Record<string, unknown> | undefined
    for (const [key, value] of Object.entries(textures ?? {})) {
      if (typeof value !== 'string' || value.startsWith('#') || value.includes(':') || value.startsWith('.')) continue
      if (outputPaths.has(`${T}${value}.png`) || index.textures.has(value)) textures![key] = `minecraft:${value}`
    }
    entry.transform.text = JSON.stringify(model, null, 2)
    if (typeof model.parent === 'string') {
      const ref = model.parent.replace(/^minecraft:/, '')
      if (!ref.includes(':')) absoluteCitTextures(`assets/minecraft/models/${ref}.json`)
    }
  }
  for (const entry of entries) {
    const path = entry.targets[0]
    if (!path || !/\/mcpatcher\/cit\/.+\.properties$/.test(path) || entry.transform.type !== 'text') continue
    const missing: string[] = []
    const rewrites = new Map<string, string>()
    const textureBindings = new Map<string, string>()
    for (const match of entry.transform.text.matchAll(/^(\s*model(?:\.[^=\s]+)?\s*=\s*)(.*?)\s*$/gm)) {
      const ref = match[2].replace(/\.json$/, '')
      const ns = ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : /^assets\/([^/]+)\//.exec(path)![1]
      const model = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref
      if (ns === 'minecraft' && index.models.has(model)) continue
      const target = /^(item|block)\//.test(model) ? `assets/${ns}/models/${model}.json`
        : model.startsWith('mcpatcher/') ? `assets/${ns}/${model}.json` : path.slice(0, path.lastIndexOf('/') + 1) + model + '.json'
      const parts: string[] = []
      for (const part of target.split('/')) {
        if (part === '..') parts.pop()
        else if (part !== '.') parts.push(part)
      }
      const modelPath = parts.join('/')
      if (!outputPaths.has(modelPath)) missing.push(ref)
      else {
        absoluteCitTextures(modelPath)
        const original = modelEntries.get(modelPath)
        if (original?.transform.type !== 'text') continue
        const model = parseJson(original.transform.text)
        if (!model) continue
        const folder = path.slice(0, path.lastIndexOf('/') + 1)
        const modelKey = /^\s*(model(?:\.[^=\s]+)?)\s*=/.exec(match[1])![1]
        const stem = path.slice(path.lastIndexOf('/') + 1, -11) + (modelKey === 'model' ? '' : '_' + modelKey.replace(/[^a-zA-Z0-9_]/g, '_'))
        const textures = inheritedMaterials(modelPath)
        model.textures = textures
        const localTextures: Record<string, string> = {}
        const localOwners = new Map<string, PlanEntry>()
        for (const [key, value] of Object.entries(textures ?? {})) {
          if (typeof value !== 'string' || value.startsWith('#')) continue
          const [texNs, texRef] = value.includes(':') ? value.split(':', 2) : ['minecraft', value]
          const texture = `assets/${texNs}/textures/${texRef}.png`
          const owner = assetEntries.get(texture)
          if (!owner) continue
          const local = stem + '_' + key
          const target = folder + local + '.png'
          if (!owner.targets.includes(target)) owner.targets.push(target)
          const canonical = '__converter/cit/' + folder.replace(/^assets\/[^/]+\/mcpatcher\/cit\//, '') + local
          const canonicalTarget = `assets/${ns}/textures/${canonical}.png`
          if (!owner.targets.includes(canonicalTarget)) owner.targets.push(canonicalTarget)
          const metaOwner = assetEntries.get(texture + '.mcmeta')
          if (metaOwner && !metaOwner.targets.includes(target + '.mcmeta')) metaOwner.targets.push(target + '.mcmeta')
          if (metaOwner && !metaOwner.targets.includes(canonicalTarget + '.mcmeta')) metaOwner.targets.push(canonicalTarget + '.mcmeta')
          textures![key] = `${ns}:${canonical}`
          localTextures[key] = local
          localOwners.set(key, owner)
        }
        if (localTextures.layer0) {
          if (modelKey !== 'model') textureBindings.set(modelKey.replace(/^model/, 'texture'), localTextures.layer0)
        }
        if (modelKey === 'model' && localTextures.layer0) {
          const items = /^(?:items|matchItems)\s*=\s*(.*)$/m.exec(entry.transform.text)?.[1]?.trim().split(/\s+/).map((v) => v.replace(/^minecraft:/, '')) ?? []
          const potion = items.some((v) => ['potion', 'splash_potion', 'lingering_potion'].includes(v))
          const iconOwner = localOwners.get(potion && localTextures.layer1 ? 'layer1' : 'layer0')!
          const icon = folder + stem + '.png'
          if (!iconOwner.targets.includes(icon)) iconOwner.targets.push(icon)
          const iconKey = potion && localTextures.layer1 ? 'layer1' : 'layer0'
          // анимированная иконка (радужный jeb_) без своего .mcmeta — «broken aspect ratio» в OptiFine
          const iconMeta = entries.find((e) => e.targets.includes(folder + localTextures[iconKey] + '.png.mcmeta'))
          if (iconMeta && !iconMeta.targets.includes(icon + '.mcmeta')) iconMeta.targets.push(icon + '.mcmeta')
          if (!/^\s*texture\s*=/m.test(entry.transform.text)) textureBindings.set('texture', stem)
          if (potion && localTextures.layer1) {
            textureBindings.set('texture.potion_overlay', localTextures.layer0)
            for (const [item, sprite] of [['potion', 'potion_bottle_drinkable'], ['splash_potion', 'potion_bottle_splash'], ['lingering_potion', 'potion_bottle_lingering']]) {
              if (items.includes(item)) textureBindings.set('texture.' + sprite, localTextures.layer1)
            }
          }
        }
        const target = folder + stem + '.json'
        entries.push({ source: entry.source + '#local-model-' + stem, group: 'models', targets: [target], status: 'converted', notes: [], transform: { type: 'text', text: JSON.stringify(model, null, 2) } })
        rewrites.set(match[0], match[1] + stem + '.json')
      }
    }
    if (missing.length) {
      entry.targets = []
      entry.status = 'skipped'
      entry.notes.push({ level: 'warn', text: `Правило CIT отключено: в паке и клиенте нет моделей ${missing.join(', ')}.` })
    } else {
      for (const [from, to] of rewrites) entry.transform.text = entry.transform.text.replace(from, to)
      if (textureBindings.size) entry.transform.text += '\n' + [...textureBindings].filter(([key]) => !new RegExp('^\\s*' + key.replace(/\./g, '\\.') + '\\s*=', 'm').test(entry.transform.type === 'text' ? entry.transform.text : '')).map(([key, value]) => `${key}=${value}`).join('\n')
    }
  }
  return { root, packFormat: mcmeta.format, description: mcmeta.description, entries }
}

/** pack_format из pack.mcmeta (с учётом min/max_format новых версий). */
function packFormatOf(files: Files, root: string): number | undefined {
  const meta = files.get(root + 'pack.mcmeta')
  return meta ? convertPackMcmeta(parseJson(text(meta))).format : undefined
}

function xywh([x, y, w, h]: [number, number, number, number]) {
  return { x, y, w, h }
}

export interface Layer {
  data: Uint8Array
  /** Заменить область целиком (спрайт поверх основы), иначе — наложить с прозрачностью. */
  replace?: boolean
  flipX?: boolean
  flipY?: boolean
  /** Область источника; по умолчанию — вся картинка. */
  sx?: number
  sy?: number
  sw?: number
  sh?: number
  dx: number
  dy: number
  dw: number
  dh: number
  slotGrid?: { cols: number; rows: number }
}

export interface ImageOps {
  /** Размер PNG в пикселях. */
  size(data: Uint8Array): Promise<{ w: number; h: number }>
  /** Пропорционально уменьшает картинку до ширины `width`. */
  resize(data: Uint8Array, width: number): Promise<Uint8Array>
  /** Рисует слои по порядку на прозрачном холсте w×h без сглаживания. */
  compose(w: number, h: number, layers: Layer[]): Promise<Uint8Array>
}

export type Output = Map<string, Uint8Array | string>

export async function buildPack(
  plan: Plan,
  files: Files,
  ops: ImageOps,
  onProgress?: (done: number, total: number) => void,
  base?: Files,
): Promise<Output> {
  const get = (key: string) => (key.startsWith(BASE_PREFIX) ? guiBaseAsset(key.slice(BASE_PREFIX.length), base) : files.get(key))
  const out: Output = new Map()
  const active = plan.entries.filter((e) => e.targets.length > 0)
  let done = 0
  for (const entry of active) {
    const t = entry.transform
    let data: Uint8Array | string
    if (t.type === 'text') data = t.text
    else if (t.type === 'bytes') data = t.data
    else if (t.type === 'compose') data = await composeAtlas(t.size, t.base ? get(t.base) : undefined, t.parts, files, ops, t.scale)
    else {
      const source = files.get(entry.source)!
      data = source
      if (t.type === 'resize' && (await ops.size(source)).w > t.width) data = await ops.resize(source, t.width)
      if (entry.source.endsWith('.png') && !files.has(entry.source + '.mcmeta') && entry.targets.some((target) => ATLAS_TARGET.test(target))) {
        data = await toSquare(data, ops)
      }
    }
    for (const target of entry.targets) out.set(target, data)
    onProgress?.(++done, active.length)
  }
  return out
}

/** Атлас 1.12: основа (если есть) + спрайты пака. Масштаб берётся из основы или из самого крупного спрайта. */
export async function composeAtlas(
  size: [number, number],
  baseData: Uint8Array | undefined,
  parts: ComposePart[],
  files: Files,
  ops: ImageOps,
  fixedScale?: number,
): Promise<Uint8Array> {
  const loaded = await Promise.all(
    parts.map(async (p) => {
      const data = files.get(p.source)!
      return { ...p, data, real: await ops.size(data) }
    }),
  )
  /** Первый кадр спрайта (у анимированных — по размерам из .mcmeta). */
  const frame = (p: (typeof loaded)[number]) => {
    if (!p.anim) return { fw: p.real.w, fh: p.real.h, fx: 0, fy: 0 }
    const fw = p.anim.w ?? (p.anim.h ? p.real.w : Math.min(p.real.w, p.real.h))
    const fh = p.anim.h ?? (p.anim.w ? p.real.h : fw)
    const cols = Math.floor(p.real.w / fw)
    const count = cols * Math.floor(p.real.h / fh)
    const n = p.anim.frame !== undefined && p.anim.frame >= 0 && p.anim.frame < count ? p.anim.frame : 0
    return { fw, fh, fx: (n % cols) * fw, fy: Math.floor(n / cols) * fh }
  }
  let scale = 1
  if (baseData) scale = Math.max(1, (await ops.size(baseData)).w / size[0])
  for (const p of loaded) {
    const nominal = p.slice?.nw ?? p.tile?.nw ?? p.srcW ?? (p.slotGrid ? 18 : p.w)
    scale = Math.max(scale, (p.srcW ? p.real.w : frame(p).fw) / nominal)
  }
  scale = fixedScale ?? Math.round(scale * 1000) / 1000

  const W = Math.round(size[0] * scale)
  const H = Math.round(size[1] * scale)
  const layers: Layer[] = []
  if (baseData) layers.push({ data: baseData, dx: 0, dy: 0, dw: W, dh: H })
  for (const p of loaded) {
    if (p.slice) {
      layers.push(...sliceLayers(p, frame(p), scale))
      continue
    }
    if (p.tile) {
      const f = frame(p)
      layers.push(...spriteRegionLayers(p.data, f.fx, f.fy, f.fw, f.fh, p.x, p.y, p.w, p.h, scale, p.tile.nw, p.tile.nh))
      continue
    }
    let { fx: sx, fy: sy } = frame(p)
    let { fw: sw, fh: sh } = frame(p)
    if (p.sw !== undefined && p.sh !== undefined) {
      sx = p.sx ?? 0
      sy = p.sy ?? 0
      sw = p.sw
      sh = p.sh
    } else if (p.sx !== undefined && p.srcW) {
      const k = p.real.w / p.srcW
      sx = Math.round(p.sx * k)
      sy = Math.round((p.sy ?? 0) * k)
      sw = Math.round(p.w * k)
      sh = Math.round(p.h * k)
    }
    layers.push({
      data: p.data,
      sx,
      sy,
      sw,
      sh,
      dx: Math.round(p.x * scale),
      dy: Math.round(p.y * scale),
      dw: Math.round(p.w * scale),
      dh: Math.round(p.h * scale),
      flipX: p.flipX,
      flipY: p.flipY,
      replace: !p.blend,
      slotGrid: p.slotGrid,
    })
  }
  return ops.compose(W, H, layers)
}

function spriteRegionLayers(
  data: Uint8Array, sx: number, sy: number, sw: number, sh: number,
  x: number, y: number, w: number, h: number, scale: number, tileW = w, tileH = h,
): Layer[] {
  if (sw <= 0 || sh <= 0 || w <= 0 || h <= 0 || tileW <= 0 || tileH <= 0) return []
  const layers: Layer[] = []
  for (let dy = 0; dy < h; dy += tileH)
    for (let dx = 0; dx < w; dx += tileW) {
      const tw = Math.min(tileW, w - dx)
      const th = Math.min(tileH, h - dy)
      const left = Math.round((x + dx) * scale)
      const top = Math.round((y + dy) * scale)
      layers.push({ data, sx, sy, sw: sw * tw / tileW, sh: sh * th / tileH,
        dx: left, dy: top, dw: Math.round((x + dx + tw) * scale) - left,
        dh: Math.round((y + dy + th) * scale) - top, replace: true })
    }
  return layers
}

/** GuiGraphics.blitNineSlicedSprite: ограничение рамок и повторение внутренних сегментов. */
function sliceLayers(p: ComposePart & { data: Uint8Array }, f: { fw: number; fh: number; fx: number; fy: number }, scale: number): Layer[] {
  const s = p.slice!
  if (p.w === s.nw && p.h === s.nh) return spriteRegionLayers(p.data, f.fx, f.fy, f.fw, f.fh, p.x, p.y, p.w, p.h, scale)
  const l = Math.min(s.l, Math.floor(p.w / 2))
  const r = Math.min(s.r, Math.floor(p.w / 2))
  const t = Math.min(s.t, Math.floor(p.h / 2))
  const b = Math.min(s.b, Math.floor(p.h / 2))
  const sxs = [0, l, s.nw - r, s.nw]
  const sys = [0, t, s.nh - b, s.nh]
  const dxs = [0, l, p.w - r, p.w]
  const dys = [0, t, p.h - b, p.h]
  const out: Layer[] = []
  for (let row = 0; row < 3; row++)
    for (let c = 0; c < 3; c++) {
      const sw = sxs[c + 1] - sxs[c]
      const sh = sys[row + 1] - sys[row]
      const dw = dxs[c + 1] - dxs[c]
      const dh = dys[row + 1] - dys[row]
      const tiled = s.stretchInner === false && (c === 1 || row === 1)
      out.push(...spriteRegionLayers(p.data, f.fx + sxs[c] * f.fw / s.nw, f.fy + sys[row] * f.fh / s.nh,
        sw * f.fw / s.nw, sh * f.fh / s.nh, p.x + dxs[c], p.y + dys[row], dw, dh, scale,
        tiled ? sw : dw, tiled ? sh : dh))
    }
  return out
}

/** Нарезка и анимация спрайта из его .mcmeta (gui.scaling, animation). */
export function spriteMeta(mcmeta: Uint8Array | undefined, fallback?: Slice): Pick<ComposePart, 'slice' | 'tile' | 'anim'> {
  const meta = mcmeta ? parseJson(text(mcmeta)) : null
  const out: Pick<ComposePart, 'slice' | 'tile' | 'anim'> = {}
  const scaling = (meta?.gui as { scaling?: Record<string, unknown> } | undefined)?.scaling
  if (scaling?.type === 'nine_slice' && typeof scaling.width === 'number' && typeof scaling.height === 'number') {
    const b = scaling.border
    const n = typeof b === 'number' ? { left: b, top: b, right: b, bottom: b } : ((b ?? {}) as Record<string, number>)
    out.slice = { nw: scaling.width, nh: scaling.height, l: n.left ?? 0, t: n.top ?? 0, r: n.right ?? 0, b: n.bottom ?? 0, stretchInner: scaling.stretch_inner === true }
  } else if (scaling?.type === 'tile' && typeof scaling.width === 'number' && typeof scaling.height === 'number') {
    out.tile = { nw: scaling.width, nh: scaling.height }
  } else if (!scaling && fallback) out.slice = fallback
  const anim = meta?.animation as { width?: number; height?: number; frames?: (number | { index: number })[] } | undefined
  if (anim) {
    const first = anim.frames?.[0]
    out.anim = { w: anim.width, h: anim.height, ...(first !== undefined ? { frame: typeof first === 'number' ? first : first.index } : {}) }
  }
  return out
}

function fillChildTextureFallbacks(modelEntries: Map<string, PlanEntry>, index: ClientIndex) {
  const materials = index.modelMaterials
  if (!materials) return
  const children = new Map<string, string[]>()
  for (const [name, model] of Object.entries(materials)) {
    if (typeof model.parent !== 'string') continue
    const parent = model.parent.replace(/^minecraft:/, '')
    children.set(parent, [...(children.get(parent) ?? []), name])
  }
  const MODELS = 'assets/minecraft/models/'
  for (const [path, entry] of modelEntries) {
    if (!path.startsWith(MODELS) || entry.transform.type !== 'text') continue
    const name = path.slice(MODELS.length, -'.json'.length)
    const clientChildren = (children.get(name) ?? []).filter((child) => !modelEntries.has(`${MODELS}${child}.json`))
    if (!clientChildren.length) continue
    const model = parseJson(entry.transform.text)
    if (!model || !Array.isArray(model.elements)) continue
    const own = (model.textures ?? {}) as Record<string, string>
    const uses = new Map<string, number>()
    for (const element of model.elements as { faces?: Record<string, { texture?: string }> }[]) {
      for (const face of Object.values(element.faces ?? {})) {
        let ref = face.texture
        for (let guard = 0; ref?.startsWith('#') && own[ref.slice(1)] !== undefined && guard < 8; guard++) ref = own[ref.slice(1)]
        if (ref?.startsWith('#')) uses.set(ref.slice(1), (uses.get(ref.slice(1)) ?? 0) + 1)
      }
    }
    const defined = clientChildren.map((child) => new Set(Object.keys(materials[child].textures ?? {})))
    const common = [...defined[0]].filter((variable) => defined.every((childVariables) => childVariables.has(variable)))
    const missing = [...uses.keys()].filter((variable) => defined.some((childVariables) => !childVariables.has(variable)))
    const added: string[] = []
    for (const variable of missing) {
      const fallback = common.filter((candidate) => variable.startsWith(candidate)).sort((left, right) => right.length - left.length)[0]
        ?? common.filter((candidate) => uses.has(candidate)).sort((left, right) => uses.get(right)! - uses.get(left)!)[0]
      if (!fallback || fallback === variable) continue
      own[variable] = `#${fallback}`
      added.push(`#${variable} → #${fallback}`)
    }
    if (!added.length) continue
    model.textures = own
    entry.transform = { type: 'text', text: JSON.stringify(model, null, 2) }
    entry.notes.push({ level: 'info', text: `Дочерние модели не задают новые текстуры родителя — добавлены запасные: ${added.join(', ')}.` })
  }
}

const RULE_KEYS = /^\s*(tiles|method|matchBlocks|matchTiles|blocks|items|format|color|source|texture|model)\s*=/m

/**
 * Текст правила OptiFine с тем, что OptiFine вывел бы сам: заглушку Respackopts заменяет первый
 * существующий fallback из .rpo, блок или тайл из имени файла записывается явно, чтобы перевести его в 1.12.
 */
function readOptifineProperties(path: string, files: Files, root: string): { text: string; notes: Note[] } {
  const notes: Note[] = []
  let body = text(files.get(path)!)
  const rpo = files.get(path + '.rpo')
  if (rpo && !RULE_KEYS.test(body)) {
    const rpoText = text(rpo)
    const list = /fallbacks\s*:\s*\[([\s\S]*?)\]/.exec(rpoText)?.[1] ?? /fallback\s*:\s*(["'][^"']+["'])/.exec(rpoText)?.[1] ?? ''
    const fallback = [...list.matchAll(/["']([^"']+)["']/g)].map((match) => root + match[1]).find((candidate) => files.has(candidate))
    if (fallback) {
      body = text(files.get(fallback)!)
      notes.push({ level: 'info', text: `Заглушка Respackopts заменена правилом ${fallback.slice(root.length)}.` })
    }
  }
  const stem = path.slice(path.lastIndexOf('/') + 1, -'.properties'.length)
  if (/\/ctm\//.test(path) && !/^\s*(matchBlocks|matchTiles)\s*=/m.test(body)) {
    body = (stem.startsWith('block_') ? `matchBlocks=${stem.slice('block_'.length)}` : `matchTiles=${stem}`) + '\n' + body
  } else if (/\/colormap\/blocks\//.test(path) && !/^\s*blocks\s*=/m.test(body)) {
    body = `blocks=${stem}\n` + body
  }
  return { text: body, notes }
}

/** Текстуры, которые сшиваются в атлас блоков и предметов. */
const ATLAS_TARGET = /\/(textures\/(blocks|items)|mcpatcher\/(ctm|cit))\//

/** Атлас 1.12 без .mcmeta принимает только квадрат («broken aspect ratio»); UV моделей нормированы, растяжение их не сдвигает. */
async function toSquare(data: Uint8Array, ops: ImageOps): Promise<Uint8Array> {
  const { w, h } = pngSize(data) ?? await ops.size(data)
  if (w === h) return data
  const side = Math.max(w, h)
  return ops.compose(side, side, [{ data, replace: true, dx: 0, dy: 0, dw: side, dh: side }])
}
