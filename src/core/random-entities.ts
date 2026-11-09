import { toBiomeName } from './optifine'

// Ближайшие биомы 1.12 к биомам появления окраски в 1.20.5+
export const WOLF_VARIANTS: Record<string, string[]> = {
  woods: ['forest', 'forest_hills'],
  ashen: ['taiga_cold', 'taiga_cold_hills', 'mutated_taiga_cold'],
  black: ['redwood_taiga', 'redwood_taiga_hills'],
  chestnut: ['mutated_redwood_taiga', 'mutated_redwood_taiga_hills'],
  rusty: ['jungle_edge', 'mutated_jungle_edge'],
  spotted: ['savanna_rock', 'mutated_savanna_rock'],
  striped: ['mesa_rock', 'mutated_mesa_rock'],
  snowy: ['ice_mountains'],
}

const WOLF = /^entity\/wolf\/wolf_([a-z]+?)(_tame|_angry)?$/

/** Номер альтернативы Random Entities для каждой окраски из пака; 1 — обычный wolf.png. */
export function getWolfVariantIndex(rels: string[]): Map<string, number> {
  const present = new Set(rels.map((rel) => WOLF.exec(rel)).filter((match) => match && !match[2] && WOLF_VARIANTS[match[1]]).map((match) => match![1]))
  return new Map(Object.keys(WOLF_VARIANTS).filter((variant) => present.has(variant)).map((variant, i) => [variant, i + 2]))
}

export function getWolfVariantTarget(rel: string, index: Map<string, number>): string | undefined {
  const match = WOLF.exec(rel)
  const number = match && index.get(match[1])
  return number ? `assets/minecraft/mcpatcher/mob/wolf/wolf${match![2] ?? ''}${number}.png` : undefined
}

export function buildWolfProperties(index: Map<string, number>): string {
  return [...index].flatMap(([variant, number], i) => [`skins.${i + 1}=${number}`, `biomes.${i + 1}=${WOLF_VARIANTS[variant].map(toBiomeName).join(' ')}`]).join('\n')
}
