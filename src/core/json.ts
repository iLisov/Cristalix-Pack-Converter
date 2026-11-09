import type { ClientIndex } from './client-index'
export { convertBlockstate } from './blockstates'
export { convertProperties } from './optifine'
import { remapText } from './font'
import { convertTextureRef } from './textures'
import { normalizeElementRotation } from './model-rotation'
import type { Note } from './types'

type Json = Record<string, unknown>

export interface JsonResult {
  text: string | null
  notes: Note[]
}

const warn = (text: string): Note => ({ level: 'warn', text })
const info = (text: string): Note => ({ level: 'info', text })

/** Углы поворота элементов, которые принимает 1.12 (иначе модель не загрузится). */
const VALID_ANGLES = [-45, -22.5, 0, 22.5, 45]
/** Поля моделей новых версий, которых нет в 1.12. */
const MODEL_DROP = ['gui_light', 'render_type', 'loader', 'textures_atlas']

/**
 * JSON как его читает игра (Gson в мягком режиме): допускает BOM, комментарии,
 * висячие запятые и мусор после первого объекта.
 */
export function parseJson(text: string): Json | null {
  const src = text.replace(/^\uFEFF/, '')
  const asObject = (v: unknown) => (v && typeof v === 'object' ? (v as Json) : null)
  try {
    return asObject(JSON.parse(src))
  } catch {
    /* пробуем мягче */
  }
  // первый объект целиком: считаем скобки вне строк, комментарии выбрасываем
  let out = ''
  let depth = 0
  let inStr = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      out += c
      if (c === '\\') out += src[++i] ?? ''
      else if (c === '"') inStr = false
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2)
      if (i < 0) break
      i++
      continue
    }
    if (c === '"') inStr = true
    if (c === '{' || c === '[') depth++
    if (c === '}' || c === ']') depth--
    if (depth > 0 || c === '}' || c === ']') out += c
    if (depth === 0 && (c === '}' || c === ']')) break
  }
  try {
    return asObject(JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')))
  } catch {
    return null
  }
}

const stringify = (value: unknown) => JSON.stringify(value, null, 2)

function stripNs(ref: string): string {
  return ref.startsWith('minecraft:') ? ref.slice('minecraft:'.length) : ref
}

export function convertModel(
  model: Json,
  idx: ClientIndex,
  resolved: Map<string, string[]>,
  modelName: (local: string) => string = (x) => x,
  knownModels?: ReadonlySet<string>,
): JsonResult {
  const notes: Note[] = []
  const out: Json = { ...model }

  for (const key of MODEL_DROP) {
    if (key in out) {
      delete out[key]
      notes.push(info(`Убрано поле «${key}» — в 1.12 его нет.`))
    }
  }

  if (typeof out.parent === 'string') {
    let parent = stripNs(out.parent)
    if (parent.startsWith('optifine/')) parent = 'mcpatcher/' + parent.slice('optifine/'.length)
    if (parent.startsWith('block/')) {
      const mapped = modelName(parent.slice('block/'.length))
      if (mapped !== parent.slice('block/'.length)) notes.push(info(`Родитель ${parent} → block/${mapped} (имя модели в 1.12).`))
      parent = `block/${mapped}`
    }
    out.parent = parent
    if (/^block\//.test(parent) && idx.models.size > 0 && !idx.models.has(parent) && !knownModels?.has(parent)) {
      notes.push(warn(`Родительской модели «${parent}» нет в клиенте — проверьте, что она есть в паке.`))
    }
  }

  if (out.textures && typeof out.textures === 'object') {
    const textures: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(out.textures as Json)) {
      textures[k] = typeof v === 'string' ? convertTextureRef(v, idx, resolved) : v
    }
    out.textures = textures
  }

  if (Array.isArray(out.elements)) {
    let snapped = 0
    let normalized = 0
    let unsupported = 0
    out.elements = out.elements.map((el) => {
      if (!el || typeof el !== 'object') return el
      const converted = normalizeElementRotation({ ...(el as Json) })
      const element = converted.element
      if (converted.changed) normalized++
      if (converted.unsupported) unsupported++
      delete element.light_emission
      const rotation = element.rotation as Json | undefined
      if (rotation && typeof rotation.angle === 'number' && !VALID_ANGLES.includes(rotation.angle)) {
        const angle = rotation.angle
        const nearest = VALID_ANGLES.reduce((a, b) => (Math.abs(b - angle) < Math.abs(a - angle) ? b : a))
        element.rotation = { ...rotation, angle: nearest }
        snapped++
      }
      return element
    })
    if (snapped > 0) {
      notes.push(warn(`Углы поворота у ${snapped} элемент(ов) округлены до кратных 22.5° — 1.12 других не принимает.`))
    }
    if (normalized) notes.push(info(`Повороты ${normalized} элементов перенесены в axis/angle 1.12 с сохранением координат и UV.`))
    if (unsupported) return { text: null, notes: [...notes, warn('Модель содержит поворот, который нельзя точно представить в формате элементов 1.12.')] }
  }

  if (Array.isArray(out.overrides)) {
    const overrides = out.overrides.map((value) => {
      if (!value || typeof value !== 'object') return value
      const override = { ...(value as Json) }
      if (typeof override.model === 'string') override.model = override.model.replace(/^(minecraft:)?optifine\//, 'mcpatcher/')
      return override
    })
    out.overrides = overrides
    const usesCmd = overrides.some((o) => (o as Json)?.predicate && 'custom_model_data' in ((o as Json).predicate as Json))
    if (usesCmd) notes.push(warn('custom_model_data появился в 1.14 — в 1.12 такие подмены работать не будут. Используйте CIT (mcpatcher).'))
  }

  return { text: stringify(out), notes }
}

/**
 * lang/xx_yy.json → xx_yy.lang. Ключи новых версий переводятся в ключи 1.12;
 * исходный ключ тоже остаётся — на случай, если его использует сервер или мод.
 */
export function convertLang(lang: Json, keys: Record<string, string[]> = {}, glyphs: Map<number, number> = new Map()): JsonResult {
  const out = new Map<string, string>()
  let mapped = 0
  let total = 0
  for (const [k, v] of Object.entries(lang)) {
    if (typeof v !== 'string') continue
    total++
    const value = remapText(v, glyphs).replace(/\n/g, '\\n')
    if (!out.has(k)) out.set(k, value)
    const old = keys[k]
    if (old?.length) {
      mapped++
      for (const o of old) out.set(o, value)
    }
  }
  const lines = [...out].map(([k, v]) => `${k}=${v}`)
  return {
    text: lines.join('\n') + '\n',
    notes: [
      { level: 'info', text: `Ключей сопоставлено с 1.12: ${mapped} из ${total}. Остальные оставлены как есть.` },
    ],
  }
}

/** sounds.json: события новых версий переименовываются в события 1.12. */
export function convertSounds(sounds: Json, events: Record<string, string> = {}): JsonResult {
  const out: Json = {}
  let mapped = 0
  const renameRefs = (def: unknown) => {
    if (!def || typeof def !== 'object') return def
    const d = { ...(def as Json) }
    if (Array.isArray(d.sounds)) {
      d.sounds = d.sounds.map((s) => {
        if (s && typeof s === 'object' && (s as Json).type === 'event' && typeof (s as Json).name === 'string') {
          const name = stripNs((s as Json).name as string)
          return { ...(s as Json), name: events[name] ?? name }
        }
        return s
      })
    }
    return d
  }
  for (const [event, def] of Object.entries(sounds)) {
    const target = events[event] ?? event
    if (target !== event) mapped++
    if (!(target in out)) out[target] = renameRefs(def)
  }
  return {
    text: stringify(out),
    notes: [{ level: 'info', text: `Событий переименовано под 1.12: ${mapped}.` }],
  }
}

function flattenText(component: unknown): string {
  if (typeof component === 'string') return component
  if (Array.isArray(component)) return component.map(flattenText).join('')
  if (component && typeof component === 'object') {
    const c = component as Json
    return (typeof c.text === 'string' ? c.text : '') + (Array.isArray(c.extra) ? flattenText(c.extra) : '')
  }
  return ''
}

export function convertPackMcmeta(meta: Json | null): { text: string; description: string; format?: number } {
  const pack = (meta?.pack ?? {}) as Json
  const description = flattenText(pack.description) || 'Сконвертировано для 1.12.2'
  // 1.21.9+: min_format/max_format (число или [major, minor]); раньше — pack_format
  const num = (v: unknown) => (typeof v === 'number' ? v : Array.isArray(v) && typeof v[0] === 'number' ? v[0] : undefined)
  const supported = pack.supported_formats as unknown
  const format =
    num(pack.pack_format) ??
    num(pack.max_format) ??
    num(pack.min_format) ??
    (Array.isArray(supported) ? num(supported[supported.length - 1]) : num((supported as Json | undefined)?.max_inclusive))
  return { text: stringify({ pack: { pack_format: 3, description } }), description, format }
}
