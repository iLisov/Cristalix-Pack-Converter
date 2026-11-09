type Json = Record<string, unknown>

export interface ItemBase {
  model?: string
  conditional: boolean
}

/** Базовая ветка ClientItem 1.21.4; условные варианты требуют overrides/CIT 1.12. */
export function itemBase(value: unknown): ItemBase {
  if (!value || typeof value !== 'object') return { conditional: false }
  const node = value as Json
  const type = String(node.type ?? '').replace(/^minecraft:/, '')
  if (type === 'model' && typeof node.model === 'string') return { model: node.model, conditional: false }
  if (type === 'special' && typeof node.base === 'string') return { model: node.base, conditional: false }
  if (type === 'condition') return { ...itemBase(node.on_false), conditional: true }
  if (type === 'select' || type === 'range_dispatch') return { ...itemBase(node.fallback), conditional: true }
  if (type === 'composite' && Array.isArray(node.models) && node.models.length === 1) return itemBase(node.models[0])
  return { conditional: type !== 'empty' }
}

export interface CitRule {
  /** Строки условий в формате OptiFine новых версий (id переводит convertProperties). */
  conditions: string[]
  model: string
  /** Дополнительные модели CIT: model.bow_pulling_0 и т.п. */
  models: Record<string, string>
  weight: number
}

function getEnchantmentCondition(predicate: unknown): string[] | null {
  const list = Array.isArray(predicate) ? predicate : predicate && typeof predicate === 'object' ? [predicate] : []
  if (list.length !== 1 || !list[0] || typeof list[0] !== 'object') return null
  const { enchantments, levels } = list[0] as Json
  const ids = (Array.isArray(enchantments) ? enchantments : [enchantments]).filter((id): id is string => typeof id === 'string' && !id.startsWith('#'))
  if (!ids.length) return null
  const lines = [`enchantments=${ids.map((id) => id.replace(/^minecraft:/, '')).join(' ')}`]
  if (typeof levels === 'number') lines.push(`enchantmentLevels=${levels}`)
  else if (levels && typeof levels === 'object') {
    const { min, max } = levels as { min?: number; max?: number }
    if (min !== undefined || max !== undefined) lines.push(`enchantmentLevels=${min ?? 1}-${max ?? ''}`)
  }
  return lines
}

const getType = (node: Json) => String(node.type ?? '').replace(/^minecraft:/, '')
const getProperty = (node: Json) => String(node.property ?? '').replace(/^minecraft:/, '')

/** Первая обычная модель в поддереве — запасная ветка там, где условие не переносится. */
function getFirstModel(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const node = value as Json
  const type = getType(node)
  if (type === 'model' && typeof node.model === 'string') return node.model
  if (type === 'special' && typeof node.base === 'string') return node.base
  if (type === 'condition') return getFirstModel(node.on_false)
  if (type === 'select' || type === 'range_dispatch') return getFirstModel(node.fallback ?? (node.entries as Json[] | undefined)?.[0]?.model)
  if (type === 'composite' && Array.isArray(node.models)) return getFirstModel(node.models[0])
  return undefined
}

/** Натяжение лука: using_item → range_dispatch use_duration/pull. Возвращает модели состояний bow_pulling_N. */
function getBowPulling(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null
  const node = value as Json
  if (getType(node) !== 'range_dispatch' || !/^(use_duration|crossbow\/pull)$/.test(getProperty(node))) return null
  const models = [getFirstModel(node.fallback), ...getSortedEntries(node).map((entry) => getFirstModel(entry.model))]
    .filter((model): model is string => !!model)
  if (!models.length) return null
  return Object.fromEntries(models.slice(0, 3).map((model, i) => [`bow_pulling_${i}`, model]))
}

function getSortedEntries(node: Json): Json[] {
  return (Array.isArray(node.entries) ? node.entries as Json[] : []).slice().sort((left, right) => Number(left.threshold) - Number(right.threshold))
}

/** Пороги range_dispatch → диапазоны OptiFine «a-b»: значение попадает в последнюю ступень не выше себя. */
function toRanges(node: Json, scale: (threshold: number) => string): { range: string; model: unknown }[] {
  const entries = getSortedEntries(node)
  return entries.map((entry, i) => {
    const next = entries[i + 1]
    return { range: `${scale(Number(entry.threshold))}-${next ? scale(Number(next.threshold)) : ''}`, model: entry.model }
  })
}

/** Вес убывает в порядке обхода «сначала выполненное условие» — так отрицание условия в CIT не нужно. */
export function buildCitRules(value: unknown, item = ''): { rules: CitRule[]; skipped: Set<string> } {
  const leaves: { conditions: string[]; model: string; models: Record<string, string> }[] = []
  const skipped = new Set<string>()
  function visit(node: unknown, conditions: string[]) {
    if (!node || typeof node !== 'object') return
    const current = node as Json
    const type = getType(current)
    const property = getProperty(current)
    if (type === 'model' || type === 'special') {
      const model = getFirstModel(current)
      if (model && conditions.length) leaves.push({ conditions, model, models: {} })
      return
    }
    if (type === 'composite') {
      if (Array.isArray(current.models) && current.models.length) visit(current.models[0], conditions)
      return
    }
    if (type === 'condition') {
      if (property === 'using_item' && item === 'bow') {
        const pulling = getBowPulling(current.on_true)
        const standby = getFirstModel(current.on_false)
        if (pulling && standby && conditions.length) {
          leaves.push({ conditions, model: standby, models: { bow_standby: standby, ...pulling } })
          return
        }
      }
      const component = String(current.predicate ?? '').replace(/^minecraft:/, '')
      const lines = property === 'component' && (component === 'enchantments' || component === 'stored_enchantments') ? getEnchantmentCondition(current.value)
        : property === 'damaged' ? ['damage=1-']
          : null
      if (lines) visit(current.on_true, [...conditions, ...lines])
      else skipped.add(property === 'component' ? `component ${component}` : property)
      visit(current.on_false, conditions)
      return
    }
    if (type === 'select') {
      const component = String(current.component ?? '').replace(/^minecraft:/, '')
      if (property === 'component' && component === 'custom_name' && Array.isArray(current.cases)) {
        for (const choice of current.cases as Json[]) {
          for (const name of Array.isArray(choice.when) ? choice.when : [choice.when]) {
            if (typeof name === 'string') visit(choice.model, [...conditions, `nbt.display.Name=${name}`])
          }
        }
      } else skipped.add(property === 'component' ? `component ${component}` : property)
      visit(current.fallback, conditions)
      return
    }
    if (type === 'range_dispatch') {
      const normalize = current.normalize !== false
      const scale = Number(current.scale ?? 1)
      if (property === 'damage') {
        // ступени выше — старше: обход от верхней к нижней
        const list = toRanges(current, (threshold) => normalize ? `${Math.round(threshold / scale * 100)}%` : String(Math.round(threshold / scale)))
        for (const { range, model } of list.reverse()) visit(model, [...conditions, `damage=${range}`])
      } else if (property === 'count' && !normalize) {
        const list = toRanges(current, (threshold) => String(Math.round(threshold / scale)))
        for (const { range, model } of list.reverse()) visit(model, [...conditions, `stackSize=${range}`])
      } else skipped.add(property)
      visit(current.fallback ?? (current.entries as Json[] | undefined)?.[0]?.model, conditions)
    }
  }
  visit(value, [])
  // Ключ в .properties один: два условия по зачарованиям (или по имени) CIT не сложит в «и»
  const single = leaves.filter((leaf) => {
    const keys = leaf.conditions.map((condition) => condition.slice(0, condition.indexOf('=')))
    const unique = new Set(keys).size === keys.length
    if (!unique) skipped.add('несколько зачарований одновременно')
    return unique
  })
  return { rules: single.map((leaf, i) => ({ ...leaf, weight: single.length - i })), skipped }
}
