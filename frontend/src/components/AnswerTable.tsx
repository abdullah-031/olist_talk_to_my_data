import { useState, type ComponentProps } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { fromHast, numericSeries, parseNumber, type TableData } from '../table';

type Props = ComponentProps<'table'> & { node?: unknown };

// Markdown tables render as a table; when one column is numeric they also get a bar chart,
// shown first, with the table one click away.
export default function AnswerTable({ node, ...props }: Props) {
  const data = node ? fromHast(node as Parameters<typeof fromHast>[0]) : null;
  const series = data ? numericSeries(data) : [];
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [column, setColumn] = useState(0);
  const table = (
    <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Answer table">
      <table {...props} />
    </div>
  );

  if (!data || !series.length) {
    return (
      <figure className="my-4 overflow-hidden rounded-xl border border-line bg-surface">
        {table}
      </figure>
    );
  }
  const active = series[Math.min(column, series.length - 1)];

  return (
    <figure className="my-4 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        {series.length > 1 && view === 'chart' ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Measure">
            {series.map((item, index) => (
              <button
                key={item.column}
                type="button"
                aria-pressed={item === active}
                onClick={() => setColumn(index)}
                className="rounded-md px-2 py-1 text-xs font-medium text-ink-3 transition-colors pointer-coarse:px-2.5 pointer-coarse:py-2 hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent-strong"
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <figcaption className="px-1 text-xs font-medium text-ink-2">
            {view === 'chart' ? active.label : `${data.rows.length} rows`}
          </figcaption>
        )}
        <div
          className="ml-auto flex gap-0.5 rounded-lg bg-surface-2 p-0.5"
          role="group"
          aria-label="View"
        >
          {(
            [
              ['chart', 'Chart', BarChart3],
              ['table', 'Table', Table2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-3 transition-colors pointer-coarse:px-2.5 pointer-coarse:py-2 hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
            >
              <Icon aria-hidden="true" size={13} /> {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'chart' ? (
        <BarChart data={data} column={active.column} label={active.label} />
      ) : (
        table
      )}
    </figure>
  );
}

function BarChart({ data, column, label }: { data: TableData; column: number; label: string }) {
  const values = data.rows.map((row) => parseNumber(row[column]) ?? 0);
  const max = Math.max(...values) || 1;
  // Label, bar track and value are subgrid columns, so every row lines up at any width.
  return (
    <ul
      className="grid grid-cols-[minmax(2.5rem,max-content)_1fr_max-content] gap-y-1 px-1.5 py-3 sm:px-4 sm:py-4"
      aria-label={`${label} by ${data.headers[0]}`}
    >
      {data.rows.map((row, index) => (
        <li
          key={index}
          className="group col-span-3 grid grid-cols-subgrid items-center gap-x-2 rounded-md sm:gap-x-3 px-1.5 py-1 text-[0.8125rem] hover:bg-surface-2"
        >
          <span className="max-w-24 truncate text-ink-2 sm:max-w-40" title={row[0]}>
            {row[0]}
          </span>
          <span className="flex h-[18px] min-w-0 items-center" aria-hidden="true">
            <span
              className="h-full min-w-[3px] rounded-r-[4px] bg-bar transition-[width] duration-500 group-hover:bg-accent-strong"
              style={{ width: `${(values[index] / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-medium whitespace-nowrap text-ink tabular-nums">
            {row[column]}
          </span>
        </li>
      ))}
    </ul>
  );
}
