type Json = Record<string, unknown>
type Vec = [number, number, number]
type Axis = 'x' | 'y' | 'z'

const NORMALS: Record<string, Vec> = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }
// Порядок вершин из EnumFaceDirection 1.12; нужен для сохранения BlockFaceUV.
const VERTICES: Record<string, Vec[]> = {
  down: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], up: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  north: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], south: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  west: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], east: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
}

function turn(point: Vec, origin: Vec, axis: Axis, turns: number): Vec {
  let [x, y, z] = point.map((v, i) => v - origin[i])
  for (let n = 0; n < (turns % 4 + 4) % 4; n++) {
    if (axis === 'x') [y, z] = [-z, y]
    else if (axis === 'y') [x, z] = [z, -x]
    else [x, y] = [-y, x]
  }
  return [x, y, z].map((v, i) => Number((v + origin[i]).toFixed(10))) as Vec
}

function defaultUv(face: string, from: Vec, to: Vec): number[] {
  const [x, y, z] = from
  const [X, Y, Z] = to
  switch (face) {
    case 'down': return [x, 16 - Z, X, 16 - z]
    case 'up': return [x, z, X, Z]
    case 'south': return [x, 16 - Y, X, 16 - y]
    case 'west': return [z, 16 - Y, Z, 16 - y]
    case 'east': return [16 - Z, 16 - Y, 16 - z, 16 - y]
    default: return [16 - X, 16 - Y, 16 - x, 16 - y]
  }
}

export function normalizeElementRotation(element: Json): { element: Json; changed: boolean; unsupported?: boolean } {
  const rotation = element.rotation as Json | undefined
  if (!rotation || typeof rotation !== 'object') return { element, changed: false }
  let axis = rotation.axis as Axis | undefined
  let angle = rotation.angle
  const euler = axis === undefined && ['x', 'y', 'z'].some((a) => typeof rotation[a] === 'number')
  if (euler) {
    const axes = (['x', 'y', 'z'] as const).filter((a) => typeof rotation[a] === 'number' && rotation[a] !== 0)
    if (!axes.length) { const out = { ...element }; delete out.rotation; return { element: out, changed: true } }
    if (axes.length > 1) return { element, changed: false, unsupported: true }
    axis = axes[0]
    angle = rotation[axis]
  }
  if (!axis || !['x', 'y', 'z'].includes(axis) || typeof angle !== 'number') return { element, changed: false }
  const turns = Math.abs(angle) <= 45 ? 0 : Math.round(angle / 90)
  const residual = angle - turns * 90
  const origin = rotation.origin as Vec
  if (turns && (rotation.rescale || !Array.isArray(origin) || !Array.isArray(element.from) || !Array.isArray(element.to))) return { element, changed: false, unsupported: true }
  const out: Json = { ...element, rotation: { origin: rotation.origin, axis, angle: residual, ...(rotation.rescale !== undefined ? { rescale: rotation.rescale } : {}) } }
  if (!turns) return { element: euler ? out : element, changed: euler }
  const from = element.from as Vec
  const to = element.to as Vec
  const a = turn(from, origin, axis, turns)
  const b = turn(to, origin, axis, turns)
  out.from = a.map((v, i) => Math.min(v, b[i]))
  out.to = a.map((v, i) => Math.max(v, b[i]))
  const faces: Json = {}
  for (const [direction, raw] of Object.entries((element.faces ?? {}) as Json)) {
    if (!NORMALS[direction]) continue
    const normal = turn(NORMALS[direction], [0, 0, 0], axis, turns)
    const target = Object.keys(NORMALS).find((d) => NORMALS[d].every((v, i) => v === normal[i]))!
    const first = VERTICES[target][0]
    const offset = VERTICES[direction].findIndex((v) => turn(v, [0.5, 0.5, 0.5], axis!, turns).every((n, i) => n === first[i]))
    const face = { ...(raw as Json) }
    face.uv = face.uv ?? defaultUv(direction, from, to)
    face.rotation = (Number(face.rotation ?? 0) + offset * 90) % 360
    faces[target] = face
  }
  out.faces = faces
  return { element: out, changed: true }
}
