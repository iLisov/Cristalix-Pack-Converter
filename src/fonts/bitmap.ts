// Bitmap-шрифт 1.12: страницы unicode_page_XX.png (16×16 ячеек) + glyph_sizes.bin,
// где байт символа = (первая непрозрачная колонка << 4) | последняя, в единицах 1/16 ячейки.

export type PageImages = Map<number, ImageBitmap>

/** Ширины 256 символов страницы — как их считает Mojang для glyph_sizes.bin. */
export function computeWidths(img: ImageBitmap): Uint8Array {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, img.width, img.height)
  const cell = img.width / 16
  const out = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    const cx = (i % 16) * cell
    const cy = ((i / 16) | 0) * cell
    let first = -1
    let last = -1
    for (let x = 0; x < cell; x++) {
      let any = false
      for (let y = 0; y < cell && !any; y++) {
        if (data[((cy + y) * img.width + cx + x) * 4 + 3] > 0) any = true
      }
      if (any) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first >= 0) {
      const s = Math.floor((first * 16) / cell)
      const e = Math.min(15, Math.floor((last * 16) / cell))
      out[i] = (s << 4) | e
    }
  }
  return out
}

const COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
  '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
}

export interface RenderOptions {
  pages: PageImages
  widths: Uint8Array
  scale: number
  shadow: boolean
}

/**
 * Рисует строки так, как FontRenderer 1.12 рисует unicode-символы:
 * глиф = область [start, end+1) ячейки, высота 8 px, шаг = (end+1-start)/2 + 1.
 * Возвращает ширину в пикселях текста.
 */
export function renderBitmapText(ctx: CanvasRenderingContext2D, lines: string[], o: RenderOptions): void {
  const tint = document.createElement('canvas')
  const tctx = tint.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  lines.forEach((line, row) => {
    let x = 2
    const y = 2 + row * 10
    let color = '#ffffff'
    const chars = Array.from(line)
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]
      if (ch === '§' && i + 1 < chars.length) {
        const code = chars[++i].toLowerCase()
        if (COLORS[code]) color = COLORS[code]
        else if (code === 'r') color = '#ffffff'
        continue
      }
      const cp = ch.codePointAt(0)!
      if (cp === 0x20) {
        x += 4
        continue
      }
      if (cp > 0xffff) {
        x += 6
        continue
      }
      const page = o.pages.get(cp >> 8)
      const w = o.widths[cp]
      if (!page || w === 0) {
        // символа нет — рисуем рамку, как «нет глифа»
        ctx.strokeStyle = '#ff5555'
        ctx.lineWidth = 1
        ctx.strokeRect((x + 0.5) * o.scale, (y + 0.5) * o.scale, 4 * o.scale, 7 * o.scale)
        x += 6
        continue
      }
      const start = w >> 4
      const end = (w & 15) + 1
      const cell = page.width / 16
      const sx = ((cp & 0xff) % 16) * cell + (start * cell) / 16
      const sy = (((cp & 0xff) / 16) | 0) * cell
      const sw = ((end - start) * cell) / 16
      const dw = ((end - start) / 2) * o.scale
      const dh = 8 * o.scale
      // Как в клиенте: цвет текстуры умножается на цвет текста (белый оставляет глиф как есть)
      tint.width = Math.max(1, Math.ceil(dw))
      tint.height = Math.ceil(dh)
      tctx.imageSmoothingEnabled = false
      const paint = (c: string) => {
        tctx.globalCompositeOperation = 'source-over'
        tctx.clearRect(0, 0, tint.width, tint.height)
        tctx.drawImage(page, sx, sy, sw, cell, 0, 0, dw, dh)
        tctx.globalCompositeOperation = 'multiply'
        tctx.fillStyle = c
        tctx.fillRect(0, 0, tint.width, tint.height)
        // multiply закрашивает и прозрачные пиксели — возвращаем форму глифа
        tctx.globalCompositeOperation = 'destination-in'
        tctx.drawImage(page, sx, sy, sw, cell, 0, 0, dw, dh)
      }
      if (o.shadow) {
        paint(shade(color))
        ctx.drawImage(tint, (x + 1) * o.scale, (y + 1) * o.scale)
      }
      paint(color)
      ctx.drawImage(tint, x * o.scale, y * o.scale)
      x += (end - start) / 2 + 1
    }
  })
}

/** Тень текста 1.12: цвет ×0.25. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) >> 2
  const g = ((n >> 8) & 255) >> 2
  const b = (n & 255) >> 2
  return `rgb(${r},${g},${b})`
}
