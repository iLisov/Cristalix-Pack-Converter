export type Status =
  /** Переименовано в имя 1.12. */
  | 'renamed'
  /** Путь совпадает с клиентом, перенесено как есть. */
  | 'same'
  /** Содержимое переписано (модель, блокстейт, lang, склейка). */
  | 'converted'
  /** Готового соответствия нет в индексе; файл может использоваться внешними моделями или модами. */
  | 'unknown'
  /** Не переносится. */
  | 'skipped'

export type Group = 'blocks' | 'items' | 'entity' | 'models' | 'blockstates' | 'other'

export interface Note {
  level: 'info' | 'warn'
  text: string
}

export interface ConvertOptions {
  /** Уменьшить текстуры блоков и предметов до N px по ширине; 0 — не трогать. */
  maxResolution: 0 | 16 | 32 | 64 | 128
  /** Класть в пак файлы без найденного соответствия; зависимости моделей сохраняются отдельно. */
  keepUnknown: boolean
  /** Переводить lang/*.json в формат .lang. */
  convertLang: boolean
}

export const DEFAULT_OPTIONS: ConvertOptions = { maxResolution: 0, keepUnknown: true, convertLang: true }

/**
 * Пресет — правила, которыми делятся в команде.
 * textures: "block/cherry_leaves" → ["blocks/simple_block_6601"] (пути внутри textures/, без .png);
 * пустой массив — исключить.
 */
export interface Preset {
  name: string
  version: 1
  textures: Record<string, string[]>
}

/** Ручная правка одного файла из интерфейса: ключ — исходный путь в архиве. */
export type Overrides = Record<string, { targets: string[] } | { exclude: true }>

export type Transform =
  | { type: 'copy' }
  | { type: 'text'; text: string }
  | { type: 'resize'; width: number }
  | {
      type: 'compose'
      /** Размер атласа в ванильном разрешении; итог масштабируется под разрешение пака. */
      size: [number, number]
      /** Основа: файл пака или (с префиксом base:) файл подключённого клиента 1.12. */
      base?: string
      parts: ComposePart[]
      /** Фиксированный масштаб итога; по умолчанию — по разрешению основы или спрайтов. */
      scale?: number
    }
  | { type: 'bytes'; data: Uint8Array }

export interface ComposePart {
  source: string
  /** Куда в атласе (ванильные пиксели). */
  x: number
  y: number
  w: number
  h: number
  /** Откуда в источнике (ванильные пиксели); без них берётся вся картинка (первый кадр). */
  sx?: number
  sy?: number
  /** Ванильная ширина источника — для пересчёта под разрешение пака. */
  srcW?: number
  /** Размер области источника в реальных пикселях (если задан — sx/sy тоже в реальных). */
  sw?: number
  sh?: number
  flipX?: boolean
  flipY?: boolean
  /** Накладывать поверх (слои жителей), а не заменять область. */
  blend?: boolean
  /** Нарезка nine_slice: номинальный размер спрайта и рамки в тех же единицах. */
  slice?: Slice
  /** Повторять спрайт плиткой в номинальном разрешении gui.scaling. */
  tile?: { nw: number; nh: number }
  /** Анимация спрайта: размер кадра в пикселях картинки (берётся первый кадр). */
  anim?: { w?: number; h?: number; frame?: number }
  /** Восстановить сетку из отдельного slot.png, только если фон ещё не содержит её. */
  slotGrid?: { cols: number; rows: number }
}

export interface Slice {
  nw: number
  nh: number
  l: number
  t: number
  r: number
  b: number
  /** false — повторять внутренние сегменты плиткой, как GuiGraphics. */
  stretchInner?: boolean
}

export interface PlanEntry {
  /** Путь в исходном архиве (для синтетических — условный id). */
  source: string
  /** Путь внутри textures/ без .png, если это текстура. */
  texture?: string
  group: Group
  /** Полные пути в итоговом архиве. */
  targets: string[]
  status: Status
  notes: Note[]
  transform: Transform
  manual?: 'preset' | 'override'
}

export interface Plan {
  /** Префикс внутри архива, где лежит pack.mcmeta. */
  root: string
  packFormat?: number
  description: string
  entries: PlanEntry[]
}
