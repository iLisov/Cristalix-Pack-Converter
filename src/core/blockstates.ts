import type { ClientIndex } from './client-index'
import type { BlockstateInfo } from './client-index'
import type { JsonResult } from './json'
import type { Note } from './types'

type Json = Record<string, unknown>

export interface StateProjection {
  select?: Record<string, string[]>
  targetProps?: Record<string, string[]>
}

export interface StateTarget extends StateProjection {
  name: string
}

const NAMES: Record<string, string> = {
  grass_block: 'grass', snow_block: 'snow', oak_door: 'wooden_door', oak_fence: 'fence', oak_fence_gate: 'fence_gate',
  oak_trapdoor: 'trapdoor', bricks: 'brick_block', stone_bricks: 'stonebrick',
  cracked_stone_bricks: 'cracked_stonebrick', mossy_stone_bricks: 'mossy_stonebrick',
  chiseled_stone_bricks: 'chiseled_stonebrick', nether_bricks: 'nether_brick',
  note_block: 'noteblock', powered_rail: 'golden_rail', lily_pad: 'waterlily',
  carved_pumpkin: 'pumpkin', jack_o_lantern: 'lit_pumpkin', cobweb: 'web',
  spawner: 'mob_spawner', sugar_cane: 'reeds', melon: 'melon_block',
  magma_block: 'magma', terracotta: 'hardened_clay', dirt_path: 'grass_path',
  end_stone_bricks: 'end_bricks', short_grass: 'tall_grass',
}

export function blockstateTargets(source: string, state: Record<string, unknown>, index: ClientIndex): StateTarget[] {
  const known = (name: string) => !!index.blockstates[name]
  const keys = Object.keys((state.variants ?? {}) as Record<string, unknown>)
  if (source === 'grass' && !keys.some((k) => /(^|,)snowy=/.test(k)) && known('tall_grass')) return [{ name: 'tall_grass' }]
  if (source === 'snow' && keys.some((k) => /(^|,)layers=/.test(k)) && known('snow_layer')) return [{ name: 'snow_layer' }]
  if (source === 'mushroom_stem') {
    const targets = ['brown_mushroom_block', 'red_mushroom_block'].filter(known)
    if (targets.length) return targets.map((name) => ({ name, targetProps: { variant: ['stem', 'all_stem'] } }))
  }
  if (['anvil', 'chipped_anvil', 'damaged_anvil'].includes(source) && index.blockstates.anvil?.props?.damage && !keys.some((k) => /(^|,)damage=/.test(k))) {
    return [{ name: 'anvil', targetProps: { damage: [String(['anvil', 'chipped_anvil', 'damaged_anvil'].indexOf(source))] } }]
  }
  const name = known(source) ? source : NAMES[source] && known(NAMES[source]) ? NAMES[source] : source
  if (Array.isArray(state.multipart) && ['brown_mushroom_block', 'red_mushroom_block'].includes(source) && index.blockstates[name]?.props?.variant) {
    return [{ name, targetProps: { variant: index.blockstates[name].props!.variant.filter((v) => v !== 'stem' && v !== 'all_stem') } }]
  }
  if (index.blockstates[name]?.props?.half && keys.some((k) => /(^|,)type=/.test(k)) && name.endsWith('_slab')) {
    const targets: StateTarget[] = [{ name, select: { type: ['bottom', 'top'] } }]
    const double = name.replace(/_slab$/, '_double_slab')
    if (known(double)) targets.push({ name: double, select: { type: ['double'] } })
    return targets
  }
  if (name === 'furnace' && known('lit_furnace') && keys.some((k) => /(^|,)lit=/.test(k))) {
    return [{ name, select: { lit: ['false'] } }, { name: 'lit_furnace', select: { lit: ['true'] } }]
  }
  return [{ name }]
}

export function legacyStateProperties(props: Record<string, string>, allowed: Record<string, string[]>): Record<string, string> {
  const out = { ...props }
  if (out.type && !allowed.type && allowed.half && ['bottom', 'top'].includes(out.type)) {
    out.half = out.type
    delete out.type
  }
  return out
}

export const STATE_DEFAULTS: Record<string, string> = {
  waterlogged: 'false', powered: 'false', lit: 'false', power: '0', instrument: 'harp', note: '0',
  persistent: 'false', distance: '7', in_wall: 'false', attached: 'false', disarmed: 'false',
}

function stateProps(key: string): Record<string, string> {
  return Object.fromEntries(key.split(',').filter((p) => p.includes('=')).map((p) => p.split('=')))
}

function convertVariant(value: unknown, modelName: (local: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => convertVariant(v, modelName))
  if (!value || typeof value !== 'object') return value
  const out = { ...(value as Json) }
  if (typeof out.model === 'string') {
    const [ns, path] = out.model.includes(':') ? out.model.split(':', 2) : ['minecraft', out.model]
    const local = path.replace(/^block\//, '')
    out.model = ns === 'minecraft' ? modelName(local) : `${ns}:${local}`
  }
  return out
}

function clientStates(client: BlockstateInfo): Record<string, string>[] {
  if (client.variants?.length) return client.variants.map(stateProps)
  let states: Record<string, string>[] = [{}]
  for (const [name, values] of Object.entries(client.props ?? {})) states = states.flatMap((s) => values.map((v) => ({ ...s, [name]: v })))
  return states
}

function testValue(expression: unknown, value: string): boolean {
  const s = String(expression)
  const has = s.replace(/^!/, '').split('|').includes(value)
  return s.startsWith('!') ? !has : has
}

type When = Json | boolean

function joinWhen(kind: 'AND' | 'OR', parts: When[]): When {
  const identity = kind === 'AND'
  if (parts.some((p) => p === !identity)) return !identity
  let conditions = parts.filter((p): p is Json => typeof p === 'object')
  if (!conditions.length) return identity
  if (kind === 'OR') {
    conditions = conditions.flatMap((p) => Array.isArray(p.OR) ? p.OR as Json[] : [p])
    return conditions.length === 1 ? conditions[0] : { OR: conditions }
  }
  let terms: Json[] = [{}]
  for (const condition of conditions) {
    const choices = Array.isArray(condition.OR) ? condition.OR as Json[] : [condition]
    const merged: Json[] = []
    for (const term of terms) for (const choice of choices) {
      const next = { ...term }
      let valid = true
      for (const [key, expression] of Object.entries(choice)) {
        const vs = String(expression).split('|')
        const overlap = key in next ? vs.filter((v) => String(next[key]).split('|').includes(v)) : vs
        if (!overlap.length) { valid = false; break }
        next[key] = overlap.join('|')
      }
      if (valid) merged.push(next)
    }
    terms = merged
  }
  if (!terms.length) return false
  if (terms.some((t) => !Object.keys(t).length)) return true
  return terms.length === 1 ? terms[0] : { OR: terms }
}

const MUSHROOM_FACES: Record<string, string[]> = {
  all_inside: [], all_outside: ['up', 'down', 'north', 'east', 'south', 'west'], center: ['up'],
  north: ['up', 'north'], south: ['up', 'south'], east: ['up', 'east'], west: ['up', 'west'],
  north_east: ['up', 'north', 'east'], north_west: ['up', 'north', 'west'],
  south_east: ['up', 'south', 'east'], south_west: ['up', 'south', 'west'],
  stem: ['north', 'east', 'south', 'west'], all_stem: ['up', 'down', 'north', 'east', 'south', 'west'],
}

function multipartDefaults(parts: unknown[]): Record<string, string> {
  const values = new Map<string, string[]>()
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return
    for (const [key, v] of Object.entries(value)) {
      if ((key === 'AND' || key === 'OR') && Array.isArray(v)) v.forEach(visit)
      else if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') values.set(key, [...(values.get(key) ?? []), ...String(v).replace(/^!/, '').split('|')])
    }
  }
  parts.forEach((p) => visit((p as Json).when))
  return Object.fromEntries([...values].map(([key, vs]) => [key, STATE_DEFAULTS[key] ?? (vs.includes('false') || vs.includes('true') ? 'false' : vs.includes('0') ? '0' : vs[0])]))
}

function convertWhen(value: unknown, props: Record<string, string[]>, defaults: Record<string, string>, mushroom: boolean): When {
  if (!value || typeof value !== 'object') return true
  const obj = value as Json
  const conditions: When[] = []
  for (const [name, expr] of Object.entries(obj)) {
    if ((name === 'OR' || name === 'AND') && Array.isArray(expr)) {
      conditions.push(joinWhen(name, expr.map((v) => convertWhen(v, props, defaults, mushroom))))
      continue
    }
    if (mushroom && props.variant && ['up', 'down', 'north', 'east', 'south', 'west'].includes(name)) {
      const variants = props.variant.filter((v) => testValue(expr, String((MUSHROOM_FACES[v] ?? []).includes(name))))
      conditions.push(variants.length ? { variant: variants.join('|') } : false)
    } else if (!props[name]) conditions.push(testValue(expr, defaults[name] ?? 'false'))
    else {
      const wall = props[name].includes('true') && props[name].includes('false') && /(?:^|[!|])(none|low|tall)(?:$|\|)/.test(String(expr))
      const allowed = props[name].filter((v) => testValue(expr, wall ? v === 'true' ? 'low' : 'none' : v))
      conditions.push(allowed.length === 0 ? false : allowed.length === props[name].length ? true : { [name]: allowed.join('|') })
    }
  }
  return joinWhen('AND', conditions)
}

export function convertBlockstate(
  name: string, state: Json, client: BlockstateInfo | undefined,
  modelName: (local: string) => string = (v) => v, projection: StateProjection = {},
): JsonResult {
  const notes: Note[] = []
  const props = client?.props
  if (state.variants && typeof state.variants === 'object') {
    const source = Object.entries(state.variants as Json)
    if (!client || !props) {
      return { text: JSON.stringify({ variants: Object.fromEntries(source.map(([k, v]) => [k === '' ? 'normal' : k, convertVariant(v, modelName)])) }, null, 2), notes }
    }
    const candidates = source.map(([key, value]) => {
      const original = stateProps(key)
      if (Object.entries(projection.select ?? {}).some(([k, vs]) => original[k] !== undefined && !vs.includes(original[k]))) return null
      const mapped = legacyStateProperties(original, props)
      if (Object.entries(mapped).some(([k, v]) => props[k] && !props[k].includes(v))) return null
      const known = Object.fromEntries(Object.entries(mapped).filter(([k]) => props[k]))
      const ignored = Object.entries(mapped).filter(([k]) => !props[k])
      const score = Object.keys(known).length * 1000 - ignored.filter(([k, v]) => STATE_DEFAULTS[k] !== undefined ? STATE_DEFAULTS[k] !== v : v === 'true').length
      return { known, score, value }
    }).filter((v) => v !== null)
    const variants: Json = {}
    for (const target of clientStates(client)) {
      if (Object.entries(projection.targetProps ?? {}).some(([k, vs]) => !vs.includes(target[k]))) continue
      let best: (typeof candidates)[number] | undefined
      for (const c of candidates) {
        if (Object.entries(c.known).some(([k, v]) => target[k] !== v)) continue
        if (!best || c.score > best.score) best = c
      }
      if (!best) continue
      const key = Object.entries(target).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',') || 'normal'
      variants[key] = convertVariant(best.value, modelName)
    }
    if (!Object.keys(variants).length) return { text: null, notes: [{ level: 'warn', text: `Ни одно состояние «${name}» не совпало со свойствами блока в клиенте.` }] }
    notes.push({ level: 'info', text: `Состояния сопоставлены с StateMapper клиента: ${source.length} → ${Object.keys(variants).length}.` })
    return { text: JSON.stringify({ variants }, null, 2), notes }
  }
  if (Array.isArray(state.multipart)) {
    const defaults = multipartDefaults(state.multipart)
    const multipart: Json[] = []
    const seen = new Set<string>()
    let dropped = 0
    for (const part of state.multipart) {
      const p = { ...(part as Json) }
      if (name === 'redstone_wire' && props && !props.power && JSON.stringify(p.when ?? {}).includes('"power"')) { dropped++; continue }
      let when: When = props ? convertWhen(p.when, props, defaults, /mushroom_(block|stem)$/.test(name)) : (p.when as Json | undefined) ?? true
      const fixed = Object.fromEntries(Object.entries(projection.targetProps ?? {}).map(([k, vs]) => [k, vs.join('|')]))
      if (Object.keys(fixed).length) when = joinWhen('AND', [when, fixed])
      if (when === false) { dropped++; continue }
      if (when === true) delete p.when
      else p.when = when
      p.apply = convertVariant(p.apply, modelName)
      const key = JSON.stringify(p)
      if (seen.has(key)) continue
      seen.add(key)
      multipart.push(p)
    }
    if (!multipart.length) return { text: null, notes: [{ level: 'warn', text: `У multipart «${name}» нет условий, применимых к клиенту.` }] }
    if (dropped) notes.push({ level: 'info', text: `Не применяются в клиенте: ${dropped} частей multipart. Для недоступных свойств выбрано исходное состояние по умолчанию.` })
    const variants = !client?.multipart ? client?.defaultVariants : undefined
    if (variants) notes.push({ level: 'info', text: 'Сохранены исходные варианты клиента вместе с multipart: они нужны старым путям загрузки модели.' })
    return { text: JSON.stringify({ ...(variants ? { variants } : {}), multipart }, null, 2), notes }
  }
  return { text: null, notes: [{ level: 'warn', text: 'Не удалось разобрать блокстейт.' }] }
}

const getUniqueValues = (value: string) => [...new Set(value.split('|'))]

/** Значения условия без отрицания: «!a|b» → остальные значения свойства, если они известны. */
function getPositiveValues(value: string, allowed: string[] | undefined): string[] | null {
  if (!value.startsWith('!')) return getUniqueValues(value)
  if (!allowed) return null
  const excluded = new Set(value.slice(1).split('|'))
  return allowed.filter((allowedValue) => !excluded.has(allowedValue))
}

/** Делит условие на непересекающиеся с одиночными значениями: списки «a|b» в условиях части не остаются. */
function splitWhen(when: Json, props: Record<string, string[]>): Json[] {
  for (const [key, value] of Object.entries(when)) {
    if (key === 'OR' || key === 'AND' || typeof value !== 'string') continue
    const values = getPositiveValues(value, props[key])
    if (!values || values.length < 2) continue
    return values.flatMap((single) => splitWhen({ ...when, [key]: single }, props))
  }
  return [when]
}

function splitCondition(when: unknown, props: Record<string, string[]>): { variants: unknown[]; changed: boolean } {
  if (!when || typeof when !== 'object') return { variants: [when], changed: false }
  const obj = when as Json
  if (Array.isArray(obj.OR)) return { variants: [when], changed: false }
  const split = splitWhen(obj, props)
  return { variants: split, changed: split.length > 1 }
}

export function avoidPredicateOrBug(parts: unknown[], props: Record<string, string[]> = {}): { parts: unknown[]; changed: boolean } {
  let changed = false
  const out = parts.flatMap((part) => {
    if (!part || typeof part !== 'object' || !(part as Json).when) return [part]
    const r = splitCondition((part as Json).when, props)
    if (!r.changed) return [part]
    changed = true
    return r.variants.map((when) => ({ ...(part as Json), when }))
  })
  return { parts: out, changed }
}
