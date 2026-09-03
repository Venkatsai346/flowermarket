import { RotateCcw, Search } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import Button from './Button.jsx';
import { Input, Select } from './Field.jsx';

/**
 * Shared searchable filter row: text search + optional status select +
 * optional date range + optional actions.
 *
 * Callers own the state; the component only renders controlled primitives.
 * `onChange` handlers should reset pagination in the owning page.
 */
export default function FilterBar({
  search = '',
  onSearch,
  searchPlaceholder = 'Search…',
  status = '',
  statusOptions = [],
  onStatus,
  statusLabel = 'Status',
  selects = [],
  from = '',
  to = '',
  onFrom,
  onTo,
  onReset,
  actions,
  className,
}) {
  const canReset = onReset && (search || status || from || to || selects.some((s) => s.value));

  return (
    <div className={cn('flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3', className)}>
      {onSearch && (
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9!"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      )}

      {selects.map((s) => (
        <Select className={s.className || 'w-48!'} key={s.label} value={s.value} onChange={(e) => s.onChange?.(e.target.value)} aria-label={s.label}>
          <option value="">All {s.label.toLowerCase()}</option>
          {s.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      ))}

      {!selects.length && statusOptions.length > 0 && (
        <Select className="w-48!" value={status} onChange={(e) => onStatus?.(e.target.value)} aria-label={statusLabel}>
          <option value="">All {statusLabel.toLowerCase()}</option>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      )}

      {(onFrom || onTo) && (
        <div className="flex items-center gap-2">
          <Input className="w-36!" type="date" value={from} onChange={(e) => onFrom?.(e.target.value)} aria-label="From date" />
          <span className="text-xs text-slate-400">→</span>
          <Input className="w-36!" type="date" value={to} onChange={(e) => onTo?.(e.target.value)} aria-label="To date" />
        </div>
      )}

      {canReset && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onReset}>Reset</Button>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
