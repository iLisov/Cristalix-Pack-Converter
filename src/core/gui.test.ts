import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { nodeImageOps } from '../../scripts/node-images'
import { buildPack, composeAtlas, planPack, spriteMeta, type Files } from './convert'
import { emptyIndex } from './client-index'
import { guiBaseAsset } from './gui'
import { DEFAULT_OPTIONS } from './types'
import type { ComposePart } from './types'

const T = 'assets/minecraft/textures/'
const encode = new TextEncoder()

function image(w: number, h: number, paint: (x: number, y: number) => number[]): Uint8Array {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) png.data.set(paint(x, y), (y * w + x) * 4)
  return new Uint8Array(PNG.sync.write(png))
}

const decode = (data: Uint8Array | string) => PNG.sync.read(Buffer.from(data))
const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)]
const plan = (files: Files, base?: Files) => planPack({ files, base, index: emptyIndex(), options: DEFAULT_OPTIONS })

describe('неполные атласы GUI', () => {
  it('пересобирает вкладки 26 → 28 px, даже если новый пак содержит готовый tabs.png', async () => {
    const path = `${T}gui/container/creative_inventory/tabs.png`
    const files: Files = new Map([
      ['pack.mcmeta', encode.encode('{"pack":{"pack_format":42,"description":"tabs"}}')],
      [path, image(256, 256, () => [200, 0, 0, 255])],
      [`${T}gui/sprites/container/creative_inventory/tab_top_unselected_2.png`, image(26, 32, (x) => x === 0 || x === 25 ? [255, 255, 255, 255] : [0, 100, 0, 255])],
    ])
    const out = await buildPack(plan(files), files, nodeImageOps)
    const tabs = decode(out.get(path)!)
    expect(pixel(tabs, 28, 12)).toEqual([255, 255, 255, 255])
    expect(pixel(tabs, 55, 12)).toEqual([255, 255, 255, 255])
    expect(pixel(tabs, 54, 12)).toEqual([0, 100, 0, 255])
    expect(pixel(tabs, 56, 12)).toEqual([200, 0, 0, 255])
  })

  it('не переносит ползунок ткацкого станка в креатив (Solarpunk)', () => {
    const files: Files = new Map([[`${T}gui/sprites/container/loom/scroller.png`, image(12, 15, () => [10, 200, 30, 255])]])
    const p = plan(files)
    expect(p.entries.some((e) => e.targets.includes(`${T}gui/container/creative_inventory/tabs.png`))).toBe(false)
  })

  it('сообщает, что фон выживания не меняет креатив, если его текстур нет в паке', () => {
    const files: Files = new Map([[`${T}gui/container/inventory.png`, image(256, 256, () => [10, 200, 30, 255])]])
    expect(plan(files).entries.find((e) => e.texture === 'gui/container/inventory')?.notes.some((n) => n.text.startsWith('В исходном паке нет текстур креатива.'))).toBe(true)
  })

  it('сохраняет ванильные кнопки, когда пак заменяет только хотбар (Solarpunk)', async () => {
    const hotbar = image(182, 22, () => [10, 200, 30, 255])
    const files: Files = new Map([[`${T}gui/sprites/hud/hotbar.png`, hotbar]])
    const p = plan(files)
    const out = await buildPack(p, files, nodeImageOps)
    const widgets = decode(out.get(`${T}gui/widgets.png`)!)
    const vanilla = decode(guiBaseAsset(`${T}gui/widgets.png`)!)
    expect(pixel(widgets, 20, 10)).toEqual([10, 200, 30, 255])
    expect(pixel(widgets, 20, 70)).toEqual(pixel(vanilla, 20, 70))
    expect(pixel(widgets, 20, 70)[3]).toBe(255)
    expect(p.entries.some((e) => e.notes.some((n) => n.text.startsWith('Нет основы')))).toBe(false)
  })

  it('основа пользователя имеет приоритет над встроенной', async () => {
    const path = `${T}gui/widgets.png`
    const files: Files = new Map([[`${T}gui/sprites/hud/hotbar.png`, image(182, 22, () => [10, 20, 30, 255])]])
    const base: Files = new Map([[path, image(256, 256, () => [20, 40, 60, 255])]])
    const out = await buildPack(plan(files, base), files, nodeImageOps, undefined, base)
    expect(pixel(decode(out.get(path)!), 20, 70)).toEqual([20, 40, 60, 255])
  })
})

describe('сборка спрайтов по GuiGraphics MCP 1.21.4', () => {
  async function render(data: Uint8Array, w: number, h: number, metadata: object) {
    const part: ComposePart = { source: 'sprite', x: 0, y: 0, w, h, ...spriteMeta(encode.encode(JSON.stringify(metadata))) }
    return decode(await composeAtlas([w, h], undefined, [part], new Map([['sprite', data]]), nodeImageOps, 1))
  }

  it('tile повторяет узор и обрезает последнюю плитку', async () => {
    const src = image(2, 2, (x, y) => [20 + x * 60, 30 + y * 80, 0, 255])
    const out = await render(src, 5, 3, { gui: { scaling: { type: 'tile', width: 2, height: 2 } } })
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 5; x++) expect(pixel(out, x, y)).toEqual([20 + (x % 2) * 60, 30 + (y % 2) * 80, 0, 255])
  })

  it.each([false, true])('nine_slice сохраняет рамку, stretch_inner=%s', async (stretchInner) => {
    const src = image(4, 4, (x, y) => [x * 60, y * 60, 0, 255])
    const out = await render(src, 8, 6, { gui: { scaling: { type: 'nine_slice', width: 4, height: 4, border: 1, stretch_inner: stretchInner } } })
    const expected = stretchInner ? [0, 60, 60, 60, 120, 120, 120, 180] : [0, 60, 120, 60, 120, 60, 120, 180]
    expect(Array.from({ length: 8 }, (_, x) => pixel(out, x, 1)[0])).toEqual(expected)
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(out, 7, 5)).toEqual([180, 180, 0, 255])
  })

  it('nine_slice по умолчанию повторяет середину, а явный stretch отменяет запасную нарезку', async () => {
    const src = image(4, 4, (x, y) => [x * 60, y * 60, 0, 255])
    const out = await render(src, 8, 4, { gui: { scaling: { type: 'nine_slice', width: 4, height: 4, border: 1 } } })
    expect(Array.from({ length: 8 }, (_, x) => pixel(out, x, 1)[0])).toEqual([0, 60, 120, 60, 120, 60, 120, 180])
    expect(spriteMeta(encode.encode('{"gui":{"scaling":{"type":"stretch"}}}'), { nw: 4, nh: 4, l: 1, t: 1, r: 1, b: 1 })).toEqual({})
  })

  it('ограничивает слишком широкие рамки половиной целевого размера', async () => {
    const src = image(8, 6, (x, y) => [x * 20, y * 30, 0, 255])
    const out = await render(src, 3, 2, { gui: { scaling: { type: 'nine_slice', width: 8, height: 6, border: { left: 3, right: 3, top: 2, bottom: 2 } } } })
    expect(Array.from({ length: 3 }, (_, x) => pixel(out, x, 0)[0])).toEqual([0, 20, 140])
    expect(pixel(out, 2, 1)).toEqual([140, 150, 0, 255])
  })

  it('при заданной только ширине кадра сохраняет полную высоту и учитывает frames[0]', async () => {
    const src = image(4, 3, (x, y) => [x < 2 ? 40 : 200, y * 40, 0, 255])
    const out = await render(src, 2, 3, { animation: { width: 2, frames: [{ index: 1, time: 3 }, 0] } })
    expect(pixel(out, 0, 0)).toEqual([200, 0, 0, 255])
    expect(pixel(out, 1, 2)).toEqual([200, 80, 0, 255])
  })

  it('нарезает выбранный кадр в двумерном листе анимации', async () => {
    const src = image(8, 8, (x, y) => [Math.floor(x / 4) * 80, Math.floor(y / 4) * 100, 0, 255])
    const out = await render(src, 8, 6, { animation: { width: 4, height: 4, frames: [3, 0] }, gui: { scaling: { type: 'nine_slice', width: 4, height: 4, border: 1 } } })
    expect(pixel(out, 0, 0)).toEqual([80, 100, 0, 255])
    expect(pixel(out, 4, 3)).toEqual([80, 100, 0, 255])
    expect(pixel(out, 7, 5)).toEqual([80, 100, 0, 255])
  })
})

describe('отделённая сетка слотов', () => {
  const slot = image(18, 18, (x, y) => x === 0 || y === 0 || x === 17 || y === 17 ? [180, 150, 30, 255] : [30, 20, 10, 255])

  it.each([1, 4])('восстанавливает отсутствующие слоты и сохраняет фон при масштабе %i (Homestead)', async (scale) => {
    const path = `${T}gui/container/inventory.png`
    const background = image(256 * scale, 256 * scale, (x, y) => [60 + (x + y) % 3, 50, 40, 255])
    const files: Files = new Map([
      ['pack.mcmeta', encode.encode('{"pack":{"pack_format":84,"description":"test"}}')],
      [path, background], [`${T}gui/sprites/container/slot.png`, slot],
    ])
    const out = await buildPack(plan(files), files, nodeImageOps)
    const inventory = decode(out.get(path)!)
    expect(inventory.width).toBe(256 * scale)
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 9; col++) expect(pixel(inventory, (7 + col * 18) * scale, (83 + row * 18) * scale)).toEqual([180, 150, 30, 255])
    expect(pixel(inventory, 4 * scale, 4 * scale)).toEqual(pixel(decode(background), 4 * scale, 4 * scale))
  })

  it('сохраняет готовую сетку с другой палитрой (Whimscape/Mandala)', async () => {
    const path = `${T}gui/container/inventory.png`
    const background = image(256, 256, (x, y) => {
      const grid = x >= 7 && x < 169 && y >= 83 && y < 137
      const edge = grid && ((x - 7) % 18 === 0 || (y - 83) % 18 === 0 || (x - 7) % 18 === 17 || (y - 83) % 18 === 17)
      return edge ? [180, 100, 80, 255] : [60, 50, 40, 255]
    })
    const files: Files = new Map([[path, background], [`${T}gui/sprites/container/slot.png`, slot]])
    const out = await buildPack(plan(files), files, nodeImageOps)
    expect(decode(out.get(path)!).data.equals(decode(background).data)).toBe(true)
  })

  it('не пересоздаёт фон инвентаря, исключённый вручную', () => {
    const path = `${T}gui/container/inventory.png`
    const files: Files = new Map([[path, image(256, 256, () => [60, 50, 40, 255])], [`${T}gui/sprites/container/slot.png`, slot]])
    const p = planPack({ files, index: emptyIndex(), options: DEFAULT_OPTIONS, overrides: { [path]: { exclude: true } } })
    expect(p.entries.some((e) => e.targets.includes(path))).toBe(false)
  })
})
