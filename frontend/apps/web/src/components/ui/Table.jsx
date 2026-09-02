import { cn } from '../../lib/utils.js';
import EmptyState from './EmptyState.jsx';
import { LoadingBlock } from './Spinner.jsx';

/**
 * Generic data table.
 * columns: [{ key, header, render?(row), className?, align? }]
 */
export default function Table({
  columns,
  data,
  rowKey = 'id',
  loading = false,
  onRowClick,
  empty,
  footer,
  className,
}) {
  if (loading) return <LoadingBlock />;
  if (!data?.length) {
    return empty ? empty : <EmptyState title="No rows" message="Nothing matches the current filters." />;
  }
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((c) => (
              <th key={c.key} className={cn('th', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((row) => (
            <tr
              key={row?.[rowKey] ?? JSON.stringify(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'transition',
                onRowClick ? 'cursor-pointer hover:bg-rose-50/40' : 'hover:bg-slate-50/60'
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('td', c.align === 'right' && 'text-right', c.className)}>
                  {c.render ? c.render(row) : row?.[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
