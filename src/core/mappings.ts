// Обратные таблицы переименований: имя текстуры в 1.13+ → имя в 1.12.2.
// Ключ — имя файла без расширения внутри textures/block (или item) новых версий,
// значение — имя внутри textures/blocks (или items) 1.12.2.
// Одно новое имя может прийти из разных версий (grass → short_grass в 1.20.3),
// поэтому в таблицах есть синонимы.

export const COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const

/** В 1.12 светло-серый назывался silver. */
export const oldColor = (c: string) => (c === 'light_gray' ? 'silver' : c)

export const WOODS: Record<string, string> = {
  oak: 'oak', spruce: 'spruce', birch: 'birch', jungle: 'jungle', acacia: 'acacia', dark_oak: 'big_oak',
}

function build(): { blocks: Record<string, string>; items: Record<string, string> } {
  const b: Record<string, string> = {}
  const i: Record<string, string> = {}

  for (const c of COLORS) {
    const o = oldColor(c)
    b[`${c}_wool`] = `wool_colored_${o}`
    b[`${c}_terracotta`] = `hardened_clay_stained_${o}`
    b[`${c}_stained_glass`] = `glass_${o}`
    b[`${c}_stained_glass_pane_top`] = `glass_pane_top_${o}`
    b[`${c}_concrete`] = `concrete_${o}`
    b[`${c}_concrete_powder`] = `concrete_powder_${o}`
    b[`${c}_glazed_terracotta`] = `glazed_terracotta_${o}`
    b[`${c}_shulker_box`] = `shulker_top_${o}`
    i[`${c}_dye`] = `dye_powder_${o}`
  }

  for (const [n, o] of Object.entries(WOODS)) {
    b[`${n}_planks`] = `planks_${o}`
    b[`${n}_log`] = `log_${o}`
    b[`${n}_log_top`] = `log_${o}_top`
    b[`${n}_leaves`] = `leaves_${o}`
  }
  b.oak_sapling = 'sapling_oak'
  b.spruce_sapling = 'sapling_spruce'
  b.birch_sapling = 'sapling_birch'
  b.jungle_sapling = 'sapling_jungle'
  b.acacia_sapling = 'sapling_acacia'
  b.dark_oak_sapling = 'sapling_roofed_oak'

  const doors: Record<string, string> = {
    oak: 'wood', spruce: 'spruce', birch: 'birch', jungle: 'jungle', acacia: 'acacia', dark_oak: 'dark_oak', iron: 'iron',
  }
  for (const [n, o] of Object.entries(doors)) {
    b[`${n}_door_bottom`] = `door_${o}_lower`
    b[`${n}_door_top`] = `door_${o}_upper`
    i[`${n}_door`] = `door_${o}`
  }

  for (let s = 0; s <= 7; s++) b[`wheat_stage${s}`] = `wheat_stage_${s}`
  for (let s = 0; s <= 3; s++) {
    b[`carrots_stage${s}`] = `carrots_stage_${s}`
    b[`potatoes_stage${s}`] = `potatoes_stage_${s}`
    b[`beetroots_stage${s}`] = `beetroots_stage_${s}`
  }
  for (let s = 0; s <= 2; s++) {
    b[`nether_wart_stage${s}`] = `nether_wart_stage_${s}`
    b[`cocoa_stage${s}`] = `cocoa_stage_${s}`
  }

  const tools = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']
  for (const t of tools) {
    i[`wooden_${t}`] = `wood_${t}`
    i[`golden_${t}`] = `gold_${t}`
  }
  for (const a of ['helmet', 'chestplate', 'leggings', 'boots']) i[`golden_${a}`] = `gold_${a}`

  const discs = ['13', 'cat', 'blocks', 'chirp', 'far', 'mall', 'mellohi', 'stal', 'strad', 'ward', '11', 'wait']
  for (const d of discs) i[`music_disc_${d}`] = `record_${d}`

  Object.assign(b, {
    // камень
    granite: 'stone_granite', polished_granite: 'stone_granite_smooth',
    diorite: 'stone_diorite', polished_diorite: 'stone_diorite_smooth',
    andesite: 'stone_andesite', polished_andesite: 'stone_andesite_smooth',
    stone_bricks: 'stonebrick', mossy_stone_bricks: 'stonebrick_mossy',
    cracked_stone_bricks: 'stonebrick_cracked', chiseled_stone_bricks: 'stonebrick_carved',
    mossy_cobblestone: 'cobblestone_mossy', bricks: 'brick',
    nether_bricks: 'nether_brick', red_nether_bricks: 'red_nether_brick',
    smooth_stone: 'stone_slab_top', smooth_stone_slab_side: 'stone_slab_side',
    stone_slab_top: 'stone_slab_top',
    // песчаник, кварц, призмарин
    sandstone: 'sandstone_normal', chiseled_sandstone: 'sandstone_carved', cut_sandstone: 'sandstone_smooth',
    red_sandstone: 'red_sandstone_normal', chiseled_red_sandstone: 'red_sandstone_carved',
    cut_red_sandstone: 'red_sandstone_smooth',
    chiseled_quartz_block: 'quartz_block_chiseled', chiseled_quartz_block_top: 'quartz_block_chiseled_top',
    quartz_pillar: 'quartz_block_lines', quartz_pillar_top: 'quartz_block_lines_top',
    nether_quartz_ore: 'quartz_ore',
    prismarine: 'prismarine_rough', dark_prismarine: 'prismarine_dark',
    // земля и растения
    grass_block_top: 'grass_top', grass_block_side: 'grass_side',
    grass_block_side_overlay: 'grass_side_overlay', grass_block_snow: 'grass_side_snowed',
    podzol_top: 'dirt_podzol_top', podzol_side: 'dirt_podzol_side',
    grass: 'tallgrass', short_grass: 'tallgrass',
    tall_grass_bottom: 'double_plant_grass_bottom', tall_grass_top: 'double_plant_grass_top',
    large_fern_bottom: 'double_plant_fern_bottom', large_fern_top: 'double_plant_fern_top',
    peony_bottom: 'double_plant_paeonia_bottom', peony_top: 'double_plant_paeonia_top',
    rose_bush_bottom: 'double_plant_rose_bottom', rose_bush_top: 'double_plant_rose_top',
    lilac_bottom: 'double_plant_syringa_bottom', lilac_top: 'double_plant_syringa_top',
    sunflower_bottom: 'double_plant_sunflower_bottom', sunflower_top: 'double_plant_sunflower_top',
    sunflower_front: 'double_plant_sunflower_front', sunflower_back: 'double_plant_sunflower_back',
    dead_bush: 'deadbush', dandelion: 'flower_dandelion', poppy: 'flower_rose',
    blue_orchid: 'flower_blue_orchid', allium: 'flower_allium', azure_bluet: 'flower_houstonia',
    red_tulip: 'flower_tulip_red', orange_tulip: 'flower_tulip_orange',
    white_tulip: 'flower_tulip_white', pink_tulip: 'flower_tulip_pink', oxeye_daisy: 'flower_oxeye_daisy',
    red_mushroom: 'mushroom_red', brown_mushroom: 'mushroom_brown',
    red_mushroom_block: 'mushroom_block_skin_red', brown_mushroom_block: 'mushroom_block_skin_brown',
    mushroom_stem: 'mushroom_block_skin_stem',
    sugar_cane: 'reeds', lily_pad: 'waterlily', cobweb: 'web',
    melon_stem: 'melon_stem_disconnected', attached_melon_stem: 'melon_stem_connected',
    pumpkin_stem: 'pumpkin_stem_disconnected', attached_pumpkin_stem: 'pumpkin_stem_connected',
    carved_pumpkin: 'pumpkin_face_off', jack_o_lantern: 'pumpkin_face_on',
    farmland: 'farmland_dry', farmland_moist: 'farmland_wet',
    grass_path_top: 'grass_path_top', grass_path_side: 'grass_path_side',
    dirt_path_top: 'grass_path_top', dirt_path_side: 'grass_path_side',
    // разное
    terracotta: 'hardened_clay', white_stained_glass: 'glass_white',
    packed_ice: 'ice_packed', wet_sponge: 'sponge_wet', slime_block: 'slime', magma_block: 'magma',
    note_block: 'noteblock', spawner: 'mob_spawner', nether_portal: 'portal',
    end_portal_frame_top: 'endframe_top', end_portal_frame_side: 'endframe_side',
    end_portal_frame_eye: 'endframe_eye',
    furnace_front: 'furnace_front_off',
    dispenser_front: 'dispenser_front_horizontal', dropper_front: 'dropper_front_horizontal',
    oak_trapdoor: 'trapdoor',
    rail: 'rail_normal', rail_corner: 'rail_normal_turned',
    powered_rail: 'rail_golden', powered_rail_on: 'rail_golden_powered',
    detector_rail: 'rail_detector', detector_rail_on: 'rail_detector_powered',
    activator_rail: 'rail_activator', activator_rail_on: 'rail_activator_powered',
    torch: 'torch_on', redstone_torch: 'redstone_torch_on',
    redstone_lamp: 'redstone_lamp_off', repeater: 'repeater_off', comparator: 'comparator_off',
    piston_top: 'piston_top_normal',
    tripwire: 'trip_wire', tripwire_hook: 'trip_wire_source',
    anvil: 'anvil_base', anvil_top: 'anvil_top_damaged_0',
    chipped_anvil_top: 'anvil_top_damaged_1', damaged_anvil_top: 'anvil_top_damaged_2',
    fire_0: 'fire_layer_0', fire_1: 'fire_layer_1',
  })

  Object.assign(i, {
    golden_apple: 'apple_golden', enchanted_golden_apple: 'apple_golden',
    bow: 'bow_standby',
    book: 'book_normal', enchanted_book: 'book_enchanted',
    writable_book: 'book_writable', written_book: 'book_written',
    bucket: 'bucket_empty', water_bucket: 'bucket_water', lava_bucket: 'bucket_lava', milk_bucket: 'bucket_milk',
    beef: 'beef_raw', cooked_beef: 'beef_cooked', chicken: 'chicken_raw', cooked_chicken: 'chicken_cooked',
    porkchop: 'porkchop_raw', cooked_porkchop: 'porkchop_cooked', mutton: 'mutton_raw',
    cooked_mutton: 'mutton_cooked', rabbit: 'rabbit_raw', cooked_rabbit: 'rabbit_cooked',
    cod: 'fish_cod_raw', cooked_cod: 'fish_cod_cooked', salmon: 'fish_salmon_raw',
    cooked_salmon: 'fish_salmon_cooked', tropical_fish: 'fish_clownfish_raw', pufferfish: 'fish_pufferfish_raw',
    baked_potato: 'potato_baked', poisonous_potato: 'potato_poisonous', golden_carrot: 'carrot_golden',
    melon_slice: 'melon', glistering_melon_slice: 'melon_speckled',
    wheat_seeds: 'seeds_wheat', melon_seeds: 'seeds_melon', pumpkin_seeds: 'seeds_pumpkin',
    ink_sac: 'dye_powder_black', cocoa_beans: 'dye_powder_brown', lapis_lazuli: 'dye_powder_blue',
    bone_meal: 'dye_powder_white',
    rose_red: 'dye_powder_red', cactus_green: 'dye_powder_green', dandelion_yellow: 'dye_powder_yellow',
    minecart: 'minecart_normal', chest_minecart: 'minecart_chest', furnace_minecart: 'minecart_furnace',
    hopper_minecart: 'minecart_hopper', tnt_minecart: 'minecart_tnt',
    command_block_minecart: 'minecart_command_block',
    firework_rocket: 'fireworks', firework_star: 'fireworks_charge',
    firework_star_overlay: 'fireworks_charge_overlay',
    fishing_rod: 'fishing_rod_uncast',
    golden_horse_armor: 'gold_horse_armor',
    map: 'map_empty', filled_map: 'map_filled', filled_map_markings: 'map_filled_markings',
    nether_brick: 'netherbrick', sugar_cane: 'reeds', slime_ball: 'slimeball',
    fermented_spider_eye: 'spider_eye_fermented',
    potion: 'potion_bottle_drinkable', splash_potion: 'potion_bottle_splash',
    lingering_potion: 'potion_bottle_lingering', glass_bottle: 'potion_bottle_empty',
    redstone: 'redstone_dust', totem_of_undying: 'totem',
    popped_chorus_fruit: 'chorus_fruit_popped', broken_elytra: 'broken_elytra',
    armor_stand: 'wooden_armorstand', fire_charge: 'fireball',
    oak_sign: 'sign', sign: 'sign',
  })

  // 1.14 разделил чёрный/коричневый/синий/белый краситель — в 1.12 их роль играют ink_sac и пр.
  i.black_dye = 'dye_powder_black'
  i.brown_dye = 'dye_powder_brown'
  i.blue_dye = 'dye_powder_blue'
  i.white_dye = 'dye_powder_white'

  return { blocks: b, items: i }
}

export const RENAMES = build()

/** Имена, которые конкурируют за ту же цель с более точным вариантом — обрабатываются последними. */
export const SYNONYMS = new Set([
  'block/grass', 'block/stone_slab_top', 'block/grass_path_top', 'block/grass_path_side',
  'item/enchanted_golden_apple', 'item/black_dye', 'item/brown_dye', 'item/blue_dye', 'item/white_dye',
  'item/rose_red', 'item/cactus_green', 'item/dandelion_yellow', 'item/sign',
])

/** Прочие пути внутри textures/ (без .png): новое → 1.12. */
export const PATH_RENAMES: Record<string, string> = {
  'entity/boat/oak': 'entity/boat/boat_oak',
  'entity/boat/spruce': 'entity/boat/boat_spruce',
  'entity/boat/birch': 'entity/boat/boat_birch',
  'entity/boat/jungle': 'entity/boat/boat_jungle',
  'entity/boat/acacia': 'entity/boat/boat_acacia',
  'entity/boat/dark_oak': 'entity/boat/boat_darkoak',
  'entity/signs/oak': 'entity/sign',
  'entity/player/wide/steve': 'entity/steve',
  'entity/player/slim/alex': 'entity/alex',
  'entity/equipment/horse_body/iron': 'entity/horse/armor/horse_armor_iron',
  'entity/equipment/horse_body/gold': 'entity/horse/armor/horse_armor_gold',
  'entity/equipment/horse_body/diamond': 'entity/horse/armor/horse_armor_diamond',
  'entity/equipment/pig_saddle/saddle': 'entity/pig/pig_saddle',
}

/** 1.21.2+: броня переехала в entity/equipment/<слой>/<материал>. */
export const ARMOR_MATERIALS: Record<string, string> = {
  leather: 'leather', leather_overlay: 'leather', chainmail: 'chainmail', iron: 'iron',
  gold: 'gold', diamond: 'diamond', netherite: 'netherite', turtle_scute: 'turtle',
}

/** pack_format → версии игры (для подписи в интерфейсе). */
export const PACK_FORMATS: [format: number, label: string][] = [
  [1, '1.6–1.8'], [2, '1.9–1.10'], [3, '1.11–1.12'], [4, '1.13–1.14'], [5, '1.15–1.16.1'],
  [6, '1.16.2–1.16.5'], [7, '1.17'], [8, '1.18'], [9, '1.19–1.19.2'], [12, '1.19.3'], [13, '1.19.4'],
  [15, '1.20–1.20.1'], [18, '1.20.2'], [22, '1.20.3–1.20.4'], [32, '1.20.5–1.20.6'], [34, '1.21–1.21.1'],
  [42, '1.21.2–1.21.3'], [46, '1.21.4'], [55, '1.21.5'], [63, '1.21.6'], [64, '1.21.7–1.21.8'],
  [69, '1.21.9+'],
]

export function packFormatLabel(format: number | undefined): string {
  if (format === undefined) return 'неизвестно'
  let label = PACK_FORMATS[0][1]
  for (const [f, l] of PACK_FORMATS) if (format >= f) label = l
  return label
}

/** Картины: в 1.14+ каждая отдельным файлом, в 1.12 — один атлас 256×256 (при 16 px на блок). */
export const PAINTING_ATLAS = 'painting/paintings_kristoffer_zetterstrand'
export const PAINTING_LAYOUT: Record<string, [x: number, y: number, w: number, h: number]> = {
  kebab: [0, 0, 16, 16], aztec: [16, 0, 16, 16], alban: [32, 0, 16, 16], aztec2: [48, 0, 16, 16],
  bomb: [64, 0, 16, 16], plant: [80, 0, 16, 16], wasteland: [96, 0, 16, 16],
  pool: [0, 32, 32, 16], courbet: [32, 32, 32, 16], sea: [64, 32, 32, 16], sunset: [96, 32, 32, 16],
  creebet: [128, 32, 32, 16],
  wanderer: [0, 64, 16, 32], graham: [16, 64, 16, 32],
  fighters: [0, 96, 64, 32],
  match: [0, 128, 32, 32], bust: [32, 128, 32, 32], stage: [64, 128, 32, 32], void: [96, 128, 32, 32],
  skull_and_roses: [128, 128, 32, 32], wither: [160, 128, 32, 32],
  pointer: [0, 192, 64, 64], pigscene: [64, 192, 64, 64], burning_skull: [128, 192, 64, 64],
  skeleton: [192, 64, 64, 48], donkey_kong: [192, 112, 64, 48],
  back: [192, 0, 64, 64],
}
