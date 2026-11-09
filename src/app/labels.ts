import type { Group, Status } from '../core/types'

export const STATUS: Record<Status, { label: string; hint: string }> = {
  renamed: { label: 'Переименовано', hint: 'Имя или путь изменены под 1.12.2' },
  same: { label: 'Как есть', hint: 'Путь подходит для 1.12.2 без изменений' },
  converted: { label: 'Переписано', hint: 'Содержимое файла переделано под 1.12.2' },
  unknown: { label: 'Не сопоставлено', hint: 'Готового соответствия нет в индексе. Это не исключает загрузку файла через модель или мод' },
  skipped: { label: 'Пропущено', hint: 'Файл не переносится' },
}

export const STATUS_ORDER: Status[] = ['renamed', 'same', 'converted', 'unknown', 'skipped']

export const GROUPS: { id: Group | 'all'; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'blocks', label: 'Блоки' },
  { id: 'items', label: 'Предметы' },
  { id: 'entity', label: 'Сущности' },
  { id: 'models', label: 'Модели' },
  { id: 'blockstates', label: 'Блокстейты' },
  { id: 'other', label: 'Прочее' },
]
