import { expect, it } from 'vitest'
import { normalizeElementRotation } from './model-rotation'
import { convertModel } from './json'
import { emptyIndex } from './client-index'

type Vec = [number, number, number]
function rotate(v: Vec, origin: Vec, axis: string, angle: number): Vec {
  const p = v.map((n, i) => n - origin[i]) as Vec
  const a = angle * Math.PI / 180
  const c = Math.cos(a), s = Math.sin(a)
  const r = axis === 'x' ? [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]
    : axis === 'y' ? [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]
      : [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]
  return r.map((n, i) => n + origin[i]) as Vec
}
function corners(from: Vec, to: Vec): Vec[] {
  return [from[0], to[0]].flatMap((x) => [from[1], to[1]].flatMap((y) => [from[2], to[2]].map((z) => [x, y, z] as Vec)))
}
const canonical = (vs: Vec[]) => vs.map((v) => v.map((n) => Math.round(n * 1e6) / 1e6).join(',')).sort()

it.each(['x', 'y', 'z'])('сохраняет геометрию Euler ±135° вокруг %s при переносе в axis/angle', (axis) => {
  for (const angle of [-135, 135]) {
    const origin: Vec = [8, 1.5, 8]
    const from: Vec = [2, 0, 3], to: Vec = [6, 3, 12]
    const r = normalizeElementRotation({ from, to, rotation: { x: 0, y: 0, z: 0, [axis]: angle, origin }, faces: { north: { texture: '#front', uv: [1, 2, 7, 8] } } })
    const rotation = r.element.rotation as { axis: string; angle: number }
    expect(rotation.axis).toBe(axis)
    expect([-45, -22.5, 0, 22.5, 45]).toContain(rotation.angle)
    expect(canonical(corners(from, to).map((v) => rotate(v, origin, axis, angle)))).toEqual(canonical(
      corners(r.element.from as Vec, r.element.to as Vec).map((v) => rotate(v, origin, rotation.axis, rotation.angle)),
    ))
  }
})

it('переносит UV и направление грани при запекании половины оборота', () => {
  const r = normalizeElementRotation({ from: [0, 0, 0], to: [16, 3, 16], rotation: { x: 0, y: 135, z: 0, origin: [8, 1.5, 8] },
    faces: { north: { texture: '#front', uv: [1, 2, 7, 8] }, up: { texture: '#top' } } })
  const faces = r.element.faces as Record<string, { uv: number[]; rotation: number; texture: string }>
  expect(faces.south).toMatchObject({ texture: '#front', uv: [1, 2, 7, 8], rotation: 0 })
  expect(faces.up).toMatchObject({ uv: [0, 0, 16, 16], rotation: 180 })
})

it('сохраняет допустимый поворот 45° с rescale', () => {
  const rotation = { angle: 45, axis: 'y', origin: [8, 8, 8], rescale: true }
  const r = convertModel({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], rotation, faces: {} }] }, emptyIndex(), new Map())
  expect(JSON.parse(r.text!).elements[0].rotation).toEqual(rotation)
})
