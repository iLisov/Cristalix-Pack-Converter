import raw from '../data/legacy-map.json'

export interface SpritePlace {
  /** Атлас 1.12: путь внутри textures/ без .png. */
  atlas: string
  x: number
  y: number
  w: number
  h: number
  /** Растянуть спрайт до w×h с сохранением краёв (вкладки креатива 26 → 28 px). */
  slice?: { nw: number; nh: number; l: number; t: number; r: number; b: number }
}

/** Соответствия «новые версии → 1.12.2», вычисленные по клиентам (scripts/build-legacy-map.mjs). */
export interface LegacyMap {
  /** Атласы 1.12, которых нет в новых версиях: если пак их содержит — они уже в старом формате. */
  legacyOnly: string[]
  /** Путь текстуры новой версии → пути 1.12 (внутри textures/, без .png). */
  textures: Record<string, string[]>
  /** Спрайт новой версии → места в атласах 1.12. */
  sprites: Record<string, SpritePlace[]>
  /** Размер атласа 1.12 в ванильном разрешении. */
  atlasSizes: Record<string, [number, number]>
  /** Ключ перевода новой версии → ключи 1.12. */
  lang: Record<string, string[]>
  /** Звуковое событие новой версии → событие 1.12. */
  sounds: Record<string, string>
  /** Модель блока новой версии → модель 1.12 (block/…, без префикса). */
  models: Record<string, string>
}

export const LEGACY: LegacyMap = raw as unknown as LegacyMap

export const EMPTY_LEGACY: LegacyMap = { legacyOnly: [], textures: {}, sprites: {}, atlasSizes: {}, lang: {}, sounds: {}, models: {} }

export function legacySpritePlaces(source: string, legacy: LegacyMap): SpritePlace[] | undefined {
  const places = legacy.sprites[source]
  if (!places) return undefined
  const container = /^gui\/sprites\/container\/([^/]+)\//.exec(source)
  const prefix = container ? `gui/container/${container[1]}` : source.startsWith('gui/sprites/advancements/') ? 'gui/advancements' : undefined
  if (!prefix) return places
  const matching = places.filter((p) => p.atlas === prefix || p.atlas.startsWith(prefix + '/'))
  return matching.length > 0 ? matching : undefined
}
