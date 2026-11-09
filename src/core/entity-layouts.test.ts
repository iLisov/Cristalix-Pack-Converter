import { describe, expect, it } from 'vitest'
import { getLayoutMismatch } from './entity-layouts'

const png = (w: number, h: number) => {
  const data = new Uint8Array(32)
  data.set([0x89, 0x50, 0x4e, 0x47])
  const view = new DataView(data.buffer)
  view.setUint32(16, w)
  view.setUint32(20, h)
  return data
}

describe('раскладка текстур мобов', () => {
  it('корова 1.21.5 (64×64) не ложится на модель 1.12 (64×32)', () => {
    expect(getLayoutMismatch('entity/cow/cow', png(64, 64), 1)).not.toBeNull()
    expect(getLayoutMismatch('entity/cow/cow', png(128, 64), 2)).toBeNull()
  })

  it('лошадь 1.14+ (64×64) мельче старой 128×128 с учётом разрешения пака', () => {
    expect(getLayoutMismatch('entity/horse/horse_white', png(64, 64), 1)).not.toBeNull()
    expect(getLayoutMismatch('entity/horse/horse_white', png(256, 256), 2)).toBeNull()
  })

  it('мобы без записи в таблице не проверяются', () => {
    expect(getLayoutMismatch('entity/fox/fox', png(48, 32), 1)).toBeNull()
  })
})
