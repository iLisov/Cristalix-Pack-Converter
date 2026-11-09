import { describe, expect, it } from 'vitest'
import { loadIndex } from './client-index'
import { planPack, type Files } from './convert'
import { convertBlockstate } from './blockstates'
import { convertProperties } from './json'
import { avoidPredicateOrBug } from './blockstates'
import { DEFAULT_OPTIONS, type Plan } from './types'

const enc = new TextEncoder()
const index = loadIndex()
const statePath = (name: string) => `assets/minecraft/blockstates/${name}.json`
function pack(states: Record<string, unknown>, models: Record<string, unknown> = {}): Files {
  const files: Files = new Map([['pack.mcmeta', enc.encode('{"pack":{"pack_format":42,"description":"Squareful regression"}}')]])
  for (const [name, state] of Object.entries(states)) files.set(statePath(name), enc.encode(JSON.stringify(state)))
  for (const [name, model] of Object.entries(models)) files.set(`assets/minecraft/models/${name}.json`, enc.encode(JSON.stringify(model)))
  return files
}
const plan = (files: Files) => planPack({ files, index, options: DEFAULT_OPTIONS })
function jsonAt(p: Plan, target: string) {
  const entry = p.entries.find((e) => e.targets.includes(target))
  expect(entry?.transform.type, target).toBe('text')
  if (entry?.transform.type !== 'text') throw new Error(target)
  return JSON.parse(entry.transform.text)
}

describe('Squareful: состояния клиента 1.12', () => {
  it('разделяет современный слой snow и куб snow_block', () => {
    const p = plan(pack({ snow: { variants: { 'layers=1': { model: 'block/snow_height2' }, 'layers=8': { model: 'block/snow_block' } } },
      snow_block: { variants: { '': { model: 'block/snow_block' } } } }))
    expect(jsonAt(p, statePath('snow')).variants.normal.model).not.toBe('snow_height2')
    expect(jsonAt(p, statePath('snow_layer')).variants['layers=1'].model).toBe('snow_height2')
    expect(Object.keys(jsonAt(p, statePath('snow')).variants)).toEqual(['normal'])
  })
  it('разделяет современное растение grass и куб grass_block в разные блокстейты и модели', () => {
    const p = plan(pack({ grass: { variants: { '': { model: 'block/grass' } } },
      grass_block: { variants: { 'snowy=false': { model: 'block/grass_block' }, 'snowy=true': { model: 'block/grass_block_snow' } } } },
      { 'block/grass': { parent: 'block/cross', textures: { cross: 'block/grass' } } }))
    expect(jsonAt(p, statePath('grass')).variants['snowy=false'].model).toBe('grass_block')
    expect(jsonAt(p, statePath('tall_grass')).variants.normal.model).toBe('tall_grass')
    expect(p.entries.some((e) => e.source.endsWith('/models/block/grass.json') && e.targets.includes('assets/minecraft/models/block/grass.json'))).toBe(false)
    expect(jsonAt(p, 'assets/minecraft/models/block/tall_grass.json').parent).toBe('block/cross')
  })
  it('разделяет нижнюю, верхнюю и двойную плиту без потери поворота', () => {
    const p = plan(pack({ oak_slab: { variants: {
      'type=bottom': { model: 'block/oak_slab' },
      'type=top': { model: 'block/oak_slab', x: 180, uvlock: true },
      'type=double': { model: 'block/double_oak_slab' },
    } } }, { 'block/double_oak_slab': { parent: 'block/cube_all', textures: { all: 'block/oak_planks' } } }))
    expect(jsonAt(p, statePath('oak_slab'))).toEqual({ variants: {
      'half=bottom': { model: 'oak_slab' }, 'half=top': { model: 'oak_slab', x: 180, uvlock: true },
    } })
    expect(jsonAt(p, statePath('oak_double_slab'))).toEqual({ variants: { normal: { model: 'double_oak_slab' } } })
  })

  it('дописывает variant=default для плит бэкпорта', () => {
    const r = convertBlockstate('andesite_slab', { variants: { 'type=bottom': { model: 'block/bottom' }, 'type=top': { model: 'block/top' } } }, index.blockstates.andesite_slab)
    expect(JSON.parse(r.text!)).toEqual({ variants: {
      'half=bottom,variant=default': { model: 'bottom' }, 'half=top,variant=default': { model: 'top' },
    } })
  })

  it('объединяет повреждения наковальни в 12 состояний одного файла', () => {
    const states = Object.fromEntries(['anvil', 'chipped_anvil', 'damaged_anvil'].map((name) => [name, { variants: Object.fromEntries(
      ['north', 'east', 'south', 'west'].map((facing) => [`facing=${facing}`, { model: `block/${name}` }]),
    ) }]))
    const p = plan(pack(states))
    const out = jsonAt(p, statePath('anvil')).variants
    expect(Object.keys(out)).toHaveLength(12)
    expect(out['damage=0,facing=north'].model).toBe('anvil')
    expect(out['damage=1,facing=north'].model).toBe('chipped_anvil')
    expect(out['damage=2,facing=north'].model).toBe('damaged_anvil')
  })

  it('пишет переименованные блоки под именами StateMapper клиента', () => {
    const p = plan(pack({ oak_door: { variants: { 'facing=north,half=lower,hinge=left,open=false': { model: 'block/my_door' } } },
      grass_block: { variants: { 'snowy=false': { model: 'block/grass_block0' }, 'snowy=true': { model: 'block/grass_block_snow' } } } },
      { 'block/my_door': { elements: [] }, 'block/grass_block0': { parent: 'block/grass_block', textures: { side: 'block/stone' } } }))
    expect(jsonAt(p, statePath('wooden_door')).variants['facing=north,half=lower,hinge=left,open=false'].model).toBe('my_door')
    expect(jsonAt(p, statePath('grass')).variants['snowy=false'].model).toBe('grass_block0')
    expect(p.entries.some((e) => e.targets.includes(statePath('oak_door')))).toBe(false)
  })

  it('переводит низкую стену в boolean и не накладывает высокую геометрию поверх', () => {
    const r = convertBlockstate('andesite_wall', { multipart: [
      { when: { north: 'low' }, apply: { model: 'block/side_low' } },
      { when: { north: 'tall' }, apply: { model: 'block/side_tall' } },
      { when: { north: 'none' }, apply: { model: 'block/no_side' } },
    ] }, index.blockstates.andesite_wall)
    expect(JSON.parse(r.text!)).toEqual({ multipart: [
      { when: { north: 'true' }, apply: { model: 'side_low' } }, { when: { north: 'false' }, apply: { model: 'no_side' } },
    ] })
  })

  it('не превращает все недоступные условия в безусловные слои', () => {
    const r = convertBlockstate('note_block', { multipart: [
      { when: { powered: 'false' }, apply: { model: 'block/base' } },
      { when: { powered: 'true' }, apply: { model: 'block/on' } },
      { when: { instrument: 'harp' }, apply: { model: 'block/harp' } },
      { when: { instrument: 'flute' }, apply: { model: 'block/flute' } },
    ] }, index.blockstates.noteblock)
    expect(JSON.parse(r.text!).multipart).toEqual([{ apply: { model: 'base' } }, { apply: { model: 'harp' } }])
  })

  it('переводит стороны гриба в старые variant и добавляет ствол в тот же блок', () => {
    const p = plan(pack({ brown_mushroom_block: { multipart: [{ when: { up: 'true' }, apply: { model: 'block/cap' } }] },
      mushroom_stem: { multipart: [{ when: { up: 'false' }, apply: { model: 'block/stem' } }] } }))
    const parts = jsonAt(p, statePath('brown_mushroom_block')).multipart
    expect(jsonAt(p, statePath('brown_mushroom_block')).variants['variant=all_outside']).toEqual(index.blockstates.brown_mushroom_block.defaultVariants!['variant=all_outside'])
    expect(JSON.stringify(parts)).not.toContain('"up"')
    expect(parts.every((part: { when: { variant: string } }) => !part.when.variant.includes('|'))).toBe(true)
    expect(parts.at(-1)).toEqual({ when: { variant: 'stem' }, apply: { model: 'stem' } })
    expect(parts.filter((part: { apply: { model: string } }) => part.apply.model === 'cap').length).toBeGreaterThan(1)
  })

  it('сохраняет уже старую наковальню и варианты гриба', () => {
    const p = plan(pack({ anvil: { variants: { 'damage=2,facing=north': { model: 'block/old_anvil' } } },
      brown_mushroom_block: { variants: { 'variant=stem': { model: 'block/old_stem' } } } },
      { 'block/old_anvil': { elements: [] }, 'block/old_stem': { elements: [] } }))
    expect(jsonAt(p, statePath('anvil')).variants['damage=2,facing=north'].model).toBe('old_anvil')
    expect(jsonAt(p, statePath('brown_mushroom_block')).variants['variant=stem'].model).toBe('old_stem')
  })

  it('выбирает waterlogged=false независимо от порядка исходных вариантов', () => {
    const r = convertBlockstate('oak_planks', { variants: {
      'waterlogged=true': { model: 'block/wet' }, 'waterlogged=false': { model: 'block/dry' },
    } }, index.blockstates.oak_planks)
    expect(JSON.parse(r.text!)).toEqual({ variants: { normal: { model: 'dry' } } })
  })

  it('не запекает слой с номером мощности редстоуна, игнорируемой StateMapper', () => {
    const r = convertBlockstate('redstone_wire', { multipart: [
      { when: { north: 'side|up', east: 'none' }, apply: { model: 'block/wire' } },
      { when: { power: '0' }, apply: { model: 'block/redstone_dust_p00' } },
    ] }, index.blockstates.redstone_wire)
    expect(JSON.parse(r.text!)).toEqual({ multipart: [{ when: { north: 'side|up', east: 'none' }, apply: { model: 'wire' } }] })
  })
})

describe('Squareful: CIT 1.12', () => {
  it('переводит зачарования в числовые ID реестра 1.12 и не оставляет неизвестное условие', () => {
    expect(convertProperties('enchantmentIDs=fire_aspect sweeping_edge', index).text).toBe('enchantmentIDs=20 22')
    expect(convertProperties('items=diamond_pickaxe\nenchantments=fortune', index).text).toBe('items=diamond_pickaxe\nenchantmentIDs=35')
    expect(convertProperties('items=enchanted_book\nenchantmentIDs=breach', index).text).toBeNull()
  })

  it('размещает модель и её PNG рядом с правилом CIT и связывает их относительными путями', () => {
    const files = pack({}, { 'item/book_custom': { parent: 'item/generated', textures: { layer0: 'item/book_custom' } } })
    files.set('assets/minecraft/textures/item/book_custom.png', new Uint8Array([1, 2, 3]))
    files.set('assets/minecraft/optifine/cit/books/custom.properties', enc.encode('items=enchanted_book\nmodel=minecraft:item/book_custom'))
    const p = plan(files)
    const rule = p.entries.find((e) => e.targets.includes('assets/minecraft/mcpatcher/cit/books/custom.properties'))!
    const ref = /^model=(.+)$/m.exec((rule.transform as {text: string}).text)![1]
    expect(ref).toBe('custom.json')
    expect((rule.transform as {text: string}).text).toMatch(/^texture=custom$/m)
    const model = jsonAt(p, 'assets/minecraft/mcpatcher/cit/books/' + ref)
    expect(model.textures.layer0.startsWith('minecraft:__converter/cit/')).toBe(true)
    expect(p.entries.some((e) => e.targets.includes('assets/minecraft/textures/' + model.textures.layer0.replace('minecraft:', '') + '.png'))).toBe(true)
    expect(p.entries.some((e) => e.targets.includes('assets/minecraft/mcpatcher/cit/books/custom.png'))).toBe(true)
  })

  it('сохраняет JSON зелья и оба слоя, добавляет явные текстуры для CIT 1.12', () => {
    const files = pack({}, { 'item/potion_custom': { parent: 'item/generated', textures: { layer0: 'item/overlay_custom', layer1: 'item/bottle_custom' } } })
    for (const name of ['overlay_custom', 'bottle_custom']) files.set(`assets/minecraft/textures/item/${name}.png`, new Uint8Array([1, 2, 3]))
    files.set('assets/minecraft/optifine/cit/potion/custom.properties', enc.encode('items=potion\nmodel=item/potion_custom\ncomponents.potion_contents.potion=minecraft:strength'))
    const p = plan(files)
    const rule = p.entries.find((e) => e.targets.includes('assets/minecraft/mcpatcher/cit/potion/custom.properties'))!
    const text = (rule.transform as {text: string}).text
    expect(text).toContain('nbt.Potion=minecraft:strength')
    expect(text).toMatch(/^model=custom.json$/m)
    expect(text).toMatch(/^texture.potion_overlay=custom_layer0$/m)
    expect(text).toMatch(/^texture.potion_bottle_drinkable=custom_layer1$/m)
    const ref = /^model=(.+)$/m.exec(text)![1]
    const model = jsonAt(p, 'assets/minecraft/mcpatcher/cit/potion/' + ref)
    expect(model.parent).toBe('item/generated')
    expect(Object.keys(model.textures)).toEqual(['layer0', 'layer1'])
  })

  it('разрешает унаследованные текстуры CIT, сохраняя родителя с геометрией', () => {
    const files = pack({}, { 'item/custom_parent': { parent: 'item/generated', textures: { layer0: 'item/inherited_custom' }, elements: [{ from: [0, 0, 0], to: [16, 16, 1], faces: { north: { texture: '#layer0' } } }] },
      'item/custom_child': { parent: 'item/custom_parent' } })
    files.set('assets/minecraft/textures/item/inherited_custom.png', new Uint8Array([1, 2, 3]))
    files.set('assets/minecraft/optifine/cit/inherit.properties', enc.encode('items=enchanted_book\nmodel=item/custom_child'))
    const p = plan(files)
    const rule = p.entries.find((e) => e.targets.includes('assets/minecraft/mcpatcher/cit/inherit.properties'))!
    const ref = /^model=(.+)$/m.exec((rule.transform as {text: string}).text)![1]
    const model = jsonAt(p, 'assets/minecraft/mcpatcher/cit/' + ref)
    expect(model.parent).toBe('item/custom_parent')
    expect(model.textures.layer0).toMatch(/^minecraft:__converter\/cit\//)
    expect(jsonAt(p, 'assets/minecraft/models/item/custom_parent.json').elements[0].to).toEqual([16, 16, 1])
  })

  it('сохраняет model в папке models/item, не переносит его в textures/items', () => {
    const result = convertProperties('items=enchanted_book\nmodel=minecraft:item/enchanted_book/fire_aspect_max\nenchantmentIDs=fire_aspect\nenchantmentLevels=2', index)
    expect(result.text).toContain('model=item/enchanted_book/fire_aspect_max')
    expect(result.text).not.toContain('model=items/')
  })

  it('переводит поддерживаемые компоненты в NBT, отключает неподдерживаемое условие', () => {
    expect(convertProperties('items=name_tag\ncomponents.custom_name=iregex:.*johnny.*', index).text).toContain('nbt.display.Name=iregex:.*johnny.*')
    expect(convertProperties('items=potion\ncomponents.potion_contents.potion=minecraft:strength', index).text).toContain('nbt.Potion=minecraft:strength')
    expect(convertProperties('items=diamond_sword\ncomponents.unknown=5\nmodel=item/wrong', index).text).toBeNull()
  })

  it('конвертирует ссылки в JSON моделей внутри optifine/cit', () => {
    const files = pack({})
    files.set('assets/minecraft/optifine/cit/example/custom.json', enc.encode('{"parent":"item/generated","textures":{"layer0":"minecraft:item/redstone"}}'))
    const p = plan(files)
    expect(jsonAt(p, 'assets/minecraft/mcpatcher/cit/example/custom.json').textures.layer0).toBe('items/redstone_dust')
  })

  it('отключает CIT с отсутствующей моделью и сохраняет правило с существующей', () => {
    const files = pack({}, { 'item/enchanted_book/custom': { parent: 'item/generated', textures: { layer0: 'item/enchanted_book' } } })
    files.set('assets/minecraft/optifine/cit/good.properties', enc.encode('items=enchanted_book\nmodel=minecraft:item/enchanted_book/custom'))
    files.set('assets/minecraft/optifine/cit/bad.properties', enc.encode('items=enchanted_book\nmodel=minecraft:item/enchanted_book/missing'))
    const p = plan(files)
    expect(p.entries.find((e) => e.source.endsWith('/bad.properties'))?.status).toBe('skipped')
    expect(p.entries.find((e) => e.source.endsWith('/good.properties'))?.targets).toEqual(['assets/minecraft/mcpatcher/cit/good.properties'])
    expect(jsonAt(p, 'assets/minecraft/models/item/enchanted_book/custom.json').textures.layer0).toBe('minecraft:items/book_enchanted')
  })
})

describe('Squareful: замыкание зависимостей моделей', () => {
  it('сопоставляет отсутствующие новые модели плит с готовым блокстейтом клиента', () => {
    const p = plan(pack({ cyan_wool_slab: { variants: { 'type=bottom': { model: 'block/cyan_wool_slab' } } } }))
    expect(jsonAt(p, statePath('cyan_wool_slab')).variants['half=bottom,variant=default'].model).toBe('half_slab_cyan_wool')
  })

  it('не оставляет люк с отсутствующим родителем, использует готовый вариант того же состояния', () => {
    const p = plan(pack({ crimson_trapdoor: { variants: { 'facing=north,half=top,open=false': { model: 'block/custom_broken_trapdoor' } } } },
      { 'block/custom_broken_trapdoor': { parent: 'block/nonexistent_trapdoor_parent' } }))
    expect(jsonAt(p, statePath('crimson_trapdoor')).variants['facing=north,half=top,open=false'].model).toBe('crimson_trapdoor_top')
  })

  it('добавляет известное старое имя модели и сохраняет исходное для внутренних ссылок', () => {
    const p = plan(pack({}, { 'block/grass_block': { parent: 'block/cube_all', textures: { all: 'block/stone' } } }))
    expect(jsonAt(p, 'assets/minecraft/models/block/grass.json').parent).toBe('block/cube_all')
    expect(jsonAt(p, 'assets/minecraft/models/block/grass_block.json').parent).toBe('block/cube_all')
  })

  it('переносит ClientItem в models/item 1.12 и не оставляет папку items', () => {
    const files = pack({}, { 'block/custom_repeater': { parent: 'block/cube_all', textures: { all: 'block/stone' } } })
    files.set('assets/minecraft/items/repeater.json', enc.encode('{"model":{"type":"minecraft:model","model":"minecraft:block/custom_repeater"}}'))
    const p = plan(files)
    expect(jsonAt(p, 'assets/minecraft/models/item/repeater.json')).toEqual({ parent: 'block/custom_repeater' })
    expect(p.entries.some((e) => e.targets.includes('assets/minecraft/items/repeater.json'))).toBe(false)
  })

  it('не заменяет существующую совместимую модель описанием ClientItem', () => {
    const files = pack({}, { 'item/repeater': { parent: 'item/generated', textures: { layer0: 'item/repeater' } }, 'block/custom_repeater': { elements: [] } })
    files.set('assets/minecraft/items/repeater.json', enc.encode('{"model":{"type":"minecraft:model","model":"minecraft:block/custom_repeater"}}'))
    expect(jsonAt(plan(files), 'assets/minecraft/models/item/repeater.json').parent).toBe('item/generated')
  })

  it('добавляет отсутствующие ванильные родители без замены своей модели', () => {
    const p = plan(pack({}, { 'block/grass_block0': { parent: 'block/grass_block', textures: { side: 'block/my_side' } } }))
    expect(jsonAt(p, 'assets/minecraft/models/block/grass_block.json').elements.length).toBeGreaterThan(0)
    expect(jsonAt(p, 'assets/minecraft/models/block/grass_block0.json')).toEqual({ parent: 'block/grass_block', textures: { side: 'blocks/my_side' } })
    const own = plan(pack({}, { 'block/grass_block': { textures: { particle: 'block/stone' }, elements: [] }, 'block/child': { parent: 'block/grass_block' } }))
    expect(jsonAt(own, 'assets/minecraft/models/block/grass_block.json').elements).toEqual([])
  })

  it('добавляет недостающую ванильную текстуру, на которую ссылается модель', () => {
    const p = plan(pack({}, { 'block/compost': { parent: 'block/cube_all', textures: { all: 'block/composter_compost' } } }))
    expect(p.entries.find((e) => e.targets.includes('assets/minecraft/textures/blocks/composter_compost.png'))?.transform.type).toBe('bytes')
  })
})

describe('деление частей multipart по значениям условия', () => {
  it('делит части по одному значению в условии', () => {
    const r = avoidPredicateOrBug([{ when: { variant: 'a|b', up: 'true' }, apply: { model: 'm' } }])
    expect(r.parts).toEqual([
      { when: { variant: 'a', up: 'true' }, apply: { model: 'm' } },
      { when: { variant: 'b', up: 'true' }, apply: { model: 'm' } },
    ])
    expect(avoidPredicateOrBug([{ when: { variant: 'a' }, apply: { model: 'm' } }]).changed).toBe(false)
  })

  it('переворачивает отрицание по свойствам блока', () => {
    const r = avoidPredicateOrBug([{ when: { v: '!x' }, apply: { model: 'm' } }], { v: ['a', 'b', 'x'] })
    expect(r.parts.map((p) => (p as { when: unknown }).when)).toEqual([{ v: 'a' }, { v: 'b' }])
  })
})
