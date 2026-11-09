import { useEffect, useMemo, useState } from 'react'
import { BASE_PREFIX, composeAtlas, type Files } from '../core/convert'
import { guiBaseAsset } from '../core/gui'
import type { PlanEntry } from '../core/types'
import { STATUS } from '../app/labels'
import { browserImageOps } from '../app/images'
import { shortSource, shortTarget } from './Card'
import { IconArrow, IconClose, IconInfo, IconWarn } from './icons'

const T = 'assets/minecraft/textures/'
const decoder = new TextDecoder()
const TEXT_EXT = /\.(json|mcmeta|properties|lang|txt)$/

interface Props {
  entry: PlanEntry
  root: string
  files: Files
  base?: Files
  thumb?: string
  knownTextures: string[]
  presetRule?: string[]
  onClose: () => void
  onOverride: (source: string, value: { targets: string[] } | { exclude: true } | null) => void
  onPresetRule: (texture: string, targets: string[] | null) => void
}

function useAtlasPreview(entry: PlanEntry, files: Files, base?: Files): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const t = entry.transform
    setUrl(undefined)
    if (t.type !== 'compose') return
    let alive = true
    let made: string | undefined
    ;(async () => {
      const baseData = t.base ? (t.base.startsWith(BASE_PREFIX) ? guiBaseAsset(t.base.slice(BASE_PREFIX.length), base) : files.get(t.base)) : undefined
      const png = await composeAtlas(t.size, baseData, t.parts, files, browserImageOps, t.scale)
      made = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      if (alive) setUrl(made)
    })()
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [entry, files, base])
  return url
}

export function Detail({ entry, root, files, base, thumb, knownTextures, presetRule, onClose, onOverride, onPresetRule }: Props) {
  const isTexture = !!entry.texture && entry.transform.type !== 'compose' && entry.source.endsWith('.png')
  const atlas = useAtlasPreview(entry, files, base)
  const image = atlas ?? thumb
  const [size, setSize] = useState<string>()
  const [draft, setDraft] = useState('')
  const [toPreset, setToPreset] = useState(false)

  useEffect(() => {
    setDraft(entry.targets.map(shortTarget).join('\n'))
    setSize(undefined)
    setToPreset(false)
  }, [entry])

  const before = useMemo(() => {
    if (!TEXT_EXT.test(entry.source)) return null
    const data = files.get(entry.source)
    return data ? decoder.decode(data) : null
  }, [entry, files])
  const after = entry.transform.type === 'text' ? entry.transform.text : null

  const lastLine = draft.split('\n').pop() ?? ''
  const suggestions = useMemo(() => {
    const q = lastLine.trim().toLowerCase()
    if (q.length < 2) return []
    return knownTextures.filter((t) => t.includes(q)).slice(0, 60)
  }, [lastLine, knownTextures])

  const parsedDraft = draft
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/\.png$/, '').replace(/^assets\/minecraft\/textures\//, ''))
    .filter(Boolean)

  function apply() {
    if (parsedDraft.length === 0) return
    if (toPreset && entry.texture) onPresetRule(entry.texture, parsedDraft)
    else onOverride(entry.source, { targets: parsedDraft.map((t) => `${T}${t}.png`) })
  }

  function exclude() {
    if (toPreset && entry.texture) onPresetRule(entry.texture, [])
    else onOverride(entry.source, { exclude: true })
  }

  const unknownDraft = parsedDraft.filter((t) => !knownTextures.includes(t))

  return (
    <aside className="detail" aria-label="Подробности файла">
      <header className="detail-head">
        <div className="detail-title">
          <span className={`label label-${entry.status}`}>{STATUS[entry.status].label}</span>
          <h2>{shortSource(entry, root).split('/').pop()}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>
      </header>

      <div className="detail-scroll">
        {image && (
          <figure className="preview">
            <div className="preview-frame">
              <img
                src={image}
                alt=""
                onLoad={(e) => setSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
              />
            </div>
            {size && <figcaption>{size} px</figcaption>}
          </figure>
        )}

        <section className="paths">
          <div className="path-row">
            <span className="path-label">Из пака</span>
            <code>{entry.source.slice(root.length)}</code>
          </div>
          <div className="path-arrow">
            <IconArrow />
          </div>
          <div className="path-row">
            <span className="path-label">В пак 1.12.2</span>
            {entry.targets.length > 0 ? (
              entry.targets.map((t) => <code key={t}>{t}</code>)
            ) : (
              <span className="muted">Не переносится</span>
            )}
          </div>
        </section>

        {entry.notes.length > 0 && (
          <ul className="notes">
            {entry.notes.map((n, i) => (
              <li key={i} className={`note note-${n.level}`}>
                {n.level === 'warn' ? <IconWarn width={16} height={16} /> : <IconInfo width={16} height={16} />}
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        )}

        {isTexture && (
          <section className="editor">
            <h3>Куда положить</h3>
            <p className="muted small">Путь внутри textures/, без .png. Несколько путей — с новой строки.</p>
            <textarea
              id="target-draft"
              rows={Math.max(2, draft.split('\n').length)}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            {suggestions.length > 0 && (
              <div className="suggest" role="listbox" aria-label="Известные текстуры">
                {suggestions.map((s) => (
                  <button
                    type="button"
                    key={s}
                    role="option"
                    aria-selected={false}
                    onClick={() => setDraft([...draft.split('\n').slice(0, -1), s].join('\n'))}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {unknownDraft.length > 0 && (
              <p className="note note-warn small">
                <IconWarn width={14} height={14} />
                <span>Нет в индексе клиента: {unknownDraft.join(', ')}. Дополнительные текстуры могут использоваться моделями.</span>
              </p>
            )}
            <label className="check">
              <input id="to-preset" type="checkbox" checked={toPreset} onChange={(e) => setToPreset(e.target.checked)} />
              <span>
                Сохранить как правило пресета
                <span className="muted small"> — будет применяться к «{entry.texture}» в любом паке</span>
              </span>
            </label>
            <div className="editor-actions">
              <button type="button" className="btn btn-primary" onClick={apply} disabled={parsedDraft.length === 0}>
                Применить
              </button>
              <button type="button" className="btn" onClick={exclude}>
                Исключить
              </button>
              {entry.manual === 'override' && (
                <button type="button" className="btn btn-ghost" onClick={() => onOverride(entry.source, null)}>
                  Сбросить правку
                </button>
              )}
              {presetRule && entry.texture && (
                <button type="button" className="btn btn-ghost" onClick={() => onPresetRule(entry.texture!, null)}>
                  Убрать из пресета
                </button>
              )}
            </div>
          </section>
        )}

        {after !== null && (
          <section className="diff">
            {before !== null && (
              <div>
                <h3>Было</h3>
                <pre>{before}</pre>
              </div>
            )}
            <div>
              <h3>Стало</h3>
              <pre>{after || '—'}</pre>
            </div>
          </section>
        )}
      </div>
    </aside>
  )
}
