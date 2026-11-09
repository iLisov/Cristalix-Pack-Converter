import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { findRoot, type Files } from '../core/convert'
import { packFormatLabel } from '../core/mappings'
import { computeWidths, renderBitmapText, type PageImages } from '../fonts/bitmap'
import { convertModernFont, isModernFont } from '../fonts/legacy-font'
import { deleteVariant, listVariants, saveVariant, type SavedVariant } from '../fonts/store'
import { readDrop, readFileList, readZip, saveBlob, type LoadedPack } from '../app/zipio'
import { IconClose, IconDownload, IconFolder, IconInfo, IconUpload, IconWarn } from './icons'

const NS = ['core_font_mod', 'minecraft'] as const
const SAMPLE = 'Привет, §bCristalix§r! The quick brown fox — 0123456789\n§6Съешь же ещё этих мягких французских булок§r ✦ ♥ ☺'

const PAGE_NAMES: Record<number, string> = {
  0x00: 'Латиница', 0x01: 'Латиница, расширение', 0x02: 'Латиница, МФА', 0x03: 'Греческий', 0x04: 'Кириллица',
  0x05: 'Армянский, иврит', 0x20: 'Пунктуация', 0x21: 'Символы', 0x22: 'Математика', 0x25: 'Рамки и фигуры',
  0x26: 'Разные символы', 0x27: 'Дингбаты', 0x30: 'CJK', 0xff: 'Полноширинные',
}
const pageName = (p: number) => PAGE_NAMES[p] ?? (p >= 0xe0 && p <= 0xf8 ? 'Приватная область' : '')
const hex2 = (p: number) => p.toString(16).padStart(2, '0')
const blobUrl = (d: Uint8Array) => URL.createObjectURL(new Blob([d], { type: 'image/png' }))

interface PageEntry {
  data: Uint8Array
  origin: 'pack' | 'added'
}

interface FontPack {
  name: string
  pages: Map<number, PageEntry>
  glyphSizes?: Uint8Array
  /** Прочие файлы пака (эмодзи, ascii.png, обложка…) — сохраняются при экспорте как есть. */
  extras: Map<string, Uint8Array>
  origin?: { kind: 'builtin' | 'mine'; id: string }
  /** Пак сконвертирован из формата новых версий: пояснения для баннера. */
  converted?: string[]
}

interface Preset {
  id: string
  name: string
  description: string
  file: string
}

const EMPTY_PACK: FontPack = { name: 'Новый шрифтовой пак', pages: new Map(), extras: new Map() }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function pagesFrom(files: Files, root = ''): { pages: Map<number, Uint8Array>; glyphSizes?: Uint8Array } {
  const pages = new Map<number, Uint8Array>()
  let glyphSizes: Uint8Array | undefined
  // core_font_mod главнее: он и рисует текст в клиенте
  for (const ns of [...NS].reverse()) {
    const re = new RegExp(`^${escapeRe(root)}assets/${ns}/textures/font/unicode_page_([0-9a-f]{2})\\.png$`)
    for (const [path, data] of files) {
      const m = re.exec(path)
      if (m) pages.set(parseInt(m[1], 16), data)
    }
    glyphSizes = files.get(`${root}assets/${ns}/font/glyph_sizes.bin`) ?? glyphSizes
  }
  return { pages, glyphSizes }
}

function readFontPack(pack: LoadedPack): FontPack {
  const root = findRoot([...pack.files.keys()])
  const { pages, glyphSizes } = pagesFrom(pack.files, root)
  const handled = (path: string) =>
    path === 'pack.mcmeta' ||
    /^assets\/[^/]+\/textures\/font\/unicode_page_[0-9a-f]{2}\.png$/.test(path) ||
    /^assets\/[^/]+\/font\/glyph_sizes\.bin$/.test(path)
  const extras = new Map<string, Uint8Array>()
  for (const [path, data] of pack.files) {
    if (!path.startsWith(root) || path.endsWith('/')) continue
    const local = path.slice(root.length)
    if (!handled(local)) extras.set(local, data)
  }
  return {
    name: pack.name,
    pages: new Map([...pages].map(([p, data]) => [p, { data, origin: 'pack' as const }])),
    glyphSizes,
    extras,
  }
}

/** Пак → zip (тот же формат, что у шрифтовых паков клиента). */
async function buildZip(pack: FontPack, widths: Uint8Array, mirror: boolean): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, data] of pack.extras) zip.file(path, data)
  zip.file('pack.mcmeta', JSON.stringify({ pack: { pack_format: 3, description: pack.name } }, null, 2))
  const namespaces = mirror ? NS : (['core_font_mod'] as const)
  for (const [p, e] of pack.pages) {
    for (const ns of namespaces) zip.file(`assets/${ns}/textures/font/unicode_page_${hex2(p)}.png`, e.data)
  }
  if (pack.pages.size > 0 || pack.glyphSizes) for (const ns of namespaces) zip.file(`assets/${ns}/font/glyph_sizes.bin`, widths)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const fileSlug = (name: string) =>
  name
    .replace(/§./g, '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'font-pack'

interface Props {
  base?: Files
  onError: (msg: string | null) => void
}

export function FontsTab({ base, onError }: Props) {
  const [pack, setPack] = useState<FontPack>(EMPTY_PACK)
  const [text, setText] = useState(SAMPLE)
  const [scale, setScale] = useState(3)
  const [shadow, setShadow] = useState(true)
  const [onlyPack, setOnlyPack] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [mirror, setMirror] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [mine, setMine] = useState<SavedVariant[]>([])
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const packInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const pageInput = useRef<HTMLInputElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  /** Пользователь уже что-то выбрал — вариант по умолчанию его не перебивает. */
  const touched = useRef(false)

  // Основа: встроенный шрифт клиента, поверх — подключённая на вкладке «Конвертер»
  const [builtinBase, setBuiltinBase] = useState<Files | null>(null)
  useEffect(() => {
    fetch('font-presets/base.zip')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then(async (buf) => setBuiltinBase((await readZip(new Blob([buf]), 'base')).files))
      .catch(() => setBuiltinBase(null))
  }, [])
  const baseFont = useMemo(() => {
    const a = builtinBase ? pagesFrom(builtinBase) : { pages: new Map<number, Uint8Array>(), glyphSizes: undefined }
    const b = base ? pagesFrom(base) : { pages: new Map<number, Uint8Array>(), glyphSizes: undefined }
    return { pages: new Map([...a.pages, ...b.pages]), glyphSizes: b.glyphSizes ?? a.glyphSizes }
  }, [base, builtinBase])

  // Встроенные варианты и сохранённые; при первом заходе открываем первый встроенный
  useEffect(() => {
    let alive = true
    ;(async () => {
      setMine(await listVariants())
      try {
        const list = (await (await fetch('font-presets/manifest.json')).json()) as Preset[]
        if (!alive) return
        setPresets(list)
        if (list[0] && !touched.current) await openPreset(list[0], true)
      } catch {
        /* без встроенных вариантов вкладка работает с файлами */
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Итоговые страницы: шрифт клиента, поверх — пак. */
  const pages = useMemo(() => {
    const m = new Map<number, { data: Uint8Array; origin: 'base' | 'pack' | 'added' }>()
    for (const [p, data] of baseFont.pages) m.set(p, { data, origin: 'base' })
    for (const [p, e] of pack.pages) m.set(p, e)
    return m
  }, [baseFont, pack.pages])

  const [bitmaps, setBitmaps] = useState<PageImages>(new Map())
  const [addedWidths, setAddedWidths] = useState<Map<number, Uint8Array>>(new Map())

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out: PageImages = new Map()
      const widths = new Map<number, Uint8Array>()
      for (const [p, e] of pages) {
        try {
          const bmp = await createImageBitmap(new Blob([e.data], { type: 'image/png' }))
          out.set(p, bmp)
          if (e.origin === 'added') widths.set(p, computeWidths(bmp))
        } catch {
          /* битая картинка — пропускаем */
        }
      }
      if (alive) {
        setBitmaps(out)
        setAddedWidths(widths)
      }
    })()
    return () => {
      alive = false
    }
  }, [pages])

  const widths = useMemo(() => {
    const w = new Uint8Array(65536)
    const start = pack.glyphSizes ?? baseFont.glyphSizes
    if (start) w.set(start.subarray(0, 65536))
    for (const [p, arr] of addedWidths) w.set(arr, p * 256)
    return w
  }, [pack.glyphSizes, baseFont.glyphSizes, addedWidths])

  const urls = useMemo(() => new Map([...pages].map(([p, e]) => [p, blobUrl(e.data)])), [pages])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const lines = text.split('\n')
    c.width = Math.max(320, Math.min(1400, Math.max(...lines.map((l) => l.length)) * 7 * scale + 8 * scale))
    c.height = (lines.length * 10 + 4) * scale
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    renderBitmapText(ctx, lines, { pages: bitmaps, widths, scale, shadow })
  }, [text, scale, shadow, bitmaps, widths])

  /** Открывает пак: готовый шрифт 1.12 — как есть, шрифт новых версий — с конвертацией. */
  async function openFiles(loaded: LoadedPack): Promise<FontPack> {
    const root = findRoot([...loaded.files.keys()])
    if (!isModernFont(loaded.files, root)) {
      const fp = readFontPack(loaded)
      if (fp.pages.size === 0 && !fp.glyphSizes) throw new Error('В паке нет страниц шрифта (unicode_page) и картинок шрифта новых версий.')
      return fp
    }
    let format: number | undefined
    try {
      const meta = loaded.files.get(root + 'pack.mcmeta')
      const pk = meta ? JSON.parse(new TextDecoder().decode(meta)).pack : undefined
      format = pk?.pack_format ?? pk?.max_format
    } catch {
      /* без pack.mcmeta */
    }
    const r = await convertModernFont(loaded.files, root, baseFont.pages, baseFont.glyphSizes)
    const extras = new Map<string, Uint8Array>()
    const icon = loaded.files.get(root + 'pack.png')
    if (icon) extras.set('pack.png', icon)
    if (r.ascii) {
      extras.set('assets/minecraft/textures/font/ascii.png', r.ascii)
      extras.set('assets/core_font_mod/textures/font/ascii.png', r.ascii)
    }
    return {
      name: loaded.name.replace(/§./g, '').trim(),
      pages: new Map([...r.pages].map(([p, data]) => [p, { data, origin: 'pack' as const }])),
      glyphSizes: r.glyphSizes,
      extras,
      converted: [`Сконвертировано из формата ${packFormatLabel(format)} в 1.12.2.`, ...r.notes],
    }
  }

  async function loadPack(task: () => Promise<LoadedPack | null>) {
    touched.current = true
    setBusy('Читаю пак…')
    onError(null)
    try {
      const loaded = await task()
      if (loaded) {
        setPack({ ...(await openFiles(loaded)), origin: undefined })
        setSelected(null)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Не удалось открыть шрифтовой пак.')
    } finally {
      setBusy(null)
    }
  }

  // Перетаскивание пака в окно, пока открыта эта вкладка
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.files.length) void loadPack(() => readDrop(e.dataTransfer!))
    }
    window.addEventListener('drop', onDrop)
    return () => window.removeEventListener('drop', onDrop)
  })

  async function openPreset(p: Preset, auto = false) {
    if (!auto) touched.current = true
    setBusy('Открываю вариант…')
    onError(null)
    try {
      const data = new Uint8Array(await (await fetch(`font-presets/${p.file}`)).arrayBuffer())
      const fp = readFontPack(await readZip(new Blob([data]), p.name))
      if (auto && touched.current) return
      setPack({ ...fp, name: p.name, origin: { kind: 'builtin', id: p.id } })
      setSelected(null)
    } catch {
      onError(`Не удалось открыть вариант «${p.name}».`)
    } finally {
      setBusy(null)
    }
  }

  async function openMine(v: SavedVariant) {
    touched.current = true
    const fp = readFontPack(await readZip(new Blob([v.zip]), v.name))
    setPack({ ...fp, name: v.name, origin: { kind: 'mine', id: v.id } })
    setSelected(null)
  }

  async function saveMine() {
    const id = pack.origin?.kind === 'mine' ? pack.origin.id : `v${Date.now()}`
    const zip = await buildZip(pack, widths, mirror)
    const ok = await saveVariant({ id, name: pack.name, zip, savedAt: Date.now() })
    if (!ok) {
      onError('Браузер не дал сохранить вариант (приватный режим?). Скачайте пак файлом.')
      return
    }
    setPack({ ...pack, origin: { kind: 'mine', id }, converted: undefined })
    setMine(await listVariants())
    setSavedNote(`Сохранено: «${pack.name}»`)
    setTimeout(() => setSavedNote(null), 2500)
  }

  async function removeMine(id: string) {
    await deleteVariant(id)
    setMine(await listVariants())
    if (pack.origin?.kind === 'mine' && pack.origin.id === id) setPack({ ...pack, origin: undefined })
  }

  async function replacePage(page: number, file: File) {
    const data = new Uint8Array(await file.arrayBuffer())
    try {
      const bmp = await createImageBitmap(new Blob([data]))
      if (bmp.width !== bmp.height || bmp.width % 16 !== 0) throw new Error('Страница должна быть квадратной, сторона кратна 16 (256, 512…).')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Это не PNG.')
      return
    }
    onError(null)
    const next = new Map(pack.pages)
    next.set(page, { data, origin: 'added' })
    setPack({ ...pack, pages: next })
  }

  function removePage(page: number) {
    const next = new Map(pack.pages)
    next.delete(page)
    setPack({ ...pack, pages: next })
  }

  async function exportPack() {
    setBusy('Собираю пак…')
    try {
      const data = await buildZip(pack, widths, mirror)
      saveBlob(new Blob([data], { type: 'application/zip' }), `${fileSlug(pack.name)}.zip`)
    } finally {
      setBusy(null)
    }
  }

  const glyphSource = pack.glyphSizes ? 'пака' : baseFont.glyphSizes ? 'шрифта клиента' : null
  const shownPages = [...pages.entries()].filter(([, e]) => !onlyPack || e.origin !== 'base').sort(([a], [b]) => a - b)
  const sel = selected !== null ? pages.get(selected) : undefined
  const canExport = pack.pages.size > 0 || pack.extras.size > 0

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Шрифты</h1>
          <p className="muted">
            Шрифты для 1.12.2: открыть готовый или сконвертировать шрифтовой пак новых версий, поправить страницы, посмотреть текст и собрать пак.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={exportPack} disabled={!canExport || !!busy}>
          <IconDownload /> Скачать шрифтовой пак
        </button>
      </div>

      {pack.converted && (
        <div className="notice">
          <strong>{pack.converted[0]}</strong> {pack.converted.slice(1).join(' ')}
        </div>
      )}

      <div className="page-body">
        <main className="main">
          <section className="section">
            <div className="section-head static">
              <h2>Предпросмотр</h2>
            </div>
            <div className="block font-preview">
              <div className="preview-controls">
                <span className="muted small">{pack.name}</span>
                <div className="row">
                  <div className="seg" aria-label="Масштаб">
                    {[2, 3, 4].map((s) => (
                      <button type="button" key={s} className={scale === s ? 'is-active' : ''} onClick={() => setScale(s)}>
                        ×{s}
                      </button>
                    ))}
                  </div>
                  <label className="check">
                    <input id="font-shadow" type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} />
                    <span>Тень</span>
                  </label>
                </div>
              </div>
              <div className="preview-canvas">
                <canvas ref={canvas} />
              </div>
              <textarea id="font-text" className="input mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Текст предпросмотра" />
              <p className="muted small">
                Рисуется как в клиенте: страницы unicode_page, ширины из glyph_sizes.bin, цвет текста умножается на цвет глифа. Красная рамка — символа
                нет. Чего нет в паке, берётся из шрифта клиента.
              </p>
            </div>
          </section>

          <section className="section">
            <div className="section-head static">
              <h2>Страницы</h2>
              <span className="section-count">{shownPages.length}</span>
              <label className="check head-check">
                <input id="only-pack" type="checkbox" checked={onlyPack} onChange={(e) => setOnlyPack(e.target.checked)} />
                <span>Только из пака</span>
              </label>
            </div>
            {shownPages.length === 0 ? (
              <div className="empty">В паке нет своих страниц — снимите «Только из пака», чтобы увидеть шрифт клиента.</div>
            ) : (
              <div className="page-grid">
                {shownPages.map(([p, e]) => (
                  <button type="button" key={p} className={`page-tile${selected === p ? ' is-selected' : ''}`} onClick={() => setSelected(p)}>
                    <span className="page-thumb">
                      <img src={urls.get(p)} alt="" loading="lazy" />
                    </span>
                    <span className="page-meta">
                      <span className="mono">U+{hex2(p).toUpperCase()}xx</span>
                      <span className={`label label-${e.origin === 'base' ? 'unknown' : e.origin === 'added' ? 'renamed' : 'converted'}`}>
                        {e.origin === 'base' ? 'Клиент' : e.origin === 'added' ? 'Заменена' : 'Пак'}
                      </span>
                    </span>
                    <span className="page-name">{pageName(p) || ' '}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="side">
          <section className="side-block">
            <h3 className="side-title">Варианты</h3>
            <ul className="variants">
              {presets.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`variant${pack.origin?.kind === 'builtin' && pack.origin.id === p.id ? ' is-active' : ''}`}
                    onClick={() => void openPreset(p)}
                    disabled={!!busy}
                  >
                    <span className="variant-name">{p.name}</span>
                    <span className="variant-desc">{p.description}</span>
                  </button>
                </li>
              ))}
              {mine.length > 0 && <li className="variants-sep">Мои</li>}
              {mine.map((v) => (
                <li key={v.id} className="variant-mine">
                  <button
                    type="button"
                    className={`variant${pack.origin?.kind === 'mine' && pack.origin.id === v.id ? ' is-active' : ''}`}
                    onClick={() => void openMine(v)}
                  >
                    <span className="variant-name">{v.name}</span>
                    <span className="variant-desc">{new Date(v.savedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </button>
                  <button type="button" className="variant-del" onClick={() => void removeMine(v.id)} aria-label={`Удалить «${v.name}»`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="side-foot">
              {savedNote ?? (pack.origin?.kind === 'builtin' ? 'Правки встроенного варианта сохраняются как ваш вариант.' : 'Варианты хранятся в этом браузере.')}
            </div>
          </section>

          <section className="side-block">
            <h3 className="side-title">Открыть или сконвертировать</h3>
            <div className="side-body">
              <p className="muted small">
                Шрифтовой пак 1.12 откроется как есть, пак новых версий (ascii.png, nonlatin_european.png, font/*.json) сконвертируется в 1.12.2. Можно
                перетащить в окно.
              </p>
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => packInput.current?.click()} disabled={!!busy}>
                  <IconUpload /> .zip
                </button>
                <button type="button" className="btn btn-sm" onClick={() => dirInput.current?.click()} disabled={!!busy}>
                  <IconFolder /> Папка
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPack(EMPTY_PACK)}>
                  Новый
                </button>
              </div>
              {busy && <p className="muted small">{busy}</p>}
            </div>
          </section>

          <section className="side-block">
            <h3 className="side-title">Пак</h3>
            <div className="side-body">
              <input id="font-pack-name" className="input" value={pack.name} onChange={(e) => setPack({ ...pack, name: e.target.value })} aria-label="Название пака" />
              <p className="muted small">Своих страниц: {pack.pages.size}.</p>
              <button type="button" className="btn btn-sm" onClick={() => void saveMine()} disabled={!canExport}>
                {pack.origin?.kind === 'mine' ? 'Сохранить изменения' : 'Сохранить как мой вариант'}
              </button>
              {pack.pages.size > 0 &&
                (glyphSource ? (
                  <p className="note note-info small">
                    <IconInfo width={14} height={14} />
                    <span>Ширины символов — из {glyphSource}; у заменённых страниц пересчитываются по картинке.</span>
                  </p>
                ) : (
                  <p className="note note-warn small">
                    <IconWarn width={14} height={14} />
                    <span>Нет glyph_sizes.bin — подключите основу на вкладке «Конвертер».</span>
                  </p>
                ))}
              <label className="check">
                <input id="font-mirror" type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                <span>Дублировать в minecraft (на случай ванильного рендера)</span>
              </label>
            </div>
          </section>
        </aside>
      </div>

      {sel && selected !== null && (
        <>
          <div className="scrim" onClick={() => setSelected(null)} />
          <aside className="detail" aria-label="Страница шрифта">
            <header className="detail-head">
              <div className="detail-title">
                <span className="mono muted small">
                  U+{hex2(selected).toUpperCase()}00 – U+{hex2(selected).toUpperCase()}FF
                </span>
                <h2>
                  unicode_page_{hex2(selected)}
                  {pageName(selected) ? ` · ${pageName(selected)}` : ''}
                </h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelected(null)} aria-label="Закрыть">
                <IconClose />
              </button>
            </header>
            <div className="detail-scroll">
              <div className="glyph-grid" onMouseLeave={() => setHover(null)}>
                <img src={urls.get(selected)} alt="" />
                <div className="glyph-cells">
                  {Array.from({ length: 256 }, (_, i) => (
                    <span key={i} onMouseEnter={() => setHover(selected * 256 + i)} className={widths[selected * 256 + i] ? '' : 'is-empty'} />
                  ))}
                </div>
              </div>
              <p className="mono small glyph-info">
                {hover !== null
                  ? `U+${hover.toString(16).toUpperCase().padStart(4, '0')}  «${String.fromCharCode(hover)}»  ширина ${
                      widths[hover] ? ((widths[hover] & 15) + 1 - (widths[hover] >> 4)) / 2 + 1 : 0
                    } px`
                  : 'Наведите на символ'}
              </p>
              <div className="editor-actions">
                <button type="button" className="btn btn-primary" onClick={() => pageInput.current?.click()}>
                  Заменить PNG
                </button>
                <button type="button" className="btn" onClick={() => saveBlob(new Blob([sel.data], { type: 'image/png' }), `unicode_page_${hex2(selected)}.png`)}>
                  Скачать PNG
                </button>
                {sel.origin !== 'base' && (
                  <button type="button" className="btn btn-ghost" onClick={() => removePage(selected)}>
                    Убрать из пака
                  </button>
                )}
              </div>
              <p className="muted small">
                Своя страница: квадратная PNG 256×256 (или 512, 1024…), сетка 16×16, символ U+{hex2(selected).toUpperCase()}XY — в столбце X, строке Y.
                Белые глифы получают цвет текста, цветные им тонируются.
              </p>
            </div>
          </aside>
        </>
      )}

      <input
        ref={packInput}
        id="font-pack-input"
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          const l = e.target.files
          if (l) void loadPack(() => readFileList(l))
          e.target.value = ''
        }}
      />
      <input
        ref={dirInput}
        id="font-dir-input"
        type="file"
        hidden
        // @ts-expect-error — нестандартный атрибут выбора папки
        webkitdirectory=""
        onChange={(e) => {
          const l = e.target.files
          if (l) void loadPack(() => readFileList(l))
          e.target.value = ''
        }}
      />
      <input
        ref={pageInput}
        id="font-page-input"
        type="file"
        accept=".png"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && selected !== null) void replacePage(selected, f)
          e.target.value = ''
        }}
      />
    </>
  )
}
