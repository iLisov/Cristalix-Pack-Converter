// OptiFine 1.12 ищет блоки, предметы и биомы по реестру до 1.13: правило с новым id молча не срабатывает.

import type { ClientIndex } from './client-index'
import type { JsonResult } from './json'
import { COLORS, oldColor, RENAMES, WOODS } from './mappings'
import type { Note } from './types'

const warn = (text: string): Note => ({ level: 'warn', text })
const info = (text: string): Note => ({ level: 'info', text })

/** Блок 1.12 в нотации OptiFine: id и свойства, которые выделяют нужное состояние. */
interface OldBlock { id: string; props?: Record<string, string> }
/** Предмет 1.12: id и metadata (damage), если предмет различается по ней. */
interface OldItem { id: string; damage?: number; nbt?: Record<string, string> }

function buildTables() {
  const blocks: Record<string, OldBlock> = {}
  const items: Record<string, OldItem> = {}
  // у предмета damage = metadata состояния блока
  const addBlockItem = (name: string, id: string, props?: Record<string, string>, damage?: number) => {
    blocks[name] = { id, props }
    items[name] = { id, damage }
  }

  COLORS.forEach((color, meta) => {
    const colorProp = { color: oldColor(color) }
    addBlockItem(`${color}_wool`, 'wool', colorProp, meta)
    addBlockItem(`${color}_carpet`, 'carpet', colorProp, meta)
    addBlockItem(`${color}_stained_glass`, 'stained_glass', colorProp, meta)
    addBlockItem(`${color}_stained_glass_pane`, 'stained_glass_pane', colorProp, meta)
    addBlockItem(`${color}_terracotta`, 'stained_hardened_clay', colorProp, meta)
    addBlockItem(`${color}_concrete`, 'concrete', colorProp, meta)
    addBlockItem(`${color}_concrete_powder`, 'concrete_powder', colorProp, meta)
    addBlockItem(`${color}_glazed_terracotta`, `${oldColor(color)}_glazed_terracotta`)
    addBlockItem(`${color}_shulker_box`, `${oldColor(color)}_shulker_box`)
    blocks[`${color}_bed`] = { id: 'bed' }
    items[`${color}_bed`] = { id: 'bed', damage: meta }
    blocks[`${color}_banner`] = { id: 'standing_banner' }
    blocks[`${color}_wall_banner`] = { id: 'wall_banner' }
    items[`${color}_banner`] = { id: 'banner', damage: 15 - meta }
    items[`${color}_dye`] = { id: 'dye', damage: 15 - meta }
  })
  Object.assign(items, {
    ink_sac: { id: 'dye', damage: 0 }, rose_red: { id: 'dye', damage: 1 }, cactus_green: { id: 'dye', damage: 2 },
    cocoa_beans: { id: 'dye', damage: 3 }, lapis_lazuli: { id: 'dye', damage: 4 }, dandelion_yellow: { id: 'dye', damage: 11 },
    bone_meal: { id: 'dye', damage: 15 },
  })

  Object.keys(WOODS).forEach((wood, meta) => {
    const variant = { variant: wood }
    addBlockItem(`${wood}_planks`, 'planks', variant, meta)
    addBlockItem(`${wood}_sapling`, 'sapling', { type: wood }, meta)
    addBlockItem(`${wood}_slab`, 'wooden_slab', variant, meta)
    const second = meta >= 4
    addBlockItem(`${wood}_log`, second ? 'log2' : 'log', variant, meta % 4)
    addBlockItem(`${wood}_wood`, second ? 'log2' : 'log', { variant: wood, axis: 'none' }, meta % 4)
    addBlockItem(`${wood}_leaves`, second ? 'leaves2' : 'leaves', variant, meta % 4)
    if (wood !== 'oak') {
      addBlockItem(`${wood}_fence`, `${wood}_fence`)
      addBlockItem(`${wood}_fence_gate`, `${wood}_fence_gate`)
      blocks[`${wood}_door`] = { id: `${wood}_door` }
      items[`${wood}_door`] = { id: `${wood}_door` }
      items[`${wood}_boat`] = { id: `${wood}_boat` }
    }
  })
  addBlockItem('oak_fence', 'fence')
  addBlockItem('oak_fence_gate', 'fence_gate')
  addBlockItem('oak_trapdoor', 'trapdoor')
  addBlockItem('oak_pressure_plate', 'wooden_pressure_plate')
  addBlockItem('oak_button', 'wooden_button')
  blocks.oak_door = { id: 'wooden_door' }
  items.oak_door = { id: 'wooden_door' }
  items.oak_boat = { id: 'boat' }
  blocks.oak_sign = { id: 'standing_sign' }
  blocks.oak_wall_sign = { id: 'wall_sign' }
  items.oak_sign = { id: 'sign' }
  items.sign = { id: 'sign' }

  const addVariants = (id: string, list: Record<string, string>, prop = 'variant') =>
    Object.entries(list).forEach(([name, value], meta) => addBlockItem(name, id, { [prop]: value }, meta))
  addVariants('stone', { stone: 'stone', granite: 'granite', polished_granite: 'smooth_granite', diorite: 'diorite',
    polished_diorite: 'smooth_diorite', andesite: 'andesite', polished_andesite: 'smooth_andesite' })
  addVariants('dirt', { dirt: 'dirt', coarse_dirt: 'coarse_dirt', podzol: 'podzol' })
  addVariants('sand', { sand: 'sand', red_sand: 'red_sand' })
  addVariants('sandstone', { sandstone: 'sandstone', chiseled_sandstone: 'chiseled_sandstone', cut_sandstone: 'smooth_sandstone' }, 'type')
  addVariants('red_sandstone', { red_sandstone: 'red_sandstone', chiseled_red_sandstone: 'chiseled_red_sandstone', cut_red_sandstone: 'smooth_red_sandstone' }, 'type')
  addVariants('stonebrick', { stone_bricks: 'stonebrick', mossy_stone_bricks: 'mossy_stonebrick', cracked_stone_bricks: 'cracked_stonebrick', chiseled_stone_bricks: 'chiseled_stonebrick' })
  addVariants('prismarine', { prismarine: 'prismarine', prismarine_bricks: 'prismarine_bricks', dark_prismarine: 'dark_prismarine' })
  addVariants('quartz_block', { quartz_block: 'default', chiseled_quartz_block: 'chiseled', quartz_pillar: 'lines_y' })
  addVariants('sponge', { sponge: 'false', wet_sponge: 'true' }, 'wet')
  addVariants('red_flower', { poppy: 'poppy', blue_orchid: 'blue_orchid', allium: 'allium', azure_bluet: 'houstonia', red_tulip: 'red_tulip',
    orange_tulip: 'orange_tulip', white_tulip: 'white_tulip', pink_tulip: 'pink_tulip', oxeye_daisy: 'oxeye_daisy' }, 'type')
  addVariants('double_plant', { sunflower: 'sunflower', lilac: 'syringa', tall_grass: 'double_grass', large_fern: 'double_fern', rose_bush: 'double_rose', peony: 'paeonia' })
  addVariants('monster_egg', { infested_stone: 'stone', infested_cobblestone: 'cobblestone', infested_stone_bricks: 'stone_brick',
    infested_mossy_stone_bricks: 'mossy_brick', infested_cracked_stone_bricks: 'cracked_brick', infested_chiseled_stone_bricks: 'chiseled_brick' })
  addVariants('cobblestone_wall', { cobblestone_wall: 'normal', mossy_cobblestone_wall: 'mossy_cobblestone' })
  addVariants('anvil', { anvil: '0', chipped_anvil: '1', damaged_anvil: '2' }, 'damage')
  // stone_slab в 1.14+ — новая плита из камня; ближе всего в 1.12 гладкая
  addVariants('stone_slab', { smooth_stone_slab: 'stone', sandstone_slab: 'sand', petrified_oak_slab: 'wood_old', cobblestone_slab: 'cobblestone',
    brick_slab: 'brick', stone_brick_slab: 'smooth_brick', nether_brick_slab: 'nether_brick', quartz_slab: 'quartz' })
  addBlockItem('stone_slab', 'stone_slab', { variant: 'stone' }, 0)
  addBlockItem('red_sandstone_slab', 'stone_slab2', { variant: 'red_sandstone' }, 0)
  addBlockItem('dead_bush', 'deadbush')
  addBlockItem('short_grass', 'tallgrass', { type: 'tall_grass' }, 1)
  addBlockItem('grass', 'tallgrass', { type: 'tall_grass' }, 1)
  addBlockItem('fern', 'tallgrass', { type: 'fern' }, 2)
  addBlockItem('dandelion', 'yellow_flower')
  addBlockItem('mushroom_stem', 'brown_mushroom_block', { variant: 'stem' }, 0)

  const skulls = ['skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head']
  skulls.forEach((name, meta) => {
    blocks[name] = { id: 'skull' }
    blocks[name.replace(/_(skull|head)$/, '_wall_$1')] = { id: 'skull' }
    items[name] = { id: 'skull', damage: meta }
  })

  const renames: Record<string, string> = {
    grass_block: 'grass', dirt_path: 'grass_path', bricks: 'brick_block', nether_bricks: 'nether_brick', red_nether_bricks: 'red_nether_brick',
    end_stone_bricks: 'end_bricks', magma_block: 'magma', melon: 'melon_block', slime_block: 'slime', snow_block: 'snow', snow: 'snow_layer',
    spawner: 'mob_spawner', sugar_cane: 'reeds', lily_pad: 'waterlily', cobweb: 'web', terracotta: 'hardened_clay', carved_pumpkin: 'pumpkin',
    jack_o_lantern: 'lit_pumpkin', nether_quartz_ore: 'quartz_ore', note_block: 'noteblock', powered_rail: 'golden_rail',
    nether_portal: 'portal', moving_piston: 'piston_extension', wall_torch: 'torch', redstone_wall_torch: 'redstone_torch',
    repeater: 'unpowered_repeater', comparator: 'unpowered_comparator', attached_melon_stem: 'melon_stem', attached_pumpkin_stem: 'pumpkin_stem',
    smooth_stone: 'double_stone_slab', shulker_box: 'purple_shulker_box',
  }
  for (const [name, id] of Object.entries(renames)) addBlockItem(name, id)
  blocks.smooth_stone = { id: 'double_stone_slab', props: { seamless: 'true', variant: 'stone' } }
  items.repeater = { id: 'repeater' }
  items.comparator = { id: 'comparator' }
  items.sugar_cane = { id: 'reeds' }
  for (const plant of ['oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'fern', 'dead_bush',
    'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
    'red_mushroom', 'brown_mushroom', 'cactus']) blocks[`potted_${plant}`] = { id: 'flower_pot' }

  Object.assign(items, {
    firework_rocket: { id: 'fireworks' }, firework_star: { id: 'firework_charge' }, glistering_melon_slice: { id: 'speckled_melon' },
    melon_slice: { id: 'melon' }, popped_chorus_fruit: { id: 'chorus_fruit_popped' }, nether_brick: { id: 'netherbrick' },
    experience_bottle: { id: 'experience_bottle' }, cod: { id: 'fish', damage: 0 }, salmon: { id: 'fish', damage: 1 },
    tropical_fish: { id: 'fish', damage: 2 }, pufferfish: { id: 'fish', damage: 3 }, cooked_cod: { id: 'cooked_fish', damage: 0 },
    cooked_salmon: { id: 'cooked_fish', damage: 1 }, charcoal: { id: 'coal', damage: 1 }, enchanted_golden_apple: { id: 'golden_apple', damage: 1 },
    golden_apple: { id: 'golden_apple', damage: 0 }, coal: { id: 'coal', damage: 0 }, snowball: { id: 'snowball' },
    clock: { id: 'clock' }, map: { id: 'map' }, filled_map: { id: 'filled_map' }, zombified_piglin_spawn_egg: { id: 'spawn_egg', nbt: { 'EntityTag.id': 'minecraft:zombie_pigman' } },
  })
  for (const disc of ['13', 'cat', 'blocks', 'chirp', 'far', 'mall', 'mellohi', 'stal', 'strad', 'ward', '11', 'wait']) items[`music_disc_${disc}`] = { id: `record_${disc}` }
  return { blocks, items }
}

const TABLES = buildTables()

/** Яйца призыва 1.12: один предмет spawn_egg, моб задаётся NBT EntityTag.id. */
const SPAWN_EGGS = new Set(['bat', 'blaze', 'cave_spider', 'chicken', 'cow', 'creeper', 'donkey', 'elder_guardian', 'enderman', 'endermite',
  'evoker', 'ghast', 'guardian', 'horse', 'husk', 'llama', 'magma_cube', 'mooshroom', 'mule', 'ocelot', 'parrot', 'pig', 'polar_bear',
  'rabbit', 'sheep', 'shulker', 'silverfish', 'skeleton', 'skeleton_horse', 'slime', 'spider', 'squid', 'stray', 'vex', 'villager',
  'vindicator', 'witch', 'wither_skeleton', 'wolf', 'zombie', 'zombie_horse', 'zombie_villager'])

/** Зелья, которые есть в реестре 1.12. */
const POTIONS = new Set(['water', 'mundane', 'thick', 'awkward', 'night_vision', 'long_night_vision', 'invisibility', 'long_invisibility',
  'leaping', 'long_leaping', 'strong_leaping', 'fire_resistance', 'long_fire_resistance', 'swiftness', 'long_swiftness', 'strong_swiftness',
  'slowness', 'long_slowness', 'water_breathing', 'long_water_breathing', 'healing', 'strong_healing', 'harming', 'strong_harming',
  'poison', 'long_poison', 'strong_poison', 'regeneration', 'long_regeneration', 'strong_regeneration', 'strength', 'long_strength',
  'strong_strength', 'weakness', 'long_weakness', 'luck', 'empty'])

/** Предметы 1.12, у которых модель называется иначе, чем id: по models их не найти. */
const ITEMS_1_12 = new Set(['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow', 'spawn_egg', 'compass', 'clock', 'filled_map', 'map',
  'shield', 'banner', 'bed', 'skull', 'fishing_rod', 'bow', 'elytra', 'chest', 'trapped_chest', 'ender_chest', 'fish', 'cooked_fish', 'dye',
  'coal', 'golden_apple', 'fireworks', 'firework_charge', 'written_book', 'writable_book', 'enchanted_book', 'leather_helmet',
  'leather_chestplate', 'leather_leggings', 'leather_boots', 'wool', 'carpet', 'stained_glass', 'stained_glass_pane', 'stained_hardened_clay',
  'concrete', 'concrete_powder', 'planks', 'log', 'log2', 'leaves', 'leaves2', 'sapling', 'wooden_slab', 'stone', 'dirt', 'sand', 'sandstone',
  'red_sandstone', 'stonebrick', 'prismarine', 'quartz_block', 'sponge', 'red_flower', 'double_plant', 'monster_egg', 'cobblestone_wall',
  'anvil', 'stone_slab', 'stone_slab2', 'tallgrass', 'yellow_flower', 'deadbush', 'brown_mushroom_block', 'red_mushroom_block', 'grass',
  'snow_layer', 'snow', 'reeds', 'waterlily', 'web', 'hardened_clay', 'pumpkin', 'lit_pumpkin', 'melon_block', 'magma', 'slime',
  'mob_spawner', 'brick_block', 'nether_brick', 'red_nether_brick', 'end_bricks', 'quartz_ore', 'noteblock', 'golden_rail', 'boat',
  'wooden_door', 'sign', 'trapdoor', 'fence', 'fence_gate', 'wooden_pressure_plate', 'wooden_button', 'repeater', 'comparator',
  'speckled_melon', 'melon', 'chorus_fruit_popped', 'netherbrick', 'experience_bottle', 'snowball', 'name_tag', 'totem_of_undying', 'trident',
  'grass_path', 'end_crystal', 'armor_stand', 'lead', 'carrot_on_a_stick', 'knowledge_book', 'item_frame', 'painting', 'flower_pot',
  'cauldron', 'brewing_stand', 'hopper', 'cake', 'iron_door', 'minecart', 'saddle', 'cookie'])

// Биомам 1.18 без пары дан ближайший по виду, иначе правило для снежных гор отключилось бы целиком
const BIOMES: Record<string, string> = {
  snowy_plains: 'ice_flats', snowy_tundra: 'ice_flats', ice_spikes: 'mutated_ice_flats', snowy_mountains: 'ice_mountains',
  snowy_beach: 'cold_beach', snowy_taiga: 'taiga_cold', snowy_taiga_hills: 'taiga_cold_hills', snowy_taiga_mountains: 'mutated_taiga_cold',
  mountains: 'extreme_hills', windswept_hills: 'extreme_hills', wooded_mountains: 'extreme_hills_with_trees', windswept_forest: 'extreme_hills_with_trees',
  gravelly_mountains: 'mutated_extreme_hills', windswept_gravelly_hills: 'mutated_extreme_hills',
  modified_gravelly_mountains: 'mutated_extreme_hills_with_trees', mountain_edge: 'smaller_extreme_hills',
  sunflower_plains: 'mutated_plains', flower_forest: 'mutated_forest', tall_birch_forest: 'mutated_birch_forest',
  old_growth_birch_forest: 'mutated_birch_forest', tall_birch_hills: 'mutated_birch_forest_hills', dark_forest: 'roofed_forest',
  dark_forest_hills: 'mutated_roofed_forest', taiga_mountains: 'mutated_taiga', giant_tree_taiga: 'redwood_taiga',
  old_growth_pine_taiga: 'redwood_taiga', giant_tree_taiga_hills: 'redwood_taiga_hills', giant_spruce_taiga: 'mutated_redwood_taiga',
  old_growth_spruce_taiga: 'mutated_redwood_taiga', giant_spruce_taiga_hills: 'mutated_redwood_taiga_hills', swamp: 'swampland',
  swamp_hills: 'mutated_swampland', modified_jungle: 'mutated_jungle', sparse_jungle: 'jungle_edge', modified_jungle_edge: 'mutated_jungle_edge',
  bamboo_jungle: 'jungle', bamboo_jungle_hills: 'jungle_hills', desert_lakes: 'mutated_desert', shattered_savanna: 'mutated_savanna',
  windswept_savanna: 'mutated_savanna', shattered_savanna_plateau: 'mutated_savanna_rock', badlands: 'mesa', eroded_badlands: 'mesa_bryce',
  wooded_badlands_plateau: 'mesa_rock', wooded_badlands: 'mesa_rock', badlands_plateau: 'mesa_clear_rock',
  modified_wooded_badlands_plateau: 'mutated_mesa_rock', modified_badlands_plateau: 'mutated_mesa_clear_rock',
  mushroom_fields: 'mushroom_island', mushroom_field_shore: 'mushroom_island_shore', beach: 'beaches', stone_shore: 'stone_beach',
  stony_shore: 'stone_beach', nether: 'hell', nether_wastes: 'hell', the_end: 'sky', small_end_islands: 'sky', end_midlands: 'sky',
  end_highlands: 'sky', end_barrens: 'sky', the_void: 'void', wooded_hills: 'forest_hills',
  warm_ocean: 'ocean', lukewarm_ocean: 'ocean', cold_ocean: 'ocean', deep_warm_ocean: 'deep_ocean', deep_lukewarm_ocean: 'deep_ocean',
  deep_cold_ocean: 'deep_ocean', deep_frozen_ocean: 'deep_ocean',
  grove: 'taiga_cold', snowy_slopes: 'ice_mountains', frozen_peaks: 'ice_mountains', jagged_peaks: 'ice_mountains',
  stony_peaks: 'extreme_hills', meadow: 'plains',
}
// OptiFine 1.12 ищет биом по отображаемому имени без пробелов и регистра: «ice_flats» не найдёт, «iceplains» — да
const BIOME_NAMES: Record<string, string> = {
  ocean: 'Ocean', plains: 'Plains', desert: 'Desert', extreme_hills: 'Extreme Hills', forest: 'Forest', taiga: 'Taiga',
  swampland: 'Swampland', river: 'River', hell: 'Hell', sky: 'The End', frozen_ocean: 'FrozenOcean', frozen_river: 'FrozenRiver',
  ice_flats: 'Ice Plains', ice_mountains: 'Ice Mountains', mushroom_island: 'MushroomIsland', mushroom_island_shore: 'MushroomIslandShore',
  beaches: 'Beach', desert_hills: 'DesertHills', forest_hills: 'ForestHills', taiga_hills: 'TaigaHills', smaller_extreme_hills: 'Extreme Hills Edge',
  jungle: 'Jungle', jungle_hills: 'JungleHills', jungle_edge: 'JungleEdge', deep_ocean: 'Deep Ocean', stone_beach: 'Stone Beach',
  cold_beach: 'Cold Beach', birch_forest: 'Birch Forest', birch_forest_hills: 'Birch Forest Hills', roofed_forest: 'Roofed Forest',
  taiga_cold: 'Cold Taiga', taiga_cold_hills: 'Cold Taiga Hills', redwood_taiga: 'Mega Taiga', redwood_taiga_hills: 'Mega Taiga Hills',
  extreme_hills_with_trees: 'Extreme Hills+', savanna: 'Savanna', savanna_rock: 'Savanna Plateau', mesa: 'Mesa', mesa_rock: 'Mesa Plateau F',
  mesa_clear_rock: 'Mesa Plateau', void: 'The Void', mutated_plains: 'Sunflower Plains', mutated_desert: 'Desert M',
  mutated_extreme_hills: 'Extreme Hills M', mutated_forest: 'Flower Forest', mutated_taiga: 'Taiga M', mutated_swampland: 'Swampland M',
  mutated_ice_flats: 'Ice Plains Spikes', mutated_jungle: 'Jungle M', mutated_jungle_edge: 'JungleEdge M', mutated_birch_forest: 'Birch Forest M',
  mutated_birch_forest_hills: 'Birch Forest Hills M', mutated_roofed_forest: 'Roofed Forest M', mutated_taiga_cold: 'Cold Taiga M',
  mutated_redwood_taiga: 'Mega Spruce Taiga', mutated_redwood_taiga_hills: 'Redwood Taiga Hills M', mutated_extreme_hills_with_trees: 'Extreme Hills+ M',
  mutated_savanna: 'Savanna M', mutated_savanna_rock: 'Savanna Plateau M', mutated_mesa: 'Mesa (Bryce)', mutated_mesa_rock: 'Mesa Plateau F M',
  mutated_mesa_clear_rock: 'Mesa Plateau M',
}
export const toBiomeName = (id: string) => BIOME_NAMES[id].replace(/ /g, '').toLowerCase()

const ENCHANTMENTS: Record<string, number> = {
  protection: 0, fire_protection: 1, feather_falling: 2, blast_protection: 3, projectile_protection: 4, respiration: 5, aqua_affinity: 6,
  thorns: 7, depth_strider: 8, frost_walker: 9, binding_curse: 10, sharpness: 16, smite: 17, bane_of_arthropods: 18, knockback: 19,
  fire_aspect: 20, looting: 21, sweeping: 22, sweeping_edge: 22, efficiency: 32, silk_touch: 33, unbreaking: 34, fortune: 35, power: 48,
  punch: 49, flame: 50, infinity: 51, luck_of_the_sea: 61, lure: 62, mending: 70, vanishing_curse: 71,
}

export interface PropertiesContext {
  /** Текстуры пака: путь новой версии (block/x) → пути 1.12 (blocks/y), как их разложил план. */
  resolved?: Map<string, string[]>
  /** Правило из optifine/ (id новых версий). Для mcpatcher/ id уже в формате 1.12. */
  modern?: boolean
}

/** Разбор значения matchBlocks: [ns:]name[:prop=v1,v2[:prop2=v3]]. */
function parseBlockToken(token: string): { ns?: string; name: string; props: [string, string][]; numeric: boolean } {
  const parts = token.split(':')
  let ns: string | undefined
  if (parts.length > 1 && !parts[1].includes('=') && !/^\d/.test(parts[1])) ns = parts.shift()
  const name = parts.shift() ?? ''
  const props = parts.filter((part) => part.includes('=')).map((part) => part.split('=', 2) as [string, string])
  return { ns, name, props, numeric: /^\d+$/.test(name) }
}

function convertBlockList(value: string, idx: ClientIndex, modern: boolean, dropped: string[]): string {
  const out: { id: string; props: [string, string][] }[] = []
  for (const token of value.split(/\s+/).filter(Boolean)) {
    const { ns, name, props, numeric } = parseBlockToken(token)
    if (numeric || (ns && ns !== 'minecraft') || !modern) { out.push({ id: token, props: [] }); continue }
    const extra = props.filter(([k]) => k !== 'waterlogged')
      .map(([k, v]): [string, string] => k === 'type' && /^(top|bottom)$/.test(v) && name.endsWith('_slab') ? ['half', v] : [k, v])
    const old = TABLES.blocks[name]
    if (old) out.push({ id: old.id, props: [...Object.entries(old.props ?? {}), ...extra] })
    else if (idx.blockstates[name] || Object.keys(idx.blockstates).length === 0) out.push({ id: name, props: extra })
    else dropped.push(name)
  }
  // dirt:variant=coarse_dirt + dirt:variant=podzol → dirt:variant=coarse_dirt,podzol; dirt без свойств покрывает все
  const whole = new Set(out.filter((entry) => !entry.props.length).map((entry) => entry.id))
  const groups = new Map<string, { id: string; props: [string, string][] }[]>()
  for (const entry of out) {
    if (entry.props.length && whole.has(entry.id)) continue
    const key = entry.id + '|' + entry.props.map(([prop]) => prop).join(',')
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  const result: string[] = []
  for (const list of groups.values()) {
    const first = list[0]
    const differing = first.props.map((_, i) => i).filter((i) => list.some((entry) => entry.props[i][1] !== first.props[i][1]))
    const merged = differing.length <= 1 ? [first.props.map(([k, v], i) => [k, i === differing[0] ? [...new Set(list.map((entry) => entry.props[i][1]))].join(',') : v] as [string, string])]
      : list.map((entry) => entry.props)
    for (const props of merged) result.push([first.id, ...props.map(([k, v]) => `${k}=${v}`)].join(':'))
  }
  return [...new Set(result)].join(' ')
}

/** Имя спрайта блока для matchTiles/connectTiles: как его назовёт итоговый пак. */
function getTileNames(tile: string, resolved: Map<string, string[]> | undefined, idx: ClientIndex): string[] {
  const m = /^(?:minecraft:)?(?:textures\/)?(?:block\/)?([^:]+?)(?:\.png)?$/.exec(tile)
  if (!m || tile.includes('/') && !/^(?:minecraft:)?(?:textures\/)?block\//.test(tile)) return [tile]
  const name = m[1]
  const fromPack = resolved?.get(`block/${name}`)?.filter((path) => path.startsWith('blocks/')).map((path) => path.slice('blocks/'.length))
  if (fromPack?.length) return fromPack
  const old = RENAMES.blocks[name]
  if (old && (idx.textures.size === 0 || idx.textures.has(`blocks/${old}`))) return [old]
  return [tile.replace(/^minecraft:/, '').replace(/^(?:textures\/)?block\//, '').replace(/\.png$/, '')]
}

function isItemKnown(id: string, idx: ClientIndex): boolean {
  return idx.models.size === 0 || ITEMS_1_12.has(id) || idx.models.has(`item/${id}`) || !!idx.blockstates[id]
}

/** text: null — правило отключено: без потерянного условия в 1.12 оно сработало бы шире исходного. */
export function convertProperties(text: string, idx: ClientIndex, ctx: PropertiesContext = {}): JsonResult {
  const modern = ctx.modern ?? true
  const notes: Note[] = []
  let disabled = false
  const disable = (reason: string) => { disabled = true; notes.push(warn(reason)) }
  const lines = text.split(/\r?\n/)
  const keyOf = (line: string) => /^\s*([^=#!\s][^=]*?)\s*=/.exec(line)?.[1]
  const keys = new Set(lines.map(keyOf).filter(Boolean))
  const isCit = keys.has('items') || keys.has('matchItems') || /^type\s*=\s*(item|enchantment|armor|elytra)/m.test(text)
  const extraLines: string[] = []

  const out = lines.map((line) => {
    const kv = /^(\s*)([^=#!\s][^=]*?)(\s*=\s*)(.*)$/.exec(line)
    if (!kv) return line
    const [, indent, key, eq, rawValue] = kv
    const value = rawValue.trim()

    if (key === 'enchantmentIDs' || key === 'enchantments') {
      const mapped = value.split(/\s+/).map((enchantment) => /^\d+(?:-\d+)?$/.test(enchantment) ? enchantment : ENCHANTMENTS[enchantment.replace(/^minecraft:/, '')]?.toString())
      if (mapped.some((id) => id === undefined)) disable(`Правило CIT отключено: зачарования «${value}» не сопоставлены с реестром 1.12.`)
      return `${indent}enchantmentIDs${eq}${mapped.filter((id) => id !== undefined).join(' ')}`
    }

    if (key === 'matchBlocks' || key === 'blocks' || key === 'connectBlocks' || key === 'tintBlock') {
      const dropped: string[] = []
      const converted = convertBlockList(value, idx, modern, dropped)
      if (dropped.length) notes.push(info(`${key}: в клиенте 1.12 нет блоков ${dropped.join(', ')} — убраны из правила.`))
      if (converted !== value && !dropped.length) notes.push(info(`${key}: id блоков переведены в формат 1.12.`))
      if (!converted) {
        if ((key === 'matchBlocks' || key === 'blocks') && !keys.has('matchTiles')) disable(`Правило отключено: ни одного блока из ${key} нет в клиенте 1.12.`)
        return null
      }
      return `${indent}${key}${eq}${converted}`
    }

    if (key === 'biomes') {
      const negate = value.startsWith('!')
      const list = value.replace(/^!/, '').split(/\s+/).filter(Boolean)
      const missing: string[] = []
      const mapped = [...new Set(list.flatMap((biome) => {
        const name = biome.replace(/^minecraft:/, '')
        const old = (modern ? BIOMES[name] : undefined) ?? (BIOME_NAMES[name] ? name : undefined)
        if (!old) { if (!modern) return [biome]; missing.push(name); return [] }
        return [toBiomeName(old)]
      }))]
      if (missing.length) notes.push(info(`biomes: в 1.12 нет биомов ${missing.join(', ')}.`))
      if (!mapped.length) {
        if (negate) return null
        disable('Правило отключено: ни одного биома из списка нет в 1.12.')
        return null
      }
      return `${indent}biomes${eq}${negate ? '!' : ''}${mapped.join(' ')}`
    }

    if (key === 'matchTiles' || key === 'connectTiles') {
      const tiles = [...new Set(value.split(/\s+/).filter(Boolean).flatMap((tile) => getTileNames(tile, ctx.resolved, idx)))]
      return `${indent}${key}${eq}${tiles.join(' ')}`
    }

    if ((key === 'items' || key === 'matchItems') && modern) {
      const missing: string[] = []
      const mapped = value.split(/\s+/).filter(Boolean).flatMap((token) => {
        const { ns, name, numeric } = parseBlockToken(token)
        if (numeric || (ns && ns !== 'minecraft')) return [{ id: token } as OldItem]
        const egg = /^(.+)_spawn_egg$/.exec(name)?.[1]
        if (egg && SPAWN_EGGS.has(egg)) return [{ id: 'spawn_egg', nbt: { 'EntityTag.id': `minecraft:${egg}` } }]
        const old = TABLES.items[name] ?? { id: name }
        if (!isItemKnown(old.id, idx)) { missing.push(name); return [] }
        return [old]
      })
      if (missing.length) notes.push(info(`items: в 1.12 нет предметов ${missing.join(', ')}.`))
      if (!mapped.length) { disable('Правило CIT отключено: ни одного предмета из items нет в 1.12.'); return null }
      const ids = [...new Set(mapped.map((item) => item.id))]
      const damages = [...new Set(mapped.map((item) => item.damage))]
      if (!keys.has('damage') && damages.every((damage) => damage !== undefined)) {
        if (ids.length === 1 || damages.length === 1) extraLines.push(`damage=${damages.join(' ')}`)
        else notes.push(warn('items: предметы различаются только metadata, а damage у правила общий — правило сработает шире исходного.'))
      }
      const nbts = mapped.map((item) => JSON.stringify(item.nbt ?? null))
      if (mapped.some((item) => item.nbt)) {
        if (new Set(nbts).size === 1) for (const [tag, tagValue] of Object.entries(mapped[0].nbt!)) extraLines.push(`nbt.${tag}=${tagValue}`)
        else notes.push(warn('items: разные яйца призыва в одном правиле — в 1.12 это один предмет spawn_egg, моб не различается.'))
      }
      if (ids.join(' ') !== value) notes.push(info('items: id предметов переведены в формат 1.12.'))
      return `${indent}${key}${eq}${ids.join(' ')}`
    }

    if (key.startsWith('model')) return `${indent}${key}${eq}${value.replace(/^minecraft:/, '').replace(/^assets\/minecraft\/models\//, '')}`

    if (key.startsWith('components.')) {
      if (key === 'components.custom_name') return `${indent}nbt.display.Name${eq}${value}`
      if (key === 'components.potion_contents.potion') {
        const potion = value.replace(/^minecraft:/, '')
        if (!POTIONS.has(potion)) disable(`Правило CIT отключено: зелья «${potion}» нет в 1.12.`)
        return `${indent}nbt.Potion${eq}minecraft:${potion}`
      }
      disable('Условие components не представимо в 1.12: правило отключено, чтобы не применялось ко всем предметам.')
      return line
    }

    if (key === 'nbt.Potion' && modern) {
      const potion = value.replace(/^minecraft:/, '')
      if (!/^(i?regex|i?pattern):/.test(value) && !POTIONS.has(potion)) disable(`Правило CIT отключено: зелья «${potion}» нет в 1.12.`)
    }

    return line
      .replace(/textures\/block\//g, 'textures/blocks/')
      .replace(/textures\/item\//g, 'textures/items/')
      .replace(/(^|[=\s])minecraft:block\//g, '$1blocks/')
      .replace(/(^|[=\s])minecraft:item\//g, '$1items/')
  }).filter((line): line is string => line !== null)

  if (!isCit && extraLines.length) extraLines.length = 0
  return { text: disabled ? null : [...out, ...extraLines].join('\n'), notes: dedupe(notes) }
}

function dedupe(notes: Note[]): Note[] {
  const seen = new Set<string>()
  return notes.filter((note) => !seen.has(note.text) && !!seen.add(note.text))
}
