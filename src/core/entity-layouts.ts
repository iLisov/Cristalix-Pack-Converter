// Размеры текстур мобов 1.12 при 16×: другая пропорция или размер у текстуры пака — значит, модель новая
// и развёртка на модели 1.12 ляжет кашей (коровы и свиньи 1.21.5 — 64×64, лошади с 1.14 — 64×64,
// вредина с 1.20 и летучая мышь с 1.20.3 — 32×32).
// Четвёртое поле — модель сменилась при той же пропорции, и выдаёт её только размер относительно пака.
const LAYOUTS: [RegExp, number, number, boolean?][] = [
  [/^entity\/(cow\/(cow|mooshroom|red_mooshroom|brown_mooshroom)|pig\/pig(_saddle)?|chicken)$/, 64, 32],
  [/^entity\/sheep\/sheep(_fur)?$/, 64, 32],
  [/^entity\/horse\/(horse_[a-z_]+|donkey|mule|armor\/horse_armor_[a-z]+)$/, 128, 128, true],
  [/^entity\/illager\/vex(_charging)?$/, 64, 64, true],
  [/^entity\/bat$/, 64, 64, true],
  [/^entity\/wolf\/wolf(_tame|_angry)?$/, 64, 32],
  [/^entity\/(creeper\/creeper|spider\/(cave_)?spider|enderman\/enderman|skeleton\/(skeleton|wither_skeleton|stray)|slime\/slime|ghast\/ghast|blaze|squid)$/, 64, 32],
  [/^entity\/(zombie\/(zombie|husk)|snowman)$/, 64, 64],
  [/^entity\/cat\/[a-z]+$/, 64, 32],
  [/^entity\/rabbit\/[a-z_]+$/, 64, 32],
  [/^entity\/llama\/[a-z_]+$/, 128, 64],
  [/^entity\/witch$/, 64, 128],
]

export function pngSize(data: Uint8Array): { w: number; h: number } | null {
  if (data.length < 24 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { w: view.getUint32(16), h: view.getUint32(20) }
}

/** Описание несовпадения раскладки или null; scale — разрешение пака относительно 16×. */
export function getLayoutMismatch(target: string, data: Uint8Array, scale: number): string | null {
  const layout = LAYOUTS.find(([pattern]) => pattern.test(target))
  const size = pngSize(data)
  if (!layout || !size) return null
  const [, w, h, bySize] = layout
  const ratioDiffers = h > 0 && Math.abs(size.w / size.h - w / h) > 0.01
  // У прочих мобов другой размер при той же пропорции — это просто HD
  const widthDiffers = bySize && Math.abs(size.w / scale - w) / w > 0.4
  if (!ratioDiffers && !widthDiffers) return null
  return `${size.w}×${size.h}, а в 1.12 — ${w}×${h || '…'} при 16×`
}
