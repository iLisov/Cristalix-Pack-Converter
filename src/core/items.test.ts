import { describe, expect, it } from 'vitest'
import { buildCitRules } from './items'
import { buildWolfProperties, getWolfVariantIndex, getWolfVariantTarget } from './random-entities'

const model = (m: string) => ({ type: 'minecraft:model', model: m })

describe('условные модели 1.21.4 → CIT', () => {
  it('имя предмета: правило на каждое имя, запасная ветка не попадает в правила', () => {
    const { rules } = buildCitRules({ type: 'minecraft:select', property: 'minecraft:component', component: 'minecraft:custom_name',
      cases: [{ when: 'anon', model: model('item/figurine/anon') }, { when: ['a', 'b'], model: model('item/ab') }], fallback: model('item/amethyst_shard') })
    expect(rules.map((r) => [r.conditions, r.model])).toEqual([
      [['nbt.display.Name=anon'], 'item/figurine/anon'], [['nbt.display.Name=a'], 'item/ab'], [['nbt.display.Name=b'], 'item/ab']])
  })

  it('вложенные зачарования: ветка с выполненным условием старше ветки «иначе»', () => {
    const ench = (id: string, t: unknown, f: unknown) => ({ type: 'minecraft:condition', property: 'minecraft:component', predicate: 'minecraft:enchantments',
      value: [{ enchantments: `minecraft:${id}`, levels: { min: 2 } }], on_true: t, on_false: f })
    const { rules } = buildCitRules(ench('sharpness', ench('fire_aspect', model('item/both'), model('item/sharp')), ench('smite', model('item/smite'), model('item/base'))))
    // «и острота, и огонь» в CIT не выразить — такое правило отбрасывается
    expect(rules.map((r) => r.model)).toEqual(['item/sharp', 'item/smite'])
    expect(rules[0].conditions).toEqual(['enchantments=sharpness', 'enchantmentLevels=2-'])
    expect(rules[0].weight).toBeGreaterThan(rules[1].weight)
  })

  it('натяжение лука в CIT-ветке → model.bow_pulling_N', () => {
    const bow = (p: string) => ({ type: 'minecraft:condition', property: 'minecraft:using_item',
      on_true: { type: 'minecraft:range_dispatch', property: 'minecraft:use_duration', scale: 0.05,
        entries: [{ threshold: 0.9, model: model(`${p}_2`) }, { threshold: 0.65, model: model(`${p}_1`) }], fallback: model(`${p}_0`) },
      on_false: model(p) })
    const { rules } = buildCitRules({ type: 'minecraft:select', property: 'minecraft:component', component: 'minecraft:custom_name',
      cases: [{ when: 'Лук', model: bow('item/my_bow') }], fallback: bow('item/bow') }, 'bow')
    expect(rules).toHaveLength(1)
    expect(rules[0].model).toBe('item/my_bow')
    expect(rules[0].models).toEqual({ bow_standby: 'item/my_bow', bow_pulling_0: 'item/my_bow_0', bow_pulling_1: 'item/my_bow_1', bow_pulling_2: 'item/my_bow_2' })
  })

  it('порог урона → damage в процентах, верхняя ступень старше', () => {
    const { rules } = buildCitRules({ type: 'minecraft:range_dispatch', property: 'minecraft:damage',
      entries: [{ threshold: 0.5, model: model('item/half') }, { threshold: 0.9, model: model('item/broken') }], fallback: model('item/new') })
    expect(rules.map((r) => [r.conditions, r.model])).toEqual([[['damage=90%-'], 'item/broken'], [['damage=50%-90%'], 'item/half']])
  })

  it('условия без аналога в CIT отмечаются, берётся запасная ветка', () => {
    const r = buildCitRules({ type: 'minecraft:select', property: 'minecraft:display_context', cases: [{ when: 'gui', model: model('item/gui') }], fallback: model('item/hand') })
    expect(r.rules).toEqual([])
    expect([...r.skipped]).toEqual(['display_context'])
  })
})


describe('окраски волков → Random Entities', () => {
  it('нумерует окраски из пака и пишет правила по биомам именами OptiFine 1.12', () => {
    const index = getWolfVariantIndex(['entity/wolf/wolf', 'entity/wolf/wolf_ashen', 'entity/wolf/wolf_ashen_tame', 'entity/wolf/wolf_woods', 'entity/wolf/wolf_baby'])
    expect([...index]).toEqual([['woods', 2], ['ashen', 3]])
    expect(getWolfVariantTarget('entity/wolf/wolf_ashen_tame', index)).toBe('assets/minecraft/mcpatcher/mob/wolf/wolf_tame3.png')
    expect(getWolfVariantTarget('entity/wolf/wolf_ashen_angry_baby', index)).toBeUndefined()
    expect(buildWolfProperties(index)).toBe('skins.1=2\nbiomes.1=forest foresthills\nskins.2=3\nbiomes.2=coldtaiga coldtaigahills coldtaigam')
  })
})
