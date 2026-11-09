// Конвертер шрифта новых версий (bitmap-провайдеры font/*.json или просто подменённые
// картинки ванильного шрифта) в формат 1.12:
//   • textures/font/ascii.png в раскладке FontRenderer 1.12 (ширины клиент считает сам);
//   • unicode_page_XX.png для всех символов — поверх страниц шрифта клиента;
//   • glyph_sizes.bin — ширины пересчитаны по готовым страницам.
import vanilla from '../data/vanilla-font.json'
import { computeWidths } from './bitmap'

type Files = Map<string, Uint8Array>

/** Раскладка ascii.png в 1.12 (FontRenderer#renderChar). */
export const ASCII_1_12 =
  'ÀÁÂÈÊËÍÓÔÕÚßãõğİıŒœŞşŴŵžȇ\u0000\u0000\u0000\u0000\u0000\u0000\u0000 !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u0000ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αβΓπΣσμτΦΘΩδ∞∅∈∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u0000'

interface Provider {
  file: string
  height: number
  ascent: number
  chars: string[]
}

interface Glyph {
  img: ImageBitmap
  sx: number
  sy: number
  sw: number
  sh: number
  height: number
  ascent: number
}

export interface ConvertedFont {
  pages: Map<number, Uint8Array>
  glyphSizes: Uint8Array
  /** ascii.png в раскладке 1.12, если пак менял ascii.png. */
  ascii?: Uint8Array
  notes: string[]
}

const decoder = new TextDecoder()
const split = (id: string): [string, string] => (id.includes(':') ? (id.split(':') as [string, string]) : ['minecraft', id])

function parse(data?: Uint8Array): { providers?: unknown[] } | null {
  if (!data) return null
  try {
    return JSON.parse(decoder.decode(data).replace(/^﻿/, ''))
  } catch {
    return null
  }
}

/** Похож ли пак на шрифт новых версий (а не на готовый шрифт 1.12). */
export function isModernFont(files: Files, root: string): boolean {
  const has = (p: string) => files.has(root + p)
  return (
    has('assets/minecraft/font/default.json') ||
    has('assets/minecraft/textures/font/nonlatin_european.png') ||
    has('assets/minecraft/textures/font/accented.png')
  )
}

/** Провайдеры шрифта default: из пака, ссылки на ванильные — из разметки 1.21. */
function collectProviders(files: Files, root: string): Provider[] {
  const out: Provider[] = []
  const seen = new Set<string>()
  const load = (id: string) => {
    const [ns, path] = split(id)
    const key = `${ns}:${path}`
    if (seen.has(key)) return
    seen.add(key)
    const json = parse(files.get(`${root}assets/${ns}/font/${path}.json`))
    if (!json?.providers) {
      if (key === 'minecraft:include/default' || key === 'minecraft:default') out.push(...(vanilla.providers as Provider[]))
      return
    }
    for (const raw of json.providers) {
      const p = raw as Record<string, unknown>
      if (p.type === 'reference' && typeof p.id === 'string') load(p.id)
      else if (p.type === 'bitmap' && typeof p.file === 'string' && Array.isArray(p.chars)) {
        out.push({ file: p.file, height: typeof p.height === 'number' ? p.height : 8, ascent: Number(p.ascent ?? 7), chars: p.chars as string[] })
      }
    }
  }
  load('minecraft:default')
  return out
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return { c, ctx }
}

async function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('PNG'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Вписывает глиф в ячейку 8×8 px текста: масштаб и сдвиг по базовой линии (7 px от верха). */
function place(g: Glyph) {
  const gw = (g.sw * g.height) / g.sh
  const s = Math.min(1, 8 / g.height, 8 / gw)
  const top = Math.min(Math.max(0, 7 - g.ascent * s), 8 - g.height * s)
  return { w: gw * s, h: g.height * s, top }
}

export async function convertModernFont(
  files: Files,
  root: string,
  basePages: Map<number, Uint8Array>,
  baseGlyphs?: Uint8Array,
): Promise<ConvertedFont> {
  const notes: string[] = []
  const providers = collectProviders(files, root)
  const glyphs = new Map<number, Glyph>()
  const images = new Map<string, ImageBitmap | null>()
  let asciiChanged = false

  for (const p of providers) {
    const [ns, path] = split(p.file)
    const tex = `${root}assets/${ns}/textures/${path}`
    // берём только картинки, которые есть в паке: остальное и так есть у клиента
    if (!images.has(tex)) {
      const data = files.get(tex)
      images.set(tex, data ? await createImageBitmap(new Blob([data], { type: 'image/png' })).catch(() => null) : null)
    }
    const img = images.get(tex)
    if (!img) continue
    if (path === 'font/ascii.png') asciiChanged = true
    const rows = p.chars.map((r) => Array.from(r))
    const cols = Math.max(...rows.map((r) => r.length))
    const cw = img.width / cols
    const ch = img.height / rows.length
    rows.forEach((row, ry) =>
      row.forEach((c, rx) => {
        const cp = c.codePointAt(0)!
        if (cp === 0 || cp === 0x20 || cp > 0xffff || glyphs.has(cp)) return
        glyphs.set(cp, { img, sx: rx * cw, sy: ry * ch, sw: cw, sh: ch, height: p.height, ascent: p.ascent })
      }),
    )
  }
  if (glyphs.size === 0) throw new Error('В паке не нашлось картинок шрифта.')

  // Разрешение: сколько пикселей картинки на пиксель текста (у HD-шрифтов больше 1)
  const res = Math.max(1, ...[...glyphs.values()].map((g) => Math.round(g.sh / g.height)))

  // ascii.png 1.12: ячейка 8×8 px текста
  let ascii: Uint8Array | undefined
  if (asciiChanged) {
    const cell = 8 * res
    const { c, ctx } = canvas(16 * cell, 16 * cell)
    for (let i = 0; i < 256; i++) {
      const g = glyphs.get(ASCII_1_12.charCodeAt(i))
      if (!g || ASCII_1_12[i] === '\u0000') continue
      const pl = place(g)
      ctx.drawImage(g.img, g.sx, g.sy, g.sw, g.sh, (i % 16) * cell, ((i / 16) | 0) * cell + pl.top * res, pl.w * res, pl.h * res)
    }
    ascii = await toPng(c)
  }

  // Страницы unicode: ячейка 16×16 единиц на 8×8 px текста → 2 единицы на пиксель
  const byPage = new Map<number, number[]>()
  for (const cp of glyphs.keys()) byPage.set(cp >> 8, [...(byPage.get(cp >> 8) ?? []), cp])
  const pages = new Map<number, Uint8Array>()
  const glyphSizes = new Uint8Array(65536)
  if (baseGlyphs) glyphSizes.set(baseGlyphs.subarray(0, 65536))
  else notes.push('Нет glyph_sizes.bin клиента: ширины записаны только для символов этого шрифта.')

  for (const [page, cps] of byPage) {
    const unit = res // пикселей страницы на единицу (2 единицы = 1 px текста ⇒ при res=1 страница 256)
    const cell = 16 * unit
    const { c, ctx } = canvas(16 * cell, 16 * cell)
    const baseData = basePages.get(page)
    if (baseData) {
      const bmp = await createImageBitmap(new Blob([baseData], { type: 'image/png' }))
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
    }
    for (const cp of cps) {
      const g = glyphs.get(cp)!
      const i = cp & 0xff
      const x = (i % 16) * cell
      const y = ((i / 16) | 0) * cell
      const pl = place(g)
      ctx.clearRect(x, y, cell, cell)
      ctx.drawImage(g.img, g.sx, g.sy, g.sw, g.sh, x, y + pl.top * 2 * unit, pl.w * 2 * unit, pl.h * 2 * unit)
    }
    const png = await toPng(c)
    pages.set(page, png)
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }))
    const widths = computeWidths(bmp)
    for (const cp of cps) glyphSizes[cp] = widths[cp & 0xff]
    bmp.close()
  }
  notes.push(`Символов: ${glyphs.size}, страниц: ${pages.size}${ascii ? ', ascii.png в раскладке 1.12' : ''}.`)
  return { pages, glyphSizes, ascii, notes }
}
