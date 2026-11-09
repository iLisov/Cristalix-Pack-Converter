import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadIndex } from './core/client-index'
import { buildPack, findRoot, planPack, type Files } from './core/convert'
import { packFormatLabel } from './core/mappings'
import type { ConvertOptions, Group, Overrides, PlanEntry, Preset, Status } from './core/types'
import { buildDemoPack } from './app/demo'
import { browserImageOps } from './app/images'
import { GROUPS, STATUS, STATUS_ORDER } from './app/labels'
import { loadOptions, loadPreset, parsePreset, saveOptions, savePreset } from './app/presets'
import { readDrop, readFileList, readZip, saveBlob, writeZip, type LoadedPack } from './app/zipio'
import { Card } from './ui/Card'
import { Detail } from './ui/Detail'
import { FontsTab } from './ui/FontsTab'
import { Select, type Option } from './ui/Select'
import { IconChevron, IconDownload, IconFolder, IconGithub, IconSearch, IconUpload } from './ui/icons'
import logoUrl from './assets/logo.svg'

const INDEX = loadIndex()
const KNOWN_TEXTURES = [...INDEX.textures]
const PAGE = 60
const REPO = 'https://github.com/iLisov/Cristalix-Pack-Converter'
const CONVERTER_BUILD = '2026.11.08-10'
const RESOLUTIONS: Option<ConvertOptions['maxResolution']>[] = [
  { value: 0, label: 'Как в паке', hint: 'без изменений' },
  { value: 16, label: 'До 16×', hint: 'ванильное' },
  { value: 32, label: 'До 32×' },
  { value: 64, label: 'До 64×' },
  { value: 128, label: 'До 128×' },
]
const SECTIONS = GROUPS.filter((g) => g.id !== 'all') as { id: Group; label: string }[]

type Source = LoadedPack & { demo: boolean }

/** Основа: оставляем только ассеты и приводим пути к виду assets/minecraft/… */
function normalizeBase(files: Files): Files {
  const root = findRoot([...files.keys()])
  const out: Files = new Map()
  for (const [path, data] of files) {
    if (path.startsWith(root + 'assets/')) out.set(path.slice(root.length), data)
  }
  return out
}

type Tab = 'converter' | 'fonts'
const tabFromHash = (): Tab => (location.hash === '#fonts' ? 'fonts' : 'converter')

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  useEffect(() => {
    const on = () => setTab(tabFromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const [source, setSource] = useState<Source | null>(null)
  const [loading, setLoading] = useState<string | null>('Готовлю пример…')
  const [error, setError] = useState<string | null>(null)
  const [options, setOptionsState] = useState<ConvertOptions>(loadOptions)
  const [preset, setPresetState] = useState<Preset>(loadPreset)
  const [overrides, setOverrides] = useState<Overrides>({})
  const [statusFilter, setStatusFilter] = useState<Status | 'warn' | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [collapsed, setCollapsed] = useState<Set<Group>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const zipInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const presetInput = useRef<HTMLInputElement>(null)
  const baseInput = useRef<HTMLInputElement>(null)
  const [base, setBase] = useState<{ name: string; files: Files } | null>(null)
  const [baseLoading, setBaseLoading] = useState(false)

  const setOptions = (patch: Partial<ConvertOptions>) =>
    setOptionsState((o) => {
      const next = { ...o, ...patch }
      saveOptions(next)
      return next
    })
  const setPreset = (next: Preset) => {
    setPresetState(next)
    savePreset(next)
  }

  const open = useCallback((pack: LoadedPack, demo = false) => {
    setSource({ ...pack, demo })
    setOverrides({})
    setSelected(null)
    setStatusFilter(null)
    setQuery('')
    setLimits({})
    setError(null)
  }, [])

  useEffect(() => {
    buildDemoPack()
      .then((p) => open(p, true))
      .finally(() => setLoading(null))
  }, [open])

  async function load(task: () => Promise<LoadedPack | null>) {
    setLoading('Читаю пак…')
    setError(null)
    try {
      const pack = await task()
      if (pack) {
        if (pack.files.size === 0) throw new Error('Архив пустой.')
        open(pack)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать файл.')
    } finally {
      setLoading(null)
    }
  }

  // Перетаскивание в любое место окна
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      // на вкладке «Шрифты» пак открывает она сама
      if (e.dataTransfer && location.hash !== '#fonts') void load(() => readDrop(e.dataTransfer!))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const plan = useMemo(
    () => (source ? planPack({ files: source.files, index: INDEX, options, preset, overrides, base: base?.files }) : null),
    [source, options, preset, overrides, base, CONVERTER_BUILD, planPack, INDEX],
  )

  // Миниатюры: blob-URL на каждую PNG пака, освобождаем при смене пака
  const thumbs = useMemo(() => {
    const map = new Map<string, string>()
    if (!source) return map
    for (const [path, data] of source.files) {
      if (path.endsWith('.png')) map.set(path, URL.createObjectURL(new Blob([data], { type: 'image/png' })))
    }
    return map
  }, [source])
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs])

  const counts = useMemo(() => {
    const c: Record<string, number> = { warn: 0 }
    for (const s of STATUS_ORDER) c[s] = 0
    for (const e of plan?.entries ?? []) {
      c[e.status]++
      if (e.notes.some((n) => n.level === 'warn')) c.warn++
    }
    return c
  }, [plan])

  const sections = useMemo(() => {
    const by = new Map<Group, PlanEntry[]>()
    if (!plan) return by
    const q = query.trim().toLowerCase()
    for (const e of plan.entries) {
      if (statusFilter === 'warn' && !e.notes.some((n) => n.level === 'warn')) continue
      if (statusFilter && statusFilter !== 'warn' && e.status !== statusFilter) continue
      if (q && !e.source.toLowerCase().includes(q) && !e.targets.some((t) => t.toLowerCase().includes(q))) continue
      const list = by.get(e.group) ?? []
      list.push(e)
      by.set(e.group, list)
    }
    return by
  }, [plan, statusFilter, query])

  const shown = [...sections.values()].reduce((n, l) => n + l.length, 0)
  const selectedEntry = plan?.entries.find((e) => e.source === selected) ?? null
  const packPng = source && plan ? thumbs.get(plan.root + 'pack.png') : undefined
  const outputCount = plan?.entries.reduce((n, e) => n + e.targets.length, 0) ?? 0
  const presetCount = Object.keys(preset.textures).length

  async function download() {
    if (!plan || !source) return
    setProgress(0)
    setError(null)
    try {
      const out = await buildPack(plan, source.files, browserImageOps, (d, t) => setProgress(d / t), base?.files)
      out.set('converter-info.json', JSON.stringify({ build: CONVERTER_BUILD, source: source.name, sourceFormat: plan.packFormat,
        options, base: base?.name ?? null, preset: preset.name, presetRules: Object.keys(preset.textures).length,
        manualOverrides: Object.keys(overrides).length }, null, 2))
      const blob = await writeZip(out)
      saveBlob(blob, `${source.name}-1.12.2-build${CONVERTER_BUILD.slice(-2)}.zip`)
    } catch (e) {
      setError(e instanceof Error ? `Сборка не удалась: ${e.message}` : 'Сборка не удалась.')
    } finally {
      setProgress(null)
    }
  }

  async function loadBase(list: File[]) {
    setBaseLoading(true)
    setError(null)
    try {
      const merged: Files = new Map(base?.files ?? [])
      const names = base ? [base.name] : []
      for (const file of list) {
        const pack = await readZip(file, file.name)
        for (const [k, v] of normalizeBase(pack.files)) merged.set(k, v)
        names.push(pack.name)
      }
      setBase({ name: names.join(' + '), files: merged })
    } catch (e) {
      setError(e instanceof Error ? `Не удалось подключить основу: ${e.message}` : 'Не удалось подключить основу.')
    } finally {
      setBaseLoading(false)
    }
  }

  async function importPreset(file: File) {
    try {
      setPreset(parsePreset(await file.text()))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать пресет.')
    }
  }

  function exportPreset() {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' })
    const slug = preset.name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') || 'preset'
    saveBlob(blob, `${slug}.json`)
  }

  function toggleSection(id: Group) {
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const downloadLabel = progress !== null ? `Собираю… ${Math.round(progress * 100)}%` : 'Скачать пак для 1.12.2'

  return (
    <div className="app">
      <header className="site-head">
        <div className="head-main">
          <a className="logo" href="./" aria-label="Cristalix Pack Converter">
            <img src={logoUrl} alt="CRISTALIX" width={174} height={28} />
          </a>
          <nav className="head-nav" aria-label="Разделы">
            <span className="muted small" title={CONVERTER_BUILD}>Сборка {CONVERTER_BUILD.slice(-2)}</span>
            <a className={`nav-link${tab === 'converter' ? ' is-active' : ''}`} href="#converter">
              Конвертер
            </a>
            <a className={`nav-link${tab === 'fonts' ? ' is-active' : ''}`} href="#fonts">
              Шрифты
            </a>
            <a className="nav-link" href={REPO} target="_blank" rel="noreferrer">
              Исходный код
            </a>
          </nav>
          <div className="head-actions">
            <button type="button" className="head-action" onClick={() => zipInput.current?.click()}>
              <IconUpload /> <span className="hide-sm">Открыть .zip</span>
            </button>
            <button type="button" className="head-action" onClick={() => dirInput.current?.click()}>
              <IconFolder /> <span className="hide-sm">Открыть папку</span>
            </button>
            <label className="search head-search" htmlFor="search">
              <IconSearch />
              <input id="search" type="search" placeholder="Поиск по пути…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
        </div>
        {tab === 'converter' && plan && source && (
          <div className="head-sub">
            <span className="sub-pack">
              {packPng && <img src={packPng} alt="" />}
              <strong>{source.name}</strong>
            </span>
            <span className="sub-sep" />
            <span>
              {packFormatLabel(plan.packFormat)} <span className="arrow">→</span> 1.12.2
            </span>
            <span className="sub-sep" />
            <span className="mono">
              pack_format {plan.packFormat ?? '—'} → 3
            </span>
          </div>
        )}
        <input
          ref={zipInput}
          id="zip-input"
          type="file"
          accept=".zip,.jar"
          hidden
          onChange={(e) => {
            const list = e.target.files
            if (list) void load(() => readFileList(list))
            e.target.value = ''
          }}
        />
        <input
          ref={dirInput}
          id="dir-input"
          type="file"
          hidden
          // @ts-expect-error — нестандартный атрибут выбора папки
          webkitdirectory=""
          onChange={(e) => {
            const list = e.target.files
            if (list) void load(() => readFileList(list))
            e.target.value = ''
          }}
        />
      </header>

      <div className="page">
        {tab === 'fonts' ? (
          <FontsTab base={base?.files} onError={setError} />
        ) : (
        <>
        <div className="page-title">
          <div>
            <h1>Конвертер ресурспаков</h1>
            <p className="muted">Переносит паки с 1.13 и новее на 1.12.2: имена текстур, модели, блокстейты, картины, броню.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={download} disabled={!plan || progress !== null}>
            <IconDownload /> {downloadLabel}
          </button>
        </div>

        {source?.demo && (
          <div className="notice">
            <strong>Это пример пака.</strong> Перетащите свой .zip или папку в окно, или нажмите «Открыть .zip».
          </div>
        )}
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        {progress !== null && (
          <div className="bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        <div className="page-body">
          <main className="main">
            {statusFilter && (
              <div className="filter-chip">
                Показаны: {statusFilter === 'warn' ? 'с предупреждениями' : STATUS[statusFilter].label.toLowerCase()}
                <button type="button" onClick={() => setStatusFilter(null)} aria-label="Сбросить фильтр">
                  ×
                </button>
              </div>
            )}

            {loading && !plan ? (
              <div className="empty">{loading}</div>
            ) : shown === 0 ? (
              <div className="empty">Ничего не найдено.</div>
            ) : (
              SECTIONS.map(({ id, label }) => {
                const list = sections.get(id)
                if (!list?.length) return null
                const isCollapsed = collapsed.has(id)
                const limit = limits[id] ?? PAGE
                return (
                  <section key={id} className="section">
                    <button type="button" className="section-head" onClick={() => toggleSection(id)} aria-expanded={!isCollapsed}>
                      <h2>{label}</h2>
                      <span className="section-count">{list.length}</span>
                      <IconChevron className={`chevron${isCollapsed ? ' is-collapsed' : ''}`} />
                    </button>
                    {!isCollapsed && (
                      <div className="block">
                        {list.slice(0, limit).map((e) => (
                          <Card
                            key={e.source}
                            entry={e}
                            root={plan!.root}
                            thumb={thumbs.get(e.source)}
                            selected={e.source === selected}
                            onSelect={setSelected}
                          />
                        ))}
                        {list.length > limit && (
                          <button type="button" className="block-more" onClick={() => setLimits({ ...limits, [id]: limit + PAGE * 2 })}>
                            Показать ещё {Math.min(PAGE * 2, list.length - limit)} из {list.length - limit}
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                )
              })
            )}
          </main>

          <aside className="side">
            <section className="side-block">
              <h3 className="side-title">Итог</h3>
              <ul className="stats">
                {STATUS_ORDER.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className={`stat${statusFilter === s ? ' is-active' : ''}`}
                      onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                      title={STATUS[s].hint}
                    >
                      <span className={`dot dot-${s}`} />
                      <span className="stat-label">{STATUS[s].label}</span>
                      <span className="stat-num">{counts[s]}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className={`stat${statusFilter === 'warn' ? ' is-active' : ''}`}
                    onClick={() => setStatusFilter(statusFilter === 'warn' ? null : 'warn')}
                  >
                    <span className="dot dot-warn" />
                    <span className="stat-label">С предупреждениями</span>
                    <span className="stat-num">{counts.warn}</span>
                  </button>
                </li>
              </ul>
              <div className="side-foot">Файлов в архиве: {outputCount}</div>
            </section>

            <section className="side-block">
              <h3 className="side-title">Настройки</h3>
              <div className="side-body">
                <div className="field">
                  <label htmlFor="opt-res">Разрешение блоков и предметов</label>
                  <Select
                    id="opt-res"
                    value={options.maxResolution}
                    onChange={(v) => setOptions({ maxResolution: v })}
                    options={RESOLUTIONS}
                  />
                </div>
                <label className="check">
                  <input id="opt-unknown" type="checkbox" checked={options.keepUnknown} onChange={(e) => setOptions({ keepUnknown: e.target.checked })} />
                  <span>Оставлять неизвестные файлы</span>
                </label>
                <label className="check">
                  <input id="opt-lang" type="checkbox" checked={options.convertLang} onChange={(e) => setOptions({ convertLang: e.target.checked })} />
                  <span>Переводить lang в .lang</span>
                </label>
              </div>
            </section>

            <section className="side-block">
              <h3 className="side-title">Основа 1.12</h3>
              <div className="side-body">
                <p className="muted small">
                  {base
                    ? `Подключено: ${base.name}. Атласы GUI берут из неё всё, чего нет в паке.`
                    : 'Основа GUI 1.12 уже встроена. Можно подключить jar-файлы клиента или ресурспак 1.12 для своей основы и ширин символов шрифта.'}
                </p>
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => baseInput.current?.click()} disabled={baseLoading}>
                    {baseLoading ? 'Читаю…' : base ? 'Добавить ещё' : 'Подключить'}
                  </button>
                  {base && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBase(null)}>
                      Отключить
                    </button>
                  )}
                </div>
                <input
                  ref={baseInput}
                  id="base-input"
                  type="file"
                  accept=".jar,.zip"
                  multiple
                  hidden
                  onChange={(e) => {
                    const list = [...(e.target.files ?? [])]
                    if (list.length) void loadBase(list)
                    e.target.value = ''
                  }}
                />
              </div>
            </section>

            <section className="side-block">
              <h3 className="side-title">Пресет</h3>
              <div className="side-body">
                <input
                  id="preset-name"
                  className="input"
                  value={preset.name}
                  onChange={(e) => setPreset({ ...preset, name: e.target.value })}
                  aria-label="Название пресета"
                />
                <p className="muted small">
                  {presetCount === 0
                    ? 'Правил пока нет. Откройте файл и отметьте «Сохранить как правило пресета».'
                    : `Правил: ${presetCount}. Пресет хранится в браузере, им можно поделиться файлом.`}
                </p>
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={exportPreset} disabled={presetCount === 0}>
                    Экспорт
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => presetInput.current?.click()}>
                    Импорт
                  </button>
                  {presetCount > 0 &&
                    (confirmClear ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          setPreset({ ...preset, textures: {} })
                          setConfirmClear(false)
                        }}
                        onBlur={() => setConfirmClear(false)}
                      >
                        Точно очистить?
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmClear(true)}>
                        Очистить
                      </button>
                    ))}
                </div>
                <input
                  ref={presetInput}
                  id="preset-input"
                  type="file"
                  accept=".json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void importPreset(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </section>

            <p className="side-note muted small">Пак обрабатывается на вашем компьютере и никуда не загружается.</p>
          </aside>
        </div>
        </>
        )}
      </div>

      <footer className="site-foot">
        <span>Cristalix Pack Converter</span>
        <a href={REPO} target="_blank" rel="noreferrer">
          <IconGithub width={16} height={16} /> GitHub
        </a>
      </footer>

      {selectedEntry && plan && source && (
        <>
          <div className="scrim" onClick={() => setSelected(null)} />
          <Detail
            entry={selectedEntry}
            root={plan.root}
            files={source.files}
            base={base?.files}
            thumb={thumbs.get(selectedEntry.source)}
            knownTextures={KNOWN_TEXTURES}
            presetRule={selectedEntry.texture ? preset.textures[selectedEntry.texture] : undefined}
            onClose={() => setSelected(null)}
            onOverride={(src, value) =>
              setOverrides((o) => {
                const next = { ...o }
                if (value) next[src] = value
                else delete next[src]
                return next
              })
            }
            onPresetRule={(texture, targets) => {
              const textures = { ...preset.textures }
              if (targets) textures[texture] = targets
              else delete textures[texture]
              setPreset({ ...preset, textures })
              setOverrides((o) => {
                const next = { ...o }
                delete next[selectedEntry.source]
                return next
              })
            }}
          />
        </>
      )}

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div>
            <IconUpload width={40} height={40} />
            <strong>Отпустите, чтобы открыть пак</strong>
            <span>.zip или папка ресурспака</span>
          </div>
        </div>
      )}
      {loading && plan && <div className="toast">{loading}</div>}
    </div>
  )
}
