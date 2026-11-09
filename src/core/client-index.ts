import raw from '../data/cristalix-index.json'

export interface BlockstateInfo {
  multipart?: boolean
  /** Свойства блока и их допустимые значения. */
  props?: Record<string, string[]>
  /** Реальные ключи вариантов, которые запрашивает StateMapper клиента. */
  variants?: string[]
  /** Исходные варианты из ресурсов клиента: модель, поворот и uvlock для каждого состояния. */
  defaultVariants?: Record<string, unknown>
}

export interface ClientIndex {
  generatedAt: string
  /** Пути внутри assets/minecraft/textures без .png: "blocks/planks_oak". */
  textures: Set<string>
  /** Пути внутри assets/minecraft/models без .json: "block/oak_planks". */
  models: Set<string>
  modelMaterials?: Record<string, { parent?: string; textures?: Record<string, string> }>
  blockstates: Record<string, BlockstateInfo>
}

interface RawIndex {
  generatedAt: string
  textures: string[]
  models: string[]
  modelMaterials?: ClientIndex['modelMaterials']
  blockstates: Record<string, BlockstateInfo>
}

export function loadIndex(data: RawIndex = raw as RawIndex): ClientIndex {
  return {
    generatedAt: data.generatedAt,
    textures: new Set(data.textures),
    models: new Set(data.models),
    modelMaterials: data.modelMaterials,
    blockstates: data.blockstates,
  }
}

/** Пустой индекс — для тестов. */
export function emptyIndex(): ClientIndex {
  return { generatedAt: '', textures: new Set(), models: new Set(), blockstates: {} }
}
