// Обработка PNG для Node (скрипты и проверки): то же, что images.ts делает в браузере.
import { PNG } from 'pngjs'
import type { ImageOps, Layer } from '../src/core/convert'
import { hasSlotGrid, slotGridLayers } from '../src/core/gui'

const read = (d: Uint8Array) => PNG.sync.read(Buffer.from(d))
const write = (p: PNG) => new Uint8Array(PNG.sync.write(p))

function draw(dst: PNG, src: PNG, l: Layer, replace: boolean) {
  if (l.slotGrid) {
    const region = new PNG({ width: l.dw, height: l.dh })
    PNG.bitblt(dst, region, l.dx, l.dy, l.dw, l.dh, 0, 0)
    if (!hasSlotGrid(region.data, region.width, region.height, l.slotGrid.cols, l.slotGrid.rows))
      for (const tile of slotGridLayers(l)) draw(dst, src, tile, false)
    return
  }
  const sx = l.sx ?? 0
  const sy = l.sy ?? 0
  const sw = l.sw ?? src.width
  const sh = l.sh ?? src.height
  for (let y = 0; y < l.dh; y++) {
    const dy = l.dy + y
    if (dy < 0 || dy >= dst.height) continue
    const ty = l.flipY ? l.dh - 1 - y : y
    const py = sy + Math.floor((ty * sh) / l.dh)
    for (let x = 0; x < l.dw; x++) {
      const dx = l.dx + x
      if (dx < 0 || dx >= dst.width) continue
      const tx = l.flipX ? l.dw - 1 - x : x
      const px = sx + Math.floor((tx * sw) / l.dw)
      const si = (py * src.width + px) * 4
      const di = (dy * dst.width + dx) * 4
      const a = src.data[si + 3] / 255
      if (replace || a === 1) {
        src.data.copy(dst.data, di, si, si + 4)
      } else if (a > 0) {
        for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round(src.data[si + c] * a + dst.data[di + c] * (1 - a))
        dst.data[di + 3] = Math.round(255 * (a + (dst.data[di + 3] / 255) * (1 - a)))
      }
    }
  }
}

export const nodeImageOps: ImageOps = {
  async size(d) {
    const p = read(d)
    return { w: p.width, h: p.height }
  },
  async resize(d, width) {
    const src = read(d)
    const height = Math.round((src.height * width) / src.width)
    const dst = new PNG({ width, height })
    const k = src.width / width
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const acc = [0, 0, 0, 0]
        for (let yy = 0; yy < k; yy++)
          for (let xx = 0; xx < k; xx++) {
            const i = ((Math.floor(y * k) + yy) * src.width + Math.floor(x * k) + xx) * 4
            for (let c = 0; c < 4; c++) acc[c] += src.data[i + c]
          }
        const n = Math.ceil(k) ** 2
        for (let c = 0; c < 4; c++) dst.data[(y * width + x) * 4 + c] = Math.round(acc[c] / n)
      }
    return write(dst)
  },
  async compose(w, h, layers) {
    const dst = new PNG({ width: w, height: h })
    dst.data.fill(0)
    for (const l of layers) draw(dst, read(l.data), l, !!l.replace)
    return write(dst)
  },
}
