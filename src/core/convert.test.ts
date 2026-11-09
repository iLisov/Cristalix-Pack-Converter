import { describe, expect, it } from 'vitest'
import { emptyIndex, loadIndex, type ClientIndex } from './client-index'
import { buildPack, planPack, findRoot, type Files, type ImageOps } from './convert'
import { convertBlockstate, convertModel } from './json'
import { RENAMES } from './mappings'
import { resolveTexture } from './textures'
import { EMPTY_LEGACY } from './legacy'
import { DEFAULT_OPTIONS } from './types'

const enc = new TextEncoder()
const png = (tag: string) => enc.encode(`PNG:${tag}`)

const index: ClientIndex = loadIndex({
  generatedAt: 'test',
  textures: [
    'blocks/planks_oak', 'blocks/oak_planks', 'blocks/stone_granite', 'blocks/cherry_planks',
    'blocks/tallgrass', 'items/apple_golden', 'items/oak_boat', 'entity/boat/boat_oak',
    'models/armor/diamond_layer_1', 'models/armor/diamond_layer_2',
  ],
  models: ['block/cube_all', 'block/oak_planks', 'block/cherry_planks'],
  blockstates: {
    stripped_oak_log: { props: { axis: ['x', 'y', 'z'] } },
    oak_stairs: { props: { facing: ['east', 'north', 'south', 'west'], half: ['bottom', 'top'], shape: ['straight'] } },
    cherry_planks: { props: {} },
  },
})

function pack(entries: Record<string, string | Uint8Array>, prefix = ''): Files {
  const files: Files = new Map()
  files.set(prefix + 'pack.mcmeta', enc.encode(JSON.stringify({ pack: { pack_format: 34, description: { text: 'Мой пак' } } })))
  for (const [k, v] of Object.entries(entries)) files.set(prefix + k, typeof v === 'string' ? enc.encode(v) : v)
  return files
}

const T = 'assets/minecraft/textures/'
const plan = (files: Files, opts = {}) => planPack({ files, index, options: { ...DEFAULT_OPTIONS, ...opts } })
const entry = (p: ReturnType<typeof plan>, source: string) => p.entries.find((e) => e.source === source)!

describe('resolveTexture', () => {
  it('переименовывает ванильный блок в старое имя', () => {
    expect(resolveTexture('block/granite', index)).toMatchObject({ targets: ['blocks/stone_granite'], status: 'renamed' })
  })
  it('пишет под обоими именами, если клиент знает оба', () => {
    expect(resolveTexture('block/oak_planks', index).targets).toEqual(['blocks/planks_oak', 'blocks/oak_planks'])
  })
  it('оставляет новое имя, если старого нет', () => {
    expect(resolveTexture('block/cherry_planks', index)).toMatchObject({ targets: ['blocks/cherry_planks'], status: 'same' })
  })
  it('помечает неизвестные текстуры', () => {
    expect(resolveTexture('block/pale_oak_planks', index, EMPTY_LEGACY)).toMatchObject({ targets: ['blocks/pale_oak_planks'], status: 'unknown' })
  })
  it('переносит броню 1.21.2+', () => {
    expect(resolveTexture('entity/equipment/humanoid_leggings/diamond', index).targets).toEqual(['models/armor/diamond_layer_2'])
  })
  it('переименовывает лодки-сущности, но не предметы', () => {
    expect(resolveTexture('entity/boat/oak', index).targets).toEqual(['entity/boat/boat_oak'])
    expect(resolveTexture('item/oak_boat', index).targets).toEqual(['items/oak_boat'])
  })
})

describe('planPack', () => {
  it('находит пак во вложенной папке', () => {
    expect(findRoot(['MyPack/pack.mcmeta', 'MyPack/assets/minecraft/textures/block/stone.png'])).toBe('MyPack/')
  })

  it('не смешивает основной пак с вложенными вариантами customization', () => {
    const files = pack({
      'assets/minecraft/blockstates/oak_stairs.json': '{"variants":{"facing=east,half=bottom,shape=straight":{"model":"block/custom_stairs"}}}',
      'customization/fewer_3d_models/assets/minecraft/blockstates/oak_stairs.json': '{"variants":{"facing=east,half=bottom,shape=straight":{"model":"block/oak_stairs"}}}',
      'customization/older_version/assets/minecraft/models/item/diamond_sword.json': '{"textures":{"layer0":"item/diamond_sword"}}',
      'customization/older_version/pack.mcmeta': '{"pack":{"pack_format":15,"description":"alternate"}}',
    })
    const p = plan(files)
    expect(entry(p, 'customization/fewer_3d_models/assets/minecraft/blockstates/oak_stairs.json').status).toBe('skipped')
    expect(entry(p, 'customization/older_version/pack.mcmeta').status).toBe('skipped')
    expect(p.entries.flatMap((e) => e.targets).some((path) => path.startsWith('customization/'))).toBe(false)
    const main = entry(p, 'assets/minecraft/blockstates/oak_stairs.json')
    expect(JSON.parse((main.transform as {text: string}).text).variants['facing=east,half=bottom,shape=straight'].model).toBe('custom_stairs')
  })

  it.each([
    ['', 'variants/light/'],
    ['', 'optional/old-version/'],
    ['Wrapped Pack/', 'extras/alternate/'],
  ])('исключает вложенный пак независимо от названия: %s%s', (prefix, nested) => {
    const files = pack({
      [`${T}block/granite.png`]: png('main'),
      [`${nested}${T}block/granite.png`]: png('alternate'),
      [`${nested}pack.mcmeta`]: '{"pack":{"pack_format":34,"description":"alternate"}}',
    }, prefix)
    const p = plan(files)
    expect(p.root).toBe(prefix)
    expect(entry(p, `${prefix}${nested}${T}block/granite.png`)).toMatchObject({ status: 'skipped', targets: [] })
    expect(entry(p, `${prefix}${T}block/granite.png`).targets).toContain(`${T}blocks/stone_granite.png`)
    expect(p.entries.flatMap((e) => e.targets).some((path) => path.startsWith(nested))).toBe(false)
  })

  it('пишет pack.mcmeta с pack_format 3 и плоским описанием', () => {
    const p = plan(pack({}))
    expect(p.packFormat).toBe(34)
    const meta = JSON.parse((entry(p, 'pack.mcmeta').transform as { text: string }).text)
    expect(meta).toEqual({ pack: { pack_format: 3, description: 'Мой пак' } })
  })

  it('синоним не перебивает точное имя', () => {
    const p = plan(pack({ [`${T}block/grass.png`]: png('old'), [`${T}block/short_grass.png`]: png('new') }))
    expect(entry(p, `${T}block/short_grass.png`).targets).toEqual([`${T}blocks/tallgrass.png`])
    expect(entry(p, `${T}block/grass.png`).status).toBe('skipped')
  })

  it('анимация следует за текстурой', () => {
    const p = plan(pack({ [`${T}block/granite.png`]: png('g'), [`${T}block/granite.png.mcmeta`]: '{"animation":{}}' }))
    expect(entry(p, `${T}block/granite.png.mcmeta`).targets).toEqual([`${T}blocks/stone_granite.png.mcmeta`])
  })

  it('модель ссылается на текстуру под именем 1.12', () => {
    const p = plan(pack({
      [`${T}block/granite.png`]: png('g'),
      'assets/minecraft/models/block/custom.json': JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/granite' } }),
    }))
    const model = JSON.parse((entry(p, 'assets/minecraft/models/block/custom.json').transform as { text: string }).text)
    expect(model).toEqual({ parent: 'block/cube_all', textures: { all: 'blocks/stone_granite' } })
  })

  it('пропускает папки, которых нет в 1.12', () => {
    const p = plan(pack({ 'assets/minecraft/atlases/blocks.json': '{}', 'assets/minecraft/items/apple.json': '{}' }))
    expect(entry(p, 'assets/minecraft/atlases/blocks.json').status).toBe('skipped')
    expect(entry(p, 'assets/minecraft/items/apple.json').status).toBe('skipped')
  })

  it('без keepUnknown не кладёт неизвестные текстуры', () => {
    const p = plan(pack({ [`${T}block/pale_oak_planks.png`]: png('p') }), { keepUnknown: false })
    expect(entry(p, `${T}block/pale_oak_planks.png`)).toMatchObject({ status: 'skipped', targets: [] })
  })

  it('сохраняет дополнительные текстуры 3D-модели при выключенном keepUnknown', () => {
    const files = pack({
      [`${T}block/acacia_door3d_bottom.png`]: png('door'),
      'assets/minecraft/models/block/acacia_door_3d_bottom.json': '{"textures":{"front":"minecraft:block/acacia_door3d_bottom"}}',
    })
    const p = plan(files, { keepUnknown: false })
    expect(entry(p, `${T}block/acacia_door3d_bottom.png`)).toMatchObject({ status: 'renamed', targets: [`${T}blocks/acacia_door3d_bottom.png`] })
    expect(entry(p, `${T}block/acacia_door3d_bottom.png`).notes.some((n) => n.level === 'warn')).toBe(false)
    expect(JSON.parse((entry(p, 'assets/minecraft/models/block/acacia_door_3d_bottom.json').transform as { text: string }).text).textures.front).toBe('blocks/acacia_door3d_bottom')
  })

  it('применяет пресет и ручные правки', () => {
    const files = pack({ [`${T}block/pale_oak_planks.png`]: png('p'), [`${T}block/granite.png`]: png('g') })
    const p = planPack({
      files,
      index,
      options: DEFAULT_OPTIONS,
      preset: { name: 'test', version: 1, textures: { 'block/pale_oak_planks': ['blocks/simple_block_1'] } },
      overrides: { [`${T}block/granite.png`]: { exclude: true } },
    })
    expect(entry(p, `${T}block/pale_oak_planks.png`)).toMatchObject({ targets: [`${T}blocks/simple_block_1.png`], manual: 'preset' })
    expect(entry(p, `${T}block/granite.png`)).toMatchObject({ status: 'skipped', manual: 'override' })
  })

  it('переносит optifine в mcpatcher и правит matchTiles', () => {
    const p = plan(pack({ 'assets/minecraft/optifine/ctm/granite/granite.properties': 'method=random\nmatchTiles=granite\n' }))
    const e = entry(p, 'assets/minecraft/optifine/ctm/granite/granite.properties')
    expect(e.targets).toEqual(['assets/minecraft/mcpatcher/ctm/granite/granite.properties'])
    expect((e.transform as { text: string }).text).toContain('matchTiles=stone_granite')
  })

  it('переводит lang в .lang', () => {
    const p = plan(pack({ 'assets/minecraft/lang/ru_ru.json': '{"item.minecraft.apple":"Яблоко"}' }))
    const e = entry(p, 'assets/minecraft/lang/ru_ru.json')
    expect(e.targets).toEqual(['assets/minecraft/lang/ru_ru.lang'])
    expect((e.transform as { text: string }).text).toBe('item.minecraft.apple=Яблоко\nitem.apple.name=Яблоко\n')
  })
})

describe('convertBlockstate', () => {
  it('подгоняет свойства под клиент и убирает waterlogged', () => {
    const r = convertBlockstate('oak_stairs', {
      variants: {
        'facing=east,half=bottom,shape=straight,waterlogged=false': { model: 'minecraft:block/oak_stairs' },
        'facing=east,half=bottom,shape=inner_left,waterlogged=false': { model: 'minecraft:block/oak_stairs_inner' },
      },
    }, index.blockstates.oak_stairs)
    expect(JSON.parse(r.text!)).toEqual({ variants: { 'facing=east,half=bottom,shape=straight': { model: 'oak_stairs' } } })
  })
  it('пустой ключ превращает в normal', () => {
    const r = convertBlockstate('cherry_planks', { variants: { '': { model: 'minecraft:block/cherry_planks' } } }, index.blockstates.cherry_planks)
    expect(JSON.parse(r.text!)).toEqual({ variants: { normal: { model: 'cherry_planks' } } })
  })
})

describe('convertModel', () => {
  it('округляет недопустимые углы и убирает поля новых версий', () => {
    const r = convertModel({ gui_light: 'front', elements: [{ rotation: { angle: 30, axis: 'y', origin: [8, 8, 8] } }] }, index, new Map())
    const model = JSON.parse(r.text!)
    expect(model.gui_light).toBeUndefined()
    expect(model.elements[0].rotation.angle).toBe(22.5)
  })
})

describe('buildPack', () => {
  const ops: ImageOps = {
    size: async (d) => {
      const s = new TextDecoder().decode(d)
      const w = s.includes('big') ? 64 : s.includes('PNG:p') ? 64 : s.includes('PNG:k') ? 16 : 16
      return { w, h: w }
    },
    resize: async (_d, w) => enc.encode(`resized:${w}`),
    compose: async (w, h, layers) => enc.encode(`compose:${w}x${h}:${layers.length}`),
  }

  it('уменьшает большие текстуры и склеивает картины', async () => {
    const files = pack({
      [`${T}block/granite.png`]: png('big'),
      [`${T}painting/kebab.png`]: png('k'),
      [`${T}painting/pointer.png`]: png('p'),
    })
    const p = plan(files, { maxResolution: 16 })
    const out = await buildPack(p, files, ops)
    expect(new TextDecoder().decode(out.get(`${T}blocks/stone_granite.png`) as Uint8Array)).toBe('resized:16')
    expect(new TextDecoder().decode(out.get(`${T}painting/paintings_kristoffer_zetterstrand.png`) as Uint8Array)).toBe('compose:256x256:2')
  })
})

describe('mappings', () => {
  it('нет циклов и пустых имён', () => {
    for (const table of [RENAMES.blocks, RENAMES.items]) {
      for (const [n, o] of Object.entries(table)) {
        expect(n).toBeTruthy()
        expect(o).toBeTruthy()
      }
    }
  })
})

describe('новые версии', () => {
  it('понимает min_format/max_format из 1.21.9+', () => {
    const files: Files = new Map([['pack.mcmeta', enc.encode('{"pack":{"min_format":[69,0],"max_format":88,"description":"x"}}')]])
    expect(plan(files).packFormat).toBe(88)
  })

  it('склеивает спрайты GUI в атлас поверх файла пака', () => {
    const legacy = {
      ...EMPTY_LEGACY,
      sprites: { 'gui/sprites/hud/heart/full': [{ atlas: 'gui/icons', x: 52, y: 0, w: 9, h: 9 }] },
      atlasSizes: { 'gui/icons': [256, 256] as [number, number] },
    }
    const files = pack({ [`${T}gui/sprites/hud/heart/full.png`]: png('h'), [`${T}gui/icons.png`]: png('base') })
    const p = planPack({ files, index: emptyIndex(), options: DEFAULT_OPTIONS, legacy })
    const atlas = p.entries.find((e) => e.transform.type === 'compose')!
    expect(atlas.targets).toEqual([`${T}gui/icons.png`])
    expect(atlas.transform).toMatchObject({ base: `${T}gui/icons.png`, parts: [{ x: 52, y: 0, w: 9, h: 9 }] })
    expect(entry(p, `${T}gui/icons.png`).targets).toEqual([])
  })

  it('берёт основу атласа из подключённого клиента', () => {
    const legacy = { ...EMPTY_LEGACY, sprites: { 'gui/sprites/widget/button': [{ atlas: 'gui/widgets', x: 0, y: 66, w: 200, h: 20 }] } }
    const base: Files = new Map([[`${T}gui/widgets.png`, png('base')]])
    const p = planPack({ files: pack({ [`${T}gui/sprites/widget/button.png`]: png('b') }), index: emptyIndex(), options: DEFAULT_OPTIONS, legacy, base })
    expect(p.entries.find((e) => e.transform.type === 'compose')!.transform).toMatchObject({ base: `base:${T}gui/widgets.png` })
  })

  it('пересобирает сундуки и склеивает половины', () => {
    const p = plan(pack({
      [`${T}entity/chest/normal.png`]: png('n'),
      [`${T}entity/chest/normal_left.png`]: png('l'),
      [`${T}entity/chest/normal_right.png`]: png('r'),
    }))
    const single = entry(p, `${T}entity/chest/normal.png`)
    expect(single.transform).toMatchObject({ type: 'compose', size: [64, 64] })
    const double = p.entries.find((e) => e.targets.includes(`${T}entity/chest/normal_double.png`))!
    expect(double.transform).toMatchObject({ type: 'compose', size: [128, 64] })
  })

  it('переименовывает звуковые события и ключи перевода', () => {
    const p = plan(pack({
      'assets/minecraft/sounds.json': '{"entity.enderman.teleport":{"sounds":["mob/endermen/portal"]}}',
      'assets/minecraft/lang/en_us.json': '{"block.minecraft.granite":"Granite"}',
    }))
    expect(JSON.parse((entry(p, 'assets/minecraft/sounds.json').transform as { text: string }).text)).toHaveProperty('entity.endermen.teleport')
    expect((entry(p, 'assets/minecraft/lang/en_us.json').transform as { text: string }).text).toContain('tile.stone.granite.name=Granite')
  })
})

describe('мягкий JSON и спрайты', () => {
  it('читает .mcmeta с мусором после объекта и комментариями', async () => {
    const { parseJson } = await import('./json')
    expect(parseJson('{"a":1, // коммент\n "b":[1,2,],}//010//18')).toEqual({ a: 1, b: [1, 2] })
  })
  it('берёт nine_slice и кадр анимации из .mcmeta спрайта', async () => {
    const { spriteMeta } = await import('./convert')
    const m = enc.encode('{"gui":{"scaling":{"type":"nine_slice","width":80,"height":20,"border":{"left":34,"top":8,"right":34,"bottom":8}}},"animation":{"width":320,"height":80}}//x')
    expect(spriteMeta(m)).toEqual({ slice: { nw: 80, nh: 20, l: 34, t: 8, r: 34, b: 8, stretchInner: false }, anim: { w: 320, h: 80 } })
  })
})

describe('атласы старого формата в паке', () => {
  it('берёт готовый widgets.png из пака как есть и не вклеивает спрайты', () => {
    const legacy = {
      ...EMPTY_LEGACY,
      legacyOnly: ['gui/widgets'],
      sprites: { 'gui/sprites/widget/button': [{ atlas: 'gui/widgets', x: 0, y: 66, w: 200, h: 20 }] },
    }
    const files = pack({ [`${T}gui/sprites/widget/button.png`]: png('b'), [`${T}gui/widgets.png`]: png('legacy') })
    const p = planPack({ files, index: emptyIndex(), options: DEFAULT_OPTIONS, legacy })
    expect(p.entries.some((e) => e.transform.type === 'compose')).toBe(false)
    expect(entry(p, `${T}gui/widgets.png`).targets).toEqual([`${T}gui/widgets.png`])
    expect(entry(p, `${T}gui/sprites/widget/button.png`).status).toBe('skipped')
  })
})

describe('подменённый родитель моделей клиента', () => {
  it('дописывает запасные текстуры, которых нет у стен клиента (Squareful wall_post → packed_sand_wall)', () => {
    const wallIndex = loadIndex({
      generatedAt: 'test', textures: ['blocks/packed_sand'], models: ['block/wall_post', 'block/packed_sand_wall_post'], blockstates: {},
      modelMaterials: { 'block/packed_sand_wall_post': { parent: 'block/wall_post', textures: { wall: 'blocks/packed_sand' } } },
    })
    const post = { textures: { particle: '#wall' }, elements: [
      { from: [4, 0, 4], to: [12, 16, 12], faces: { up: { texture: '#wall_top' }, north: { texture: '#wall' } } },
      { from: [4, 8, 4], to: [12, 16, 12], faces: { north: { texture: '#wall_end' } } },
    ] }
    const files = pack({ 'assets/minecraft/models/block/wall_post.json': JSON.stringify(post) })
    const p = planPack({ files, index: wallIndex, options: DEFAULT_OPTIONS })
    const model = JSON.parse((entry(p, 'assets/minecraft/models/block/wall_post.json').transform as { text: string }).text)
    expect(model.textures).toEqual({ particle: '#wall', wall_top: '#wall', wall_end: '#wall' })
  })
})

describe('иконка предмета и текстура блока', () => {
  it('не кладёт иконку свечи на текстуру блока, а перенаправляет модель предмета клиента', () => {
    const candleIndex = loadIndex({
      generatedAt: 'test', textures: ['blocks/candle'], models: ['item/candle', 'block/candle_one_candle'], blockstates: {},
      modelMaterials: {
        'item/candle': { parent: 'item/generated', textures: { layer0: 'blocks/candle' } },
        'block/candle_one_candle': { parent: 'block/template_candle', textures: { all: 'blocks/candle' } },
      },
    })
    const p = planPack({ files: pack({ [`${T}item/candle.png`]: png('icon') }), index: candleIndex, options: DEFAULT_OPTIONS, legacy: { ...EMPTY_LEGACY, textures: { 'item/candle': ['blocks/candle'] } } })
    expect(entry(p, `${T}item/candle.png`).targets).toEqual([`${T}items/candle.png`])
    const model = p.entries.find((e) => e.targets.includes('assets/minecraft/models/item/candle.json'))!
    expect(JSON.parse((model.transform as { text: string }).text)).toEqual({ parent: 'item/generated', textures: { layer0: 'items/candle' } })
  })
})
