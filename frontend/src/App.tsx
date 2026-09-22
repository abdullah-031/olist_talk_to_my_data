import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronRight,
  CircleHelp,
  Database,
  Layers3,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { request } from './api';
import Result from './Result';
import type { Answer, Turn, WarehouseInfo } from './types';

const suggestions = [
  { tag: 'PERFORMANCE', question: 'What is our total revenue and order count?', icon: BarChart3 },
  { tag: 'PRODUCTS', question: 'Which 5 categories generate the most revenue?', icon: Layers3 },
  { tag: 'TRENDS', question: 'Show monthly revenue for 2018.', icon: ArrowRight },
  { tag: 'CUSTOMERS', question: 'Which states have the most orders?', icon: Database },
];

export default function App() {
  const [warehouse, setWarehouse] = useState<WarehouseInfo | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (showInfo) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [showInfo]);

  useEffect(() => {
    const controller = new AbortController();
    setConnectionError('');
    request<WarehouseInfo>('/api/warehouse', { signal: controller.signal })
      .then(setWarehouse)
      .catch((error) => {
        if (!controller.signal.aborted) setConnectionError(error.message);
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || activeRef.current) return;
    activeRef.current = true;
    const id = crypto.randomUUID();
    const history = turns
      .filter((turn) => turn.result)
      .slice(-6)
      .map((turn) => ({ question: turn.question, plan: turn.result!.plan }));
    const controller = new AbortController();
    controllerRef.current = controller;
    setTurns((previous) => [...previous, { id, question }]);
    setInput('');
    setBusy(true);
    try {
      const result = await request<Answer>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      setTurns((previous) => previous.map((turn) => (turn.id === id ? { ...turn, result } : turn)));
    } catch (error) {
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Something went wrong. Please try again.',
              }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
      activeRef.current = false;
      inputRef.current?.focus();
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand" aria-label="Olist home">
          <span className="brand-icon">
            <BarChart3 aria-hidden="true" size={23} />
          </span>
          <strong>
            olist<span className="brand-dot">.</span>
          </strong>
          <span className="workspace-tag">LAB</span>
        </a>
        <button
          className="new-chat"
          disabled={busy}
          onClick={() => {
            setTurns([]);
            setInput('');
            inputRef.current?.focus();
          }}
        >
          <Plus aria-hidden="true" size={17} /> New conversation <span>↗</span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <button className="nav-item active" onClick={() => setShowInfo(false)}>
          <Sparkles aria-hidden="true" size={17} /> Ask your data{' '}
          <ChevronRight aria-hidden="true" size={14} />
        </button>
        <button className="nav-item" onClick={() => setShowInfo(true)}>
          <Database aria-hidden="true" size={17} /> Warehouse guide
        </button>
        <div className="sidebar-spacer" />
        <div className="source-card">
          <div className="source-icon">
            <Database aria-hidden="true" size={18} />
          </div>
          <div>
            <strong>Olist warehouse</strong>
            <span>Azure PostgreSQL</span>
          </div>
          <span className={`status-dot ${warehouse && !connectionError ? '' : 'offline'}`} />
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">A</span>
          <div>
            <strong>Analytics workspace</strong>
            <span>Local development</span>
          </div>
          <ShieldCheck aria-hidden="true" size={16} />
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            Workspace <ChevronRight aria-hidden="true" size={13} />
            <strong>Ask your data</strong>
          </div>
          <button className="model-badge" onClick={() => setShowInfo(true)}>
            <span className="purple-dot" /> GPT-4.1 nano{' '}
            <ChevronRight aria-hidden="true" size={12} />
          </button>
        </header>
        <div className="main-body">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR ANALYTICS, IN CONVERSATION</div>
              <h1>Talk to your data.</h1>
              <p>Ask a question. Get an answer grounded in your warehouse.</p>
            </div>
            <span className="read-only">
              <ShieldCheck aria-hidden="true" size={14} /> Read-only access
            </span>
          </div>
          <section className="warehouse-strip" aria-label="Warehouse connection">
            <div className="warehouse-strip-title">
              <span className="database-icon">
                <Database aria-hidden="true" size={18} />
              </span>
              <div>
                <strong>Olist ecommerce</strong>
                <span>
                  <span
                    className={`status-dot ${warehouse && !connectionError ? '' : 'offline'}`}
                  />
                  {connectionError
                    ? 'Connection unavailable'
                    : warehouse
                      ? 'Warehouse connected'
                      : 'Connecting to warehouse…'}
                </span>
              </div>
            </div>
            <div className="warehouse-stat">
              <span>ORDER ITEMS</span>
              <strong>{warehouse ? warehouse.items.toLocaleString('en-US') : '—'}</strong>
            </div>
            <div className="warehouse-stat">
              <span>DATA COVERAGE</span>
              <strong>
                {warehouse?.first_date && warehouse.last_date
                  ? `${warehouse.first_date.slice(0, 4)} – ${warehouse.last_date.slice(0, 4)}`
                  : '—'}
              </strong>
            </div>
            <div className="warehouse-stat">
              <span>CURRENCY</span>
              <strong>
                BRL <span className="muted">R$</span>
              </strong>
            </div>
          </section>
          {connectionError && (
            <div className="connection-error" role="alert">
              {connectionError}{' '}
              <button onClick={() => setRefresh((value) => value + 1)}>Retry connection</button>
            </div>
          )}

          {warehouse?.quality_warnings?.map((warning) => (
            <div className="quality-notice" key={warning} role="status">
              <CircleHelp aria-hidden="true" size={15} />
              <span>{warning}</span>
            </div>
          ))}
          <section
            className={`conversation ${turns.length ? 'has-turns' : ''}`}
            aria-label="Conversation"
          >
            {!turns.length ? (
              <div className="welcome">
                <span className="welcome-mark">
                  <Sparkles aria-hidden="true" size={25} strokeWidth={1.6} />
                </span>
                <h2>A little curiosity. A lot of insight.</h2>
                <p>
                  Explore revenue, orders, and the stories behind your sales.
                  <br />
                  Start with a question below, or ask your own.
                </p>
                <div className="suggestion-grid">
                  {suggestions.map(({ tag, question, icon: Icon }) => (
                    <button
                      key={tag}
                      className="suggestion"
                      onClick={() => void ask(question)}
                      disabled={busy}
                    >
                      <span className="suggestion-top">
                        <Icon aria-hidden="true" size={16} />
                        <span>{tag}</span>
                        <ArrowUp aria-hidden="true" className="suggestion-arrow" size={15} />
                      </span>
                      <span>{question}</span>
                    </button>
                  ))}
                </div>
                <div className="data-note">
                  <Layers3 aria-hidden="true" size={13} /> One warehouse. Six dimensions. Clear
                  answers.
                </div>
              </div>
            ) : (
              <div className="turns">
                {turns.map((turn) => (
                  <article key={turn.id} className="turn">
                    <div className="user-message">
                      <span className="you-label">YOU</span>
                      <p>{turn.question}</p>
                    </div>
                    {turn.result && <Result result={turn.result} />}
                    {turn.error && (
                      <div className="turn-error" role="alert">
                        <p>{turn.error}</p>
                        <button disabled={busy} onClick={() => void ask(turn.question)}>
                          Try again
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {busy && (
                  <div className="thinking" role="status">
                    <LoaderCircle aria-hidden="true" size={17} className="spin" /> Planning and
                    querying your warehouse…
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </section>
          <div className="composer-wrap">
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void ask(input);
              }}
            >
              <label className="sr-only" htmlFor="question">
                Ask a question about your warehouse
              </label>
              <textarea
                ref={inputRef}
                id="question"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={2000}
                placeholder={
                  turns.length
                    ? 'Ask a follow-up, e.g. “Only delivered orders”'
                    : 'Ask anything about your sales data…'
                }
                rows={2}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void ask(input);
                  }
                }}
              />
              <div className="composer-bottom">
                <span>
                  <Database aria-hidden="true" size={13} /> Olist warehouse{' '}
                  <span className="composer-divider">/</span>{' '}
                  {turns.length ? 'Follow-up questions supported' : 'All available data'}
                </span>
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send question"
                  disabled={busy || !input.trim()}
                >
                  {busy ? (
                    <LoaderCircle aria-hidden="true" className="spin" size={18} />
                  ) : (
                    <ArrowUp aria-hidden="true" size={19} />
                  )}
                </button>
              </div>
            </form>
            <div className="composer-caption">
              <span>
                Answers include their SQL and metric definitions. Review before making decisions.
              </span>
              <span>
                Enter to send <ArrowDown aria-hidden="true" size={11} />
              </span>
            </div>
          </div>
        </div>
        <footer className="page-footer">
          <span>
            <span className="status-dot" /> Built on your warehouse
          </span>
          <button onClick={() => setShowInfo(true)}>
            <CircleHelp aria-hidden="true" size={13} /> What can I ask?
          </button>
        </footer>
      </main>
      <dialog
        ref={dialogRef}
        className="guide-panel"
        aria-labelledby="guide-title"
        onCancel={() => setShowInfo(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setShowInfo(false);
        }}
      >
        <button
          autoFocus
          className="close-button"
          aria-label="Close warehouse guide"
          onClick={() => setShowInfo(false)}
        >
          <X aria-hidden="true" size={20} />
        </button>
        <span className="eyebrow">WAREHOUSE GUIDE</span>
        <h2 id="guide-title">Know what you’re asking.</h2>
        <p>
          Explore merchandise revenue, order counts, items, freight, total item value, and average
          order value.
        </p>
        <h3>Slice your data</h3>
        <p>
          Group by year, quarter, month, category, customer state, seller state, or order status.
          Filter by dates, category, state, and status.
        </p>
        <h3>Metric definitions</h3>
        <ul>
          {(
            warehouse?.definitions ?? [
              'Revenue excludes freight. Amounts are in Brazilian reais.',
              'Orders are counted distinctly within each group.',
              'All statuses are included unless you ask for a filter.',
            ]
          ).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <h3>Scope of this first version</h3>
        <p>
          Aggregate analytics only. Reviews, payments, profit, forecasts, and individual customer
          records are outside this warehouse contract. Follow-up questions retain the last six
          turns; a new conversation clears them.
        </p>
        <p className="guide-footnote">
          Your question and category labels go to GPT-4.1 nano. Query result rows stay between the
          warehouse, this backend, and your browser.
        </p>
      </dialog>
    </div>
  );
}
