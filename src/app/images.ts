import type { ImageOps } from '../core/convert'
import { hasSlotGrid, slotGridLayers } from '../core/gui'

const asBlob = (data: Uint8Array) => new Blob([data], { type: 'image/png' })

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

async function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось закодировать PNG'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

export const browserImageOps: ImageOps = {
  async size(data) {
    const bmp = await createImageBitmap(asBlob(data))
    const size = { w: bmp.width, h: bmp.height }
    bmp.close()
    return size
  },

  async resize(data, width) {
    const bmp = await createImageBitmap(asBlob(data))
    const height = Math.round((bmp.height * width) / bmp.width)
    // Уменьшаем в два раза за шаг: так каждый пиксель усредняет соседей, а не теряется.
    let src: CanvasImageSource = bmp
    let w = bmp.width
    let h = bmp.height
    while (w / 2 >= width) {
      const c = canvas(w / 2, h / 2)
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, 0, 0, c.width, c.height)
      src = c
      w = c.width
      h = c.height
    }
    const out = canvas(width, height)
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, width, height)
    bmp.close()
    return toPng(out)
  },

  async compose(w, h, layers) {
    const c = canvas(w, h)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const pending = [...layers]
    for (let i = 0; i < pending.length; i++) {
      const l = pending[i]
      if (l.slotGrid) {
        const pixels = ctx.getImageData(l.dx, l.dy, l.dw, l.dh)
        if (!hasSlotGrid(pixels.data, pixels.width, pixels.height, l.slotGrid.cols, l.slotGrid.rows)) pending.splice(i + 1, 0, ...slotGridLayers(l))
        continue
      }
      const bmp = await createImageBitmap(asBlob(l.data))
      // спрайт целиком заменяет свою область, а не смешивается с основой
      if (l.replace) ctx.clearRect(l.dx, l.dy, l.dw, l.dh)
      ctx.save()
      ctx.translate(l.dx + (l.flipX ? l.dw : 0), l.dy + (l.flipY ? l.dh : 0))
      ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1)
      ctx.drawImage(bmp, l.sx ?? 0, l.sy ?? 0, l.sw ?? bmp.width, l.sh ?? bmp.height, 0, 0, l.dw, l.dh)
      ctx.restore()
      bmp.close()
    }
    return toPng(c)
  },
}
