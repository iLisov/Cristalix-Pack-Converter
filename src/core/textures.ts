import type { ClientIndex } from './client-index'
import { ARMOR_MATERIALS, PATH_RENAMES, RENAMES } from './mappings'
import { LEGACY, type LegacyMap } from './legacy'
import type { Note, Status } from './types'

export interface TextureResolution {
  /** Пути внутри textures/ без .png. Первый — основной (на него ссылаются модели). */
  targets: string[]
  status: Status
  notes: Note[]
}

const NEW_DIRS: Record<string, { old: string; table: Record<string, string> }> = {
  block: { old: 'blocks', table: RENAMES.blocks },
  item: { old: 'items', table: RENAMES.items },
}

function armorTarget(rel: string): string | undefined {
  const armor = /^entity\/equipment\/(humanoid|humanoid_leggings)\/(.+)$/.exec(rel)
  const material = armor && ARMOR_MATERIALS[armor[2]]
  if (!armor || !material) return undefined
  const layer = armor[1] === 'humanoid' ? 1 : 2
  const overlay = armor[2] === 'leather_overlay' ? '_overlay' : ''
  return `models/armor/${material}_layer_${layer}${overlay}`
}

/**
 * Пути сущностей, которые в новых версиях переложили по папкам:
 * entity/cow/cow_temperate → entity/cow/cow, entity/chicken/chicken → entity/chicken,
 * entity/cat/cat_black → entity/cat/black.
 */
function entityGuesses(rel: string): string[] {
  if (!rel.startsWith('entity/')) return []
  const out: string[] = []
  for (const r of new Set([rel, rel.replace(/_temperate$/, '').replace(/\/temperate_/, '/')])) {
    const [, a, b] = r.split('/')
    if (b === undefined) continue
    out.push(r)
    if (b === a) out.push(`entity/${a}`)
    if (b.startsWith(`${a}_`)) out.push(`entity/${a}/${b.slice(a.length + 1)}`)
    out.push(`entity/${b}`)
  }
  return out
}

/** Папки сущностей, где одноимённая текстура в entities/ — не та же вещь (флаги, щиты, лодки…). */
const NOT_MOBS = new Set(['banner', 'shield', 'chest_boat', 'boat', 'equipment', 'signs', 'chest', 'bed', 'decorated_pot', 'conduit', 'player'])
const mobIndex = new WeakMap<ClientIndex, Map<string, string[]>>()

/** Мобы новых версий, которые в клиенте лежат в entities/<группа>/<имя>. */
function extraMobs(rel: string, idx: ClientIndex): string[] {
  const m = /^entity\/([a-z_]+)\/([a-z_0-9]+)$/.exec(rel)
  if (!m || NOT_MOBS.has(m[1])) return []
  let byName = mobIndex.get(idx)
  if (!byName) {
    byName = new Map()
    for (const t of idx.textures) {
      if (!t.startsWith('entities/')) continue
      const n = t.slice(t.lastIndexOf('/') + 1)
      byName.set(n, [...(byName.get(n) ?? []), t])
    }
    mobIndex.set(idx, byName)
  }
  const hits = byName.get(m[2]) ?? []
  return hits.length === 1 ? hits : []
}

/**
 * Куда положить текстуру нового формата (`rel` — путь внутри textures/ без .png).
 * Кандидаты по порядку: ручная таблица, вычисленные соответствия, переименования путей,
 * тот же путь. В итог попадают все кандидаты, которые знает клиент.
 */
export function resolveTexture(rel: string, idx: ClientIndex, legacy: LegacyMap = LEGACY): TextureResolution {
  const slash = rel.indexOf('/')
  const top = rel.slice(0, slash)
  const rest = rel.slice(slash + 1)
  const dir = NEW_DIRS[top]

  const samePath = dir ? `${dir.old}/${rest}` : rel
  const manual = dir?.table[rest] ? `${dir.old}/${dir.table[rest]}` : PATH_RENAMES[rel] ?? armorTarget(rel)
  const candidates = [manual, ...(legacy.textures[rel] ?? []), samePath, ...entityGuesses(rel), ...extraMobs(rel, idx)].filter(
    (c): c is string => !!c,
  )
  const targets = [...new Set(candidates.filter((c) => idx.textures.has(c)))]

  if (targets.length === 0) {
    const guess = candidates[0]
    return {
      targets: [guess],
      status: 'unknown',
      notes: [
        dir
          ? { level: 'warn', text: 'Нет готового соответствия в индексе клиента. Дополнительные текстуры могут загружаться через модели.' }
          : { level: 'warn', text: 'Путь не найден в индексе клиента. Его могут использовать модели или моды.' },
      ],
    }
  }
  const notes: Note[] = []
  if (targets.length > 1) notes.push({ level: 'info', text: `Записана под ${targets.length} именами.` })
  return { targets, status: targets[0] === samePath ? 'same' : 'renamed', notes }
}

/**
 * Ссылка на текстуру из модели нового формата → ссылка в формате 1.12.
 * "minecraft:block/oak_planks" → "blocks/planks_oak". Чужие namespace не трогаем.
 */
export function convertTextureRef(ref: string, idx: ClientIndex, resolved?: Map<string, string[]>): string {
  if (ref.startsWith('#')) return ref
  let ns = 'minecraft'
  let path = ref
  const colon = ref.indexOf(':')
  if (colon >= 0) {
    ns = ref.slice(0, colon)
    path = ref.slice(colon + 1)
  }
  if (ns !== 'minecraft') return ref
  if (path.startsWith('optifine/')) return 'mcpatcher/' + path.slice('optifine/'.length)
  const fromPack = resolved?.get(path)
  if (fromPack) return fromPack[0]
  if (/^(block|item)\//.test(path)) return resolveTexture(path, idx).targets[0]
  const known = resolveTexture(path, idx)
  return known.status === 'unknown' ? path : known.targets[0]
}
