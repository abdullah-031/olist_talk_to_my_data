import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Menu, RefreshCw, TriangleAlert } from 'lucide-react';
import { request } from './api';
import Composer from './components/Composer';
import EmptyState from './components/EmptyState';
import Sidebar, { Brand, NewChatButton } from './components/Sidebar';
import TurnView from './components/TurnView';
import { conversationFromUrl, toTurns } from './history';
import type {
  Answer as ChatAnswer,
  ConversationDetail,
  ConversationSummary,
  Health,
  Turn,
} from './types';

const TIMEOUT_MS = 180000;

function failure(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return 'The Foundry agent took too long to answer. Try again.';
  if (error instanceof TypeError) return 'Could not reach the backend. Check that it is running.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function conversationUrl(id: string | null): string {
  return id ? `?c=${encodeURIComponent(id)}` : location.pathname;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  // The open conversation's ID; its messages are stored in Microsoft Foundry.
  const [conversationId, setConversationId] = useState<string | null>(conversationFromUrl);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const openRef = useRef<AbortController | null>(null);
  const busy = pendingId !== null;
  const agent = health?.agent ?? 'the Foundry agent';
  const configured = health?.configured ?? false;

  useEffect(() => {
    const controller = new AbortController();
    setConnectionError('');
    request<Health>('/api/health', { signal: controller.signal })
      .then((result) => {
        setHealth(result);
        if (!result.configured)
          setConnectionError(
            'The backend is not connected to Microsoft Foundry. Set FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME, then restart it.',
          );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setConnectionError(failure(error));
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  // The drawer only exists below lg; drop it if the viewport grows past that.
  useEffect(() => {
    const wide = matchMedia('(min-width: 64rem)');
    const onChange = () => wide.matches && setMenuOpen(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (!busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controllerRef.current?.abort();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);
  useEffect(() => {
    if (pendingId)
      document
        .getElementById(`turn-${pendingId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pendingId]);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await request<ConversationSummary[]>('/api/conversations'));
      setHistoryError('');
    } catch (error) {
      setHistoryError(failure(error));
    }
  }, []);
  useEffect(() => {
    if (configured) void loadConversations();
  }, [configured, loadConversations]);

  const load = useCallback(async (id: string | null) => {
    controllerRef.current?.abort();
    openRef.current?.abort();
    setConversationId(id);
    setTurns([]);
    setNotice('');
    if (!id) return;
    const controller = new AbortController();
    openRef.current = controller;
    setLoading(true);
    try {
      const detail = await request<ConversationDetail>(
        `/api/conversations/${encodeURIComponent(id)}`,
        { signal: controller.signal },
      );
      setTurns(toTurns(detail.messages));
    } catch (error) {
      if (controller.signal.aborted) return;
      setNotice(failure(error));
      setConversationId(null);
      history.replaceState(null, '', conversationUrl(null));
    } finally {
      if (openRef.current === controller) {
        openRef.current = null;
        setLoading(false);
      }
    }
  }, []);
  // Opens the conversation in the address bar on first load and on back/forward.
  useEffect(() => {
    const id = conversationFromUrl();
    if (id) void load(id);
    const onPop = () => void load(conversationFromUrl());
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      openRef.current?.abort();
    };
  }, [load]);

  function open(id: string | null) {
    if (busy) return;
    setMenuOpen(false);
    if (id !== conversationId) history.pushState(null, '', conversationUrl(id));
    void load(id);
    inputRef.current?.focus();
  }

  async function ask(text: string, history: Turn[] = turns) {
    const question = text.trim();
    if (!question || controllerRef.current || loading) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    controllerRef.current = controller;
    const started = performance.now();
    setTurns([...history, { id, question }]);
    setInput('');
    setNotice('');
    setPendingId(id);
    const update = (patch: Partial<Turn>) =>
      setTurns((previous) =>
        previous.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
      );
    try {
      const result = await request<ChatAnswer>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversation_id: conversationId }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      update({ answer: result.answer, seconds: Math.round((performance.now() - started) / 1000) });
      if (!conversationId) {
        setConversationId(result.conversation_id);
        window.history.replaceState(null, '', conversationUrl(result.conversation_id));
        void loadConversations();
      }
    } catch (error) {
      update(controller.signal.aborted ? { stopped: true } : { error: failure(error) });
    } finally {
      controllerRef.current = null;
      setPendingId(null);
      const active = document.activeElement;
      if (!active || active === document.body) inputRef.current?.focus();
    }
  }

  function retry(turn: Turn) {
    void ask(
      turn.question,
      turns.filter((other) => other.id !== turn.id),
    );
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      setNotice(failure(error));
      return;
    }
    setConversations((previous) => previous?.filter((item) => item.id !== id) ?? null);
    if (id === conversationId) open(null);
  }

  function reset() {
    setInput('');
    open(null);
  }

  return (
    <div className="min-h-dvh">
      <Sidebar
        health={health}
        conversations={conversations}
        historyError={historyError}
        activeId={conversationId}
        busy={busy}
        open={menuOpen}
        onClose={closeMenu}
        onNew={reset}
        onOpen={open}
        onDelete={(id) => void remove(id)}
        onReload={() => void loadConversations()}
      />

      <div className="flex min-h-dvh flex-col lg:pl-72" inert={menuOpen || undefined}>
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/80 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-4 lg:hidden">
          <div className="flex h-14 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open sidebar"
              aria-expanded={menuOpen}
              aria-controls="sidebar"
              className="grid size-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Menu aria-hidden="true" size={20} />
            </button>
            <Brand />
          </div>
          <NewChatButton busy={busy} onNew={reset} compact />
        </header>

        <main className="relative flex flex-1 flex-col">
          {!turns.length && !loading && (
            <div
              className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[480px]"
              aria-hidden="true"
            />
          )}
          <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
            {connectionError && (
              <div
                className="mt-6 flex flex-wrap items-start gap-3 rounded-xl border border-warn-ink/20 bg-warn-bg px-4 py-3 text-sm text-warn-ink"
                role="alert"
              >
                <TriangleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
                <p className="m-0 min-w-0 flex-1">{connectionError}</p>
                <button
                  type="button"
                  onClick={() => setRefresh((value) => value + 1)}
                  className="flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline"
                >
                  <RefreshCw aria-hidden="true" size={13} /> Check again
                </button>
              </div>
            )}
            {notice && (
              <div
                className="mt-6 flex items-start gap-3 rounded-xl border border-warn-ink/20 bg-warn-bg px-4 py-3 text-sm text-warn-ink"
                role="alert"
              >
                <TriangleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
                <p className="m-0 min-w-0 flex-1">{notice}</p>
              </div>
            )}

            {turns.length ? (
              <section
                role="log"
                aria-label="Conversation"
                aria-busy={busy}
                className="flex-1 space-y-10 py-8"
              >
                {turns.map((turn) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    agent={agent}
                    pending={turn.id === pendingId}
                    canRetry={!busy && !turn.answer}
                    onRetry={() => retry(turn)}
                  />
                ))}
              </section>
            ) : loading ? (
              <p
                className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-3"
                role="status"
              >
                <LoaderCircle aria-hidden="true" size={16} className="animate-spin" /> Loading
                conversation…
              </p>
            ) : (
              <EmptyState disabled={busy} onAsk={(question) => void ask(question)} />
            )}

            <div className="sticky bottom-0 z-10 -mx-2 bg-gradient-to-t from-bg from-70% to-transparent px-2 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Composer
                inputRef={inputRef}
                value={input}
                busy={busy}
                followUp={turns.length > 0}
                onChange={setInput}
                onSubmit={() => void ask(input)}
                onStop={() => controllerRef.current?.abort()}
              />
              <p className="mt-2.5 mb-0 text-center text-[0.6875rem] text-ink-3">
                Answers are generated by an AI agent from read-only warehouse queries. Review them
                before making decisions.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
