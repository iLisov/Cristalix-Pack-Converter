import raw from '../data/model-base.json'

export interface ModelBase {
  models: Record<string, Record<string, unknown>>
  textures: Record<string, { png: string; mcmeta?: string }>
}

export const MODEL_BASE: ModelBase = raw as ModelBase

export function stateModelRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stateModelRefs)
  if (!value || typeof value !== 'object') return []
  const obj = value as Record<string, unknown>
  return [...(typeof obj.model === 'string' ? [obj.model] : []), ...Object.values(obj).flatMap(stateModelRefs)]
}
