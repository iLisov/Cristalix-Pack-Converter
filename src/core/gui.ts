import raw from '../data/gui-base.json'
import type { Files, Layer } from './convert'
import type { ComposePart } from './types'

const GUI_BASE: Files = new Map(Object.entries(raw).map(([path, encoded]) => [path, Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))]))

export function guiBaseAsset(path: string, base?: Files): Uint8Array | undefined {
  return base?.get(path) ?? GUI_BASE.get(path)
}

// Координаты рамок слотов на текстурах 1.12 (на пиксель левее и выше предмета).
const PLAYER_GRIDS: Record<string, [number, number]> = {
  inventory: [7, 83], crafting_table: [7, 83], furnace: [7, 83], anvil: [7, 83],
  brewing_stand: [7, 83], enchanting_table: [7, 83], dispenser: [7, 83], shulker_box: [7, 83],
  generic_54: [7, 139], hopper: [7, 50], beacon: [35, 136],
}

export function playerSlotGrids(source: string, files: Files, root: string): Map<string, ComposePart[]> {
  const grids = new Map<string, ComposePart[]>()
  for (const [name, [x, y]] of Object.entries(PLAYER_GRIDS)) {
    const atlas = `gui/container/${name}`
    if (!files.has(`${root}assets/minecraft/textures/${atlas}.png`)) continue
    grids.set(atlas, [{ source, x, y, w: 162, h: 54, slotGrid: { cols: 9, rows: 3 } }])
  }
  return grids
}

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)] ?? 0
}

/** Консервативно сохраняем готовую сетку: проверяем повторяющиеся границы внутри неё, вдали от рамки окна. */
export function hasSlotGrid(pixels: ArrayLike<number>, width: number, height: number, cols: number, rows: number): boolean {
  const pixel = (x: number, y: number) => (Math.min(height - 1, Math.floor(y)) * width + Math.min(width - 1, Math.floor(x))) * 4
  const delta = (x1: number, y1: number, x2: number, y2: number) => {
    const a = pixel(x1, y1)
    const b = pixel(x2, y2)
    return Math.max(...[0, 1, 2, 3].map((c) => Math.abs(pixels[a + c] - pixels[b + c])))
  }
  const sx = width / (cols * 18)
  const sy = height / (rows * 18)
  const edges: number[] = []
  const row = Math.floor(rows / 2)
  for (let col = 1; col < cols - 1; col++) {
    const sides: number[][] = [[], [], [], []]
    for (let i = 2; i < 16; i++) {
      const x = col * 18
      const y = row * 18
      sides[0].push(delta((x + i) * sx, y * sy, (x + i) * sx, (y + 1) * sy))
      sides[1].push(delta((x + i) * sx, (y + 16) * sy, (x + i) * sx, (y + 17) * sy))
      sides[2].push(delta(x * sx, (y + i) * sy, (x + 1) * sx, (y + i) * sy))
      sides[3].push(delta((x + 16) * sx, (y + i) * sy, (x + 17) * sx, (y + i) * sy))
    }
    edges.push(Math.max(...sides.map(median)))
  }
  return median(edges) >= 12
}

export function slotGridLayers(layer: Layer): Layer[] {
  const { cols, rows } = layer.slotGrid!
  const layers: Layer[] = []
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const x = Math.round(layer.dx + col * layer.dw / cols)
      const y = Math.round(layer.dy + row * layer.dh / rows)
      layers.push({ ...layer, slotGrid: undefined, dx: x, dy: y,
        dw: Math.round(layer.dx + (col + 1) * layer.dw / cols) - x,
        dh: Math.round(layer.dy + (row + 1) * layer.dh / rows) - y, replace: false })
    }
  return layers
}
