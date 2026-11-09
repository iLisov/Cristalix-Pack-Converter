// Шрифты: в 1.13+ иконки в тексте задаются bitmap-шрифтами (font/*.json), часто символами
// за пределами BMP (U+F0000…). В 1.12 шрифт — это textures/font/unicode_page_XX.png
// (сетка 16×16, ячейка = 8×8 px текста) + font/glyph_sizes.bin (ширина каждого символа),
// а текст обрабатывается 16-битными символами. Поэтому каждую иконку переносим
// в приватную область U+E000–U+F8FF на свободную страницу и правим переводы.
import type { ClientIndex } from './client-index'
import type { ComposePart, Note } from './types'

type Json = Record<string, unknown>

export interface FontPlan {
  /** Старая кодовая точка → новая (в BMP). */
  remap: Map<number, number>
  /** Страница (0xE0…) → куски, которые на неё ложатся (координаты в ванильных 256×256). */
  pages: Map<number, ComposePart[]>
  /** Ширины глифов для glyph_sizes.bin: кодовая точка → байт (старшая тетрада — начало, младшая — конец). */
  widths: Map<number, number>
  /** Файлы шрифтов и картинки глифов, которые ушли в страницы. */
  consumed: Set<string>
  notes: Note[]
}

/** Ширина и высота PNG из заголовка IHDR. */
export function pngSize(data: Uint8Array): { w: number; h: number } | null {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { w: v.getUint32(16), h: v.getUint32(20) }
}

const decoder = new TextDecoder()

function parse(data: Uint8Array | undefined): Json | null {
  if (!data) return null
  try {
    return JSON.parse(decoder.decode(data).replace(/^﻿/, '')) as Json
  } catch {
    return null
  }
}

function split(id: string): [string, string] {
  const i = id.indexOf(':')
  return i >= 0 ? [id.slice(0, i), id.slice(i + 1)] : ['minecraft', id]
}

export function planFonts(files: Map<string, Uint8Array>, root: string, idx: ClientIndex): FontPlan | null {
  const plan: FontPlan = { remap: new Map(), pages: new Map(), widths: new Map(), consumed: new Set(), notes: [] }
  const providers: { font: string; p: Json }[] = []
  const visited = new Set<string>()

  function load(id: string) {
    const [ns, path] = split(id)
    const file = `${root}assets/${ns}/font/${path}.json`
    if (visited.has(file)) return
    visited.add(file)
    const json = parse(files.get(file))
    if (!json || !Array.isArray(json.providers)) return
    plan.consumed.add(file)
    for (const p of json.providers as Json[]) {
      if (p?.type === 'reference' && typeof p.id === 'string') load(p.id)
      else if (p?.type === 'bitmap') providers.push({ font: file, p })
    }
  }
  load('minecraft:default')
  if (providers.length === 0) return null

  // Свободные страницы: в клиенте нет такой unicode_page, и это приватная область
  const freePages: number[] = []
  for (let page = 0xe0; page <= 0xf8; page++) {
    if (!idx.textures.has(`font/unicode_page_${page.toString(16).padStart(2, '0')}`)) freePages.push(page)
  }
  const used = new Set<number>()
  let cursor = 0
  const next = (): number | null => {
    for (; cursor < freePages.length * 256; cursor++) {
      const cp = freePages[(cursor / 256) | 0] * 256 + (cursor % 256)
      if (!used.has(cp)) return cp
    }
    return null
  }
  // Глифы, уже стоящие на свободных страницах BMP, оставляем на месте
  const keep = (cp: number) => cp >= 0xe000 && cp <= 0xf8ff && freePages.includes(cp >> 8)

  let placed = 0
  let skipped = 0
  for (const { p } of providers) {
    if (typeof p.file !== 'string' || !Array.isArray(p.chars)) continue
    const [ns, path] = split(p.file)
    const tex = `${root}assets/${ns}/textures/${path}`
    const data = files.get(tex)
    const size = data && pngSize(data)
    if (!size) continue
    const rows = (p.chars as string[]).map((r) => Array.from(r))
    const cols = Math.max(...rows.map((r) => r.length))
    if (!cols) continue
    const cw = size.w / cols
    const ch = size.h / rows.length
    const height = typeof p.height === 'number' ? p.height : 8
    const ascent = typeof p.ascent === 'number' ? p.ascent : 7
    plan.consumed.add(tex)

    rows.forEach((row, ry) =>
      row.forEach((char, rx) => {
        const cp = char.codePointAt(0)!
        if (cp === 0 || cp === 0x20) return
        let target: number | null | undefined = plan.remap.get(cp)
        if (target === undefined) {
          if (keep(cp) && !used.has(cp)) target = cp
          else if (cp > 0xffff || (cp >= 0xe000 && cp <= 0xf8ff)) target = next()
          else {
            skipped++
            return
          }
          if (target === null) {
            skipped++
            return
          }
          used.add(target)
          if (target !== cp) plan.remap.set(cp, target)
        } else return

        // Размер глифа в пикселях текста и вписывание в ячейку 8×8 (16×16 единиц страницы)
        const gw = (cw * height) / ch
        const s = Math.min(1, 8 / height, 8 / gw)
        const w = Math.max(1, Math.round(gw * s * 2))
        const h = Math.max(1, Math.round(height * s * 2))
        const top = Math.min(Math.max(0, 7 - ascent * s), 8 - height * s)
        const page = target >> 8
        const cell = target & 0xff
        const list = plan.pages.get(page) ?? []
        list.push({
          source: tex,
          x: (cell % 16) * 16,
          y: ((cell / 16) | 0) * 16 + Math.round(top * 2),
          w,
          h,
          sx: rx * cw,
          sy: ry * ch,
          sw: cw,
          sh: ch,
          blend: true,
        })
        plan.pages.set(page, list)
        plan.widths.set(target, (0 << 4) | Math.min(15, w - 1))
        placed++
      }),
    )
  }
  plan.notes.push({ level: 'info', text: `Глифов перенесено: ${placed}, из них на новые кодовые точки: ${plan.remap.size}.` })
  if (skipped > 0) plan.notes.push({ level: 'warn', text: `Не перенесено глифов: ${skipped} (замена обычных символов или нет места).` })
  return plan
}

/** Заменяет кодовые точки в строке по таблице. */
export function remapText(text: string, remap: Map<number, number>): string {
  if (remap.size === 0) return text
  let out = ''
  for (const ch of text) {
    const t = remap.get(ch.codePointAt(0)!)
    out += t === undefined ? ch : String.fromCharCode(t)
  }
  return out
}

/** glyph_sizes.bin основы + ширины новых глифов. */
export function patchGlyphSizes(base: Uint8Array, widths: Map<number, number>): Uint8Array {
  const out = new Uint8Array(65536)
  out.set(base.subarray(0, 65536))
  for (const [cp, b] of widths) if (cp < 65536) out[cp] = b
  return out
}
