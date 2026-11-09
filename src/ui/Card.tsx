import { memo } from 'react'
import type { PlanEntry } from '../core/types'
import { STATUS } from '../app/labels'
import { IconWarn } from './icons'

const T = 'assets/minecraft/textures/'

export function shortTarget(path: string): string {
  if (path.startsWith(T)) return path.slice(T.length).replace(/\.png$/, '')
  return path.replace(/^assets\/minecraft\//, '')
}

export function shortSource(entry: PlanEntry, root: string): string {
  if (entry.texture) return entry.texture
  return entry.source.slice(root.length).replace(/^assets\/minecraft\//, '')
}

function glyph(entry: PlanEntry): string {
  const s = entry.source
  if (s.endsWith('.json')) return '{ }'
  if (s.endsWith('.lang')) return 'Aa'
  if (s.endsWith('.properties')) return '=_'
  if (s.endsWith('.mcmeta')) return '▶'
  if (s.endsWith('.ogg')) return '♪'
  return '·'
}

interface Props {
  entry: PlanEntry
  root: string
  thumb?: string
  selected: boolean
  onSelect: (source: string) => void
}

/** Строка файла — по образцу строки раздела на форуме. */
export const Card = memo(function Card({ entry, root, thumb, selected, onSelect }: Props) {
  const from = shortSource(entry, root)
  const name = from.split('/').pop()!
  const to = entry.targets.map(shortTarget)
  const warns = entry.notes.filter((n) => n.level === 'warn').length
  const changed = to.length > 0 && !(to.length === 1 && to[0] === from)

  return (
    <button
      type="button"
      className={`file-row status-${entry.status}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(entry.source)}
      title={STATUS[entry.status].hint}
    >
      <span className="file-thumb">
        {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : <span className="file-glyph">{glyph(entry)}</span>}
      </span>
      <span className="file-main">
        <span className="file-title">
          <span className="file-name">{name}</span>
          {entry.manual && <span className="label label-info">{entry.manual === 'preset' ? 'Пресет' : 'Вручную'}</span>}
        </span>
        <span className="file-desc">
          {changed ? (
            <>
              <span className="file-from">{from}</span>
              <span className="arrow"> → </span>
              {to[0]}
              {to.length > 1 && <span className="more"> +{to.length - 1}</span>}
            </>
          ) : entry.status === 'skipped' ? (
            <>{from} · не переносится</>
          ) : (
            from
          )}
        </span>
      </span>
      <span className="file-stat">
        <span className="file-stat-label">Файлов</span>
        <span className="file-stat-num">{entry.targets.length}</span>
      </span>
      <span className="file-status">
        <span className={`label label-${entry.status}`}>{STATUS[entry.status].label}</span>
        {warns > 0 && (
          <span className="file-warn" aria-label={`Предупреждений: ${warns}`}>
            <IconWarn width={14} height={14} />
            {warns}
          </span>
        )}
      </span>
    </button>
  )
})
