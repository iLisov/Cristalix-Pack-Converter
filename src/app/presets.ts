import type { ConvertOptions, Preset } from '../core/types'
import { DEFAULT_OPTIONS } from '../core/types'

const KEY_PRESET = 'cpc.preset'
const KEY_OPTIONS = 'cpc.options'

export const EMPTY_PRESET: Preset = { name: 'Мой пресет', version: 1, textures: {} }

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // приватный режим или квота — работаем без сохранения
  }
}

/** Проверяет файл пресета; бросает понятную ошибку, если формат не тот. */
export function parsePreset(text: string): Preset {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Файл пресета — не JSON.')
  }
  const p = data as Partial<Preset>
  if (!p || typeof p !== 'object' || typeof p.textures !== 'object' || p.textures === null) {
    throw new Error('В пресете нет раздела «textures».')
  }
  const textures: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(p.textures)) {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      throw new Error(`Правило «${k}» должно быть списком путей.`)
    }
    textures[k] = v
  }
  return { name: typeof p.name === 'string' && p.name ? p.name : 'Пресет', version: 1, textures }
}

export const loadPreset = (): Preset => {
  const raw = read<unknown>(KEY_PRESET)
  try {
    return raw ? parsePreset(JSON.stringify(raw)) : EMPTY_PRESET
  } catch {
    return EMPTY_PRESET
  }
}
export const savePreset = (p: Preset) => write(KEY_PRESET, p)

export const loadOptions = (): ConvertOptions => ({ ...DEFAULT_OPTIONS, ...(read<Partial<ConvertOptions>>(KEY_OPTIONS) ?? {}) })
export const saveOptions = (o: ConvertOptions) => write(KEY_OPTIONS, o)
