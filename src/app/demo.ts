// Пример пака в формате 1.21: текстуры рисуются кодом, чтобы приложение
// открывалось в рабочем состоянии и показывало все виды преобразований.
import type { Files } from '../core/convert'

type Rgb = [number, number, number]

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const shade = ([r, g, b]: Rgb, k: number): string =>
  `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`

async function draw(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed = 1) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  paint(ctx, rng(seed))
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

const noise = (base: Rgb, spread = 0.25, seed = 1, size = 16) =>
  draw(size, size, (ctx, rnd) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = shade(base, 1 - spread / 2 + rnd() * spread)
        ctx.fillRect(x, y, 1, 1)
      }
  }, seed)

const planks = (base: Rgb, seed: number) =>
  draw(16, 16, (ctx, rnd) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const seam = y % 4 === 3 || (x === ((y >> 2) % 2 ? 4 : 11) && y % 4 !== 3)
        ctx.fillStyle = shade(base, seam ? 0.62 : 0.9 + rnd() * 0.18)
        ctx.fillRect(x, y, 1, 1)
      }
  }, seed)

const sprite = (rows: string[], palette: Record<string, Rgb>) =>
  draw(16, 16, (ctx) => {
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const color = palette[ch]
        if (!color) return
        ctx.fillStyle = shade(color, 1)
        ctx.fillRect(x, y, 1, 1)
      }),
    )
  })

const APPLE = [
  '................', '.......bb.......', '........b.ll....', '.....gggbgg.....',
  '....ggggggggg...', '...gggwgggggg...', '...ggwggggggg...', '...ggggggggggd..',
  '...gggggggggdd..', '...ggggggggddd..', '....gggggggdd...', '....ggggggddd...',
  '.....ggggddd....', '......gddd......', '................', '................',
]

const tuft = (seed: number) =>
  draw(16, 16, (ctx, rnd) => {
    for (let i = 0; i < 9; i++) {
      const x = 2 + Math.floor(rnd() * 12)
      const top = 3 + Math.floor(rnd() * 8)
      for (let y = top; y < 16; y++) {
        ctx.fillStyle = shade([96, 160, 72], 0.75 + (y - top) / 40)
        ctx.fillRect(x + (y < top + 3 ? Math.round(rnd() - 0.5) : 0), y, 1, 1)
      }
    }
  }, seed)

const painting = (w: number, h: number, seed: number, hue: Rgb) =>
  draw(w, h, (ctx, rnd) => {
    ctx.fillStyle = shade(hue, 0.55)
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < (w * h) / 24; i++) {
      ctx.fillStyle = shade(hue, 0.7 + rnd() * 0.6)
      ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 3), 1)
    }
    ctx.strokeStyle = shade([90, 60, 30], 1)
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  }, seed)

const armorLayer = (seed: number) =>
  draw(64, 32, (ctx, rnd) => {
    const regions: [number, number, number, number][] = [[0, 0, 32, 16], [16, 16, 24, 16], [40, 16, 16, 16], [0, 16, 16, 16]]
    for (const [x0, y0, w, h] of regions)
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) {
          ctx.fillStyle = shade([92, 219, 213], 0.75 + rnd() * 0.35)
          ctx.fillRect(x, y, 1, 1)
        }
  }, seed)

const enc = new TextEncoder()
const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 2))

export async function buildDemoPack(): Promise<{ name: string; files: Files }> {
  const T = 'assets/minecraft/textures/'
  const files: Files = new Map()
  const put = (path: string, data: Uint8Array) => files.set(path, data)

  put('pack.mcmeta', json({ pack: { pack_format: 34, description: { text: 'Пример пака 1.21' } } }))
  put('pack.png', await noise([120, 90, 200], 0.4, 7))

  put(`${T}block/granite.png`, await noise([154, 106, 89], 0.35, 2))
  put(`${T}block/polished_andesite.png`, await noise([132, 134, 133], 0.12, 3))
  put(`${T}block/oak_planks.png`, await planks([162, 130, 78], 4))
  put(`${T}block/cherry_planks.png`, await planks([226, 178, 172], 5))
  put(`${T}block/pale_oak_planks.png`, await planks([228, 218, 214], 6))
  put(`${T}block/white_wool.png`, await noise([233, 236, 236], 0.12, 8))
  put(`${T}block/lime_concrete.png`, await noise([94, 168, 24], 0.06, 9))
  put(`${T}block/short_grass.png`, await tuft(10))
  put(`${T}block/stone_bricks.png`, await planks([122, 122, 122], 11))
  put(`${T}block/sea_lantern.png`, await noise([172, 199, 190], 0.3, 12, 16))
  put(`${T}block/sea_lantern.png.mcmeta`, json({ animation: { frametime: 5 } }))

  put(`${T}item/golden_apple.png`, await sprite(APPLE, { b: [100, 60, 20], l: [70, 150, 40], g: [234, 190, 40], w: [255, 248, 200], d: [176, 128, 20] }))
  put(`${T}item/apple.png`, await sprite(APPLE, { b: [100, 60, 20], l: [70, 150, 40], g: [214, 40, 40], w: [255, 190, 190], d: [150, 20, 20] }))
  put(`${T}item/wooden_sword.png`, await noise([150, 110, 60], 0.3, 13))

  const HEART = ['.##.##...', '#rr#rr#..', '#rrrrr#..', '#rrrrr#..', '.#rrr#...', '..#r#....', '...#.....', '.........', '.........']
  put(`${T}gui/sprites/hud/heart/full.png`, await draw(9, 9, (ctx) => {
    HEART.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = ch === '#' ? 'rgb(30,10,40)' : 'rgb(170,60,220)'
      ctx.fillRect(x, y, 1, 1)
    }))
  }))
  put(`${T}gui/sprites/widget/button.png`, await draw(200, 20, (ctx) => {
    ctx.fillStyle = 'rgb(20,20,28)'
    ctx.fillRect(0, 0, 200, 20)
    ctx.fillStyle = 'rgb(40,111,216)'
    ctx.fillRect(1, 1, 198, 18)
    ctx.fillStyle = 'rgb(30,90,180)'
    ctx.fillRect(1, 15, 198, 4)
  }))
  put(`${T}painting/kebab.png`, await painting(16, 16, 20, [200, 120, 60]))
  put(`${T}painting/pool.png`, await painting(32, 16, 21, [60, 140, 210]))
  put(`${T}painting/pointer.png`, await painting(64, 64, 22, [170, 70, 90]))
  put(`${T}entity/equipment/humanoid/diamond.png`, await armorLayer(30))
  put(`${T}entity/boat/oak.png`, await noise([162, 130, 78], 0.2, 31, 32))

  put('assets/minecraft/models/block/granite_pedestal.json', json({
    parent: 'minecraft:block/block',
    gui_light: 'side',
    textures: { particle: 'minecraft:block/granite', side: 'minecraft:block/granite', top: 'minecraft:block/polished_andesite' },
    elements: [
      { from: [2, 0, 2], to: [14, 12, 14], faces: { north: { texture: '#side' }, up: { texture: '#top' } } },
      { from: [4, 12, 4], to: [12, 16, 12], rotation: { angle: 30, axis: 'y', origin: [8, 8, 8] }, faces: { up: { texture: '#top' } } },
    ],
  }))
  put('assets/minecraft/models/item/golden_apple.json', json({ parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/golden_apple' } }))
  put('assets/minecraft/blockstates/oak_stairs.json', json({
    variants: {
      'facing=east,half=bottom,shape=straight,waterlogged=false': { model: 'minecraft:block/oak_stairs' },
      'facing=east,half=bottom,shape=straight,waterlogged=true': { model: 'minecraft:block/oak_stairs' },
      'facing=north,half=bottom,shape=straight,waterlogged=false': { model: 'minecraft:block/oak_stairs', y: 270, uvlock: true },
    },
  }))
  put('assets/minecraft/blockstates/cherry_planks.json', json({ variants: { '': { model: 'minecraft:block/cherry_planks' } } }))
  put('assets/minecraft/atlases/blocks.json', json({ sources: [] }))
  put('assets/minecraft/items/golden_apple.json', json({ model: { type: 'minecraft:model', model: 'minecraft:item/golden_apple' } }))
  put('assets/minecraft/sounds.json', json({ 'entity.enderman.teleport': { sounds: ['mob/endermen/portal'] }, 'block.wool.break': { sounds: ['dig/cloth1'] } }))
  put('assets/minecraft/lang/ru_ru.json', json({ 'item.minecraft.golden_apple': 'Золотое яблоко', 'block.minecraft.oak_planks': 'Дубовые доски', 'menu.singleplayer': 'Одиночная игра' }))
  put('assets/minecraft/optifine/ctm/granite/granite.properties', enc.encode('method=random\nmatchTiles=granite\ntiles=0-3\n'))

  return { name: 'demo-pack-1.21', files }
}
