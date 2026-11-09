// Сундуки: с 1.15 модель сундука повёрнута на 180° вокруг оси X относительно 1.12,
// а двойной сундук разделён на две текстуры (_left и _right). Правило проверено
// на ванильных текстурах: одинарный сундук совпадает с 1.12 попиксельно.
import type { ComposePart } from './types'

type Face = 'top' | 'bottom' | 'west' | 'north' | 'east' | 'south'
type Rect = [x: number, y: number, w: number, h: number]

/** Развёртка коробки (u, v) размером w×h×d — как в ModelBox. */
function faces(u: number, v: number, w: number, h: number, d: number): Record<Face, Rect> {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    west: [u, v + d, d, h],
    north: [u + d, v + d, w, h],
    east: [u + d + w, v + d, d, h],
    south: [u + 2 * d + w, v + d, w, h],
  }
}

/** Грань 1.12 ← грань новой версии с преобразованием (поворот на 180° вокруг X). */
const RULE: Record<Face, [Face, flipX: boolean, flipY: boolean]> = {
  top: ['bottom', false, true],
  bottom: ['top', false, true],
  north: ['south', true, true],
  south: ['north', true, true],
  west: ['west', true, true],
  east: ['east', true, true],
}

const SINGLE_BOXES: [number, number, number, number, number][] = [
  [0, 0, 14, 5, 14], // крышка
  [0, 19, 14, 10, 14], // дно
  [0, 0, 2, 4, 1], // защёлка
]
const HALF_BOXES: [number, number, number, number, number][] = [
  [0, 0, 15, 5, 14],
  [0, 19, 15, 10, 14],
  [0, 0, 1, 4, 1],
]

function part(source: string, src: Rect, dx: number, dy: number, flipX: boolean, flipY: boolean): ComposePart {
  return { source, x: dx, y: dy, w: src[2], h: src[3], sx: src[0], sy: src[1], srcW: 64, flipX, flipY }
}

/** Одинарный сундук новой развёртки → 1.12 (64×64). */
export function singleChestParts(source: string): ComposePart[] {
  const parts: ComposePart[] = []
  for (const [u, v, w, h, d] of SINGLE_BOXES) {
    const f = faces(u, v, w, h, d)
    for (const [face, [from, fx, fy]] of Object.entries(RULE) as [Face, (typeof RULE)[Face]][]) {
      parts.push(part(source, f[from], f[face][0], f[face][1], fx, fy))
    }
  }
  return parts
}

/** Две половины (_left, _right) → двойной сундук 1.12 (128×64). */
export function doubleChestParts(left: string, right: string): ComposePart[] {
  const parts: ComposePart[] = []
  for (const [u, v, hw, h, d] of HALF_BOXES) {
    const full = faces(u, v, hw * 2, h, d)
    const half = faces(u, v, hw, h, d)
    for (const [face, [from, fx, fy]] of Object.entries(RULE) as [Face, (typeof RULE)[Face]][]) {
      const [dx, dy] = full[face]
      if (face === 'west') parts.push(part(right, half[from], dx, dy, fx, fy))
      else if (face === 'east') parts.push(part(left, half[from], dx, dy, fx, fy))
      else {
        const [a, b] = face === 'south' ? [left, right] : [right, left]
        parts.push(part(a, half[from], dx, dy, fx, fy))
        parts.push(part(b, half[from], dx + hw, dy, fx, fy))
      }
    }
  }
  return parts
}

export const SINGLE_CHESTS = new Set(['normal', 'trapped', 'christmas', 'ender'])
export const DOUBLE_CHESTS = new Set(['normal', 'trapped', 'christmas'])
