import { useState } from 'react';
import { BarChart3, Check, ChevronDown, Code2, Table2 } from 'lucide-react';
import type { Answer, Column } from './types';

export function formatValue(value: string | number | null, column: Column) {
  if (value === null) return '—';
  if (column.format === 'text') return String(value).replaceAll('_', ' ');
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return column.format === 'currency'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' }).format(number)
    : new Intl.NumberFormat('en-US').format(number);
}

export default function Result({ result }: { result: Answer }) {
  const [view, setView] = useState<'table' | 'chart'>('table');
  const dimensions = result.columns.filter((column) => column.format === 'text');
  const metric = result.columns.find((column) => column.format !== 'text');
  const chartable = dimensions.length === 1 && metric && result.rows.length > 1;
  const maximum = metric
    ? Math.max(...result.rows.map((row) => Math.abs(Number(row[metric.key]))), 1)
    : 1;
  return (
    <div className="result">
      <div className="answer-label">
        <span className="mini-logo">
          <BarChart3 aria-hidden="true" size={15} />
        </span>{' '}
        Olist assistant
        {result.sql && (
          <span className="verified">
            <Check aria-hidden="true" size={12} /> Queried warehouse
          </span>
        )}
      </div>
      <p className="answer-text">{result.answer}</p>
      {result.sql && (
        <>
          <div className="result-panel">
            <div className="result-toolbar">
              <span>
                {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}
                {result.truncated ? ' · limited result' : ''}
              </span>
              <div className="segmented" aria-label="Result display">
                <button
                  type="button"
                  aria-pressed={view === 'table'}
                  onClick={() => setView('table')}
                >
                  <Table2 aria-hidden="true" size={14} /> Table
                </button>
                {chartable && (
                  <button
                    type="button"
                    aria-pressed={view === 'chart'}
                    onClick={() => setView('chart')}
                  >
                    <BarChart3 aria-hidden="true" size={14} /> Chart
                  </button>
                )}
              </div>
            </div>
            {view === 'chart' && chartable ? (
              <div
                className="chart"
                role="img"
                aria-label={`${metric.label} by ${dimensions[0].label}; same data available in table view`}
              >
                {result.rows.map((row, index) => (
                  <div className="bar-row" key={index}>
                    <span title={String(row[dimensions[0].key])}>
                      {formatValue(row[dimensions[0].key], dimensions[0])}
                    </span>
                    <div className="bar-track">
                      <div
                        style={{ width: `${(Math.abs(Number(row[metric.key])) / maximum) * 100}%` }}
                      />
                    </div>
                    <strong>{formatValue(row[metric.key], metric)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Query result table"
              >
                <table>
                  <thead>
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column.key} scope="col">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, index) => (
                      <tr key={index}>
                        {result.columns.map((column) => (
                          <td
                            key={column.key}
                            className={column.format !== 'text' ? 'numeric' : ''}
                          >
                            {formatValue(row[column.key], column)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result.rows.length && (
                  <p className="empty-result">No rows matched these filters.</p>
                )}
              </div>
            )}
          </div>
          <details className="query-details">
            <summary>
              <Code2 aria-hidden="true" size={14} /> View query & definitions{' '}
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            <pre>{result.sql}</pre>
            <p className="query-params">Bound parameters: {JSON.stringify(result.parameters)}</p>
            <ul>
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p className="query-params">
              Planning {result.timings_ms.planning} ms · Database {result.timings_ms.database} ms ·
              Request {result.request_id}
            </p>
          </details>
        </>
      )}
      <div className="answer-footer">
        {result.model} <span>·</span> {(result.timings_ms.total / 1000).toFixed(1)}s
      </div>
    </div>
  );
}
