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
