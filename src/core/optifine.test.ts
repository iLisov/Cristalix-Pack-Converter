import { describe, expect, it } from 'vitest'
import { loadIndex } from './client-index'
import { convertProperties } from './optifine'

const index = loadIndex()

describe('OptiFine → 1.12', () => {
  it('переводит id блоков CTM в реестр 1.12 и склеивает варианты одного блока', () => {
    const r = convertProperties('matchBlocks=dirt coarse_dirt podzol grass_block red_sand\nmethod=overlay', index)
    expect(r.text).toContain('matchBlocks=dirt:variant=dirt,coarse_dirt,podzol grass sand:variant=red_sand')
    expect(convertProperties('matchBlocks=coarse_dirt podzol', index).text).toContain('matchBlocks=dirt:variant=coarse_dirt,podzol')
    expect(convertProperties('connectBlocks=grass_block\ntintBlock=grass_block', index).text).toBe('connectBlocks=grass\ntintBlock=grass')
  })

  it('убирает блоки, которых нет в клиенте, и отключает правило без блоков', () => {
    expect(convertProperties('matchBlocks=gravel definitely_missing_block', index).text).toBe('matchBlocks=gravel')
    expect(convertProperties('matchBlocks=definitely_missing_block\nmethod=ctm', index).text).toBeNull()
  })

  it('переводит биомы 1.13+ в имена 1.12', () => {
    const r = convertProperties('biomes=snowy_plains snowy_tundra ice_spikes frozen_river cherry_grove', index)
    expect(r.text).toBe('biomes=iceplains iceplainsspikes frozenriver')
    expect(convertProperties('biomes=cherry_grove', index).text).toBeNull()
  })

  it('берёт имена спрайтов matchTiles из плана текстур пака', () => {
    const resolved = new Map([['block/grass', ['blocks/tallgrass']], ['block/grassx', ['blocks/grassx']]])
    expect(convertProperties('matchTiles=grass grassx minecraft:block/grass_block_top', index, { resolved }).text).toBe('matchTiles=tallgrass grassx grass_top')
  })

  it('переводит предметы CIT, metadata и яйца призыва; отключает отсутствующие', () => {
    expect(convertProperties('items=firework_rocket', index).text).toBe('items=fireworks')
    expect(convertProperties('items=red_wool', index).text).toBe('items=wool\ndamage=14')
    expect(convertProperties('items=creeper_spawn_egg', index).text).toBe('items=spawn_egg\nnbt.EntityTag.id=minecraft:creeper')
    expect(convertProperties('items=axolotl_bucket\nmodel=item/x', index).text).toBeNull()
  })

  it('отключает зелья, которых нет в 1.12', () => {
    expect(convertProperties('items=potion\ncomponents.potion_contents.potion=minecraft:turtle_master', index).text).toBeNull()
    expect(convertProperties('items=potion\ncomponents.potion_contents.potion=minecraft:strong_healing', index).text).toContain('nbt.Potion=minecraft:strong_healing')
  })

  it('не трогает id блоков mcpatcher/ старых паков, но биомы переводит в имена OptiFine 1.12', () => {
    expect(convertProperties('matchBlocks=grass\nbiomes=ice_flats IcePlains', index, { modern: false }).text).toBe('matchBlocks=grass\nbiomes=iceplains IcePlains')
  })
})

describe('OptiFine новых версий → OptiFine 1.12: пути и синтаксис', () => {
  it('вложенный тайл пишет полным путём, голое имя оставляет', () => {
    const resolved = new Map([['block/leaves/spruce_leaves', ['blocks/leaves/spruce_leaves']]])
    expect(convertProperties('matchTiles=minecraft:block/leaves/spruce_leaves stone', index, { resolved }).text).toBe('matchTiles=textures/blocks/leaves/spruce_leaves stone')
    expect(convertProperties('tiles=0-3 minecraft:block/leaves/spruce_leaves', index, { resolved }).text).toBe('tiles=0-3 textures/blocks/leaves/spruce_leaves')
  })

  it('переносит пути optifine/ и ~/ в mcpatcher/', () => {
    expect(convertProperties('tiles=optifine/ctm/generic/packed_ice/0.png ~/ctm/x/1.png', index).text).toBe('tiles=mcpatcher/ctm/generic/packed_ice/0.png mcpatcher/ctm/x/1.png')
    expect(convertProperties('texture=optifine/cit/sword.png', index).text).toBe('texture=mcpatcher/cit/sword.png')
  })

  it('заменяет синтаксис, которого нет в старом OptiFine', () => {
    expect(convertProperties('connect=state\nsymmetry=sides\nheights=39..60', index).text).toBe('connect=block\nheights=39-60')
  })

  it('двойная плита — отдельный блок 1.12', () => {
    expect(convertProperties('matchBlocks=minecraft:acacia_slab:type=double', index).text).toBe('matchBlocks=double_wooden_slab:variant=acacia')
    expect(convertProperties('matchBlocks=acacia_slab:type=bottom', index).text).toBe('matchBlocks=wooden_slab:variant=acacia:half=bottom')
  })
})

describe('голое имя тайла без файла в папке', () => {
  it('ссылается на текстуру блока, а существующий файл в папке не трогает', () => {
    const resolved = new Map([['block/spruce_log_top', ['blocks/log_spruce_top']]])
    const r = convertProperties('tiles=0-3 spruce_log_top local <skip>', index, { resolved, hasLocalTile: (name) => name === 'local' })
    expect(r.text).toBe('tiles=0-3 textures/blocks/log_spruce_top local <skip>')
  })
})
