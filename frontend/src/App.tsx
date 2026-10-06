import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Menu, RefreshCw, TriangleAlert } from 'lucide-react';
import { request } from './api';
import Composer from './components/Composer';
import EmptyState from './components/EmptyState';
import Login from './components/Login';
import Sidebar, { Brand, MobileSidebar, NewChatButton } from './components/Sidebar';
import TurnView from './components/TurnView';
import { useTheme } from './components/ThemeToggle';
import { conversationFromUrl, toTurns } from './history';
import type {
  Answer as ChatAnswer,
  ConversationDetail,
  ConversationSummary,
  Health,
  Session,
  Turn,
} from './types';

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
  const [session, setSession] = useState<Session | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ kind: 'load' } | { kind: 'answer'; id: string } | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  // The open conversation's ID; its messages are stored in Microsoft Foundry.
  const [conversationId, setConversationId] = useState<string | null>(conversationFromUrl);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const busy = pending?.kind === 'answer';
  const pendingId = pending?.kind === 'answer' ? pending.id : null;
  const loading = pending?.kind === 'load';
  const theme = useTheme();
  const agent = health?.agent ?? 'the Foundry agent';
  const configured = health?.configured ?? false;

  // Deployments with a shared username and password answer authenticated: false until
  // sign-in; Entra and local deployments are authenticated from the start.
  useEffect(() => {
    const controller = new AbortController();
    request<Session>('/api/session', { signal: controller.signal })
      .then(setSession)
      .catch(() => {
        // A failing check is a connection problem, reported by the health check below.
        if (!controller.signal.aborted) setSession({ mode: 'unknown', authenticated: true });
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const expired = () =>
      setSession((current) =>
        current?.mode === 'shared_login' ? { ...current, authenticated: false } : current,
      );
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);

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
    if (configured && session?.authenticated) void loadConversations();
  }, [configured, session?.authenticated, loadConversations]);

  const load = useCallback(async (id: string | null) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPending(null);
    setConversationId(id);
    setTurns([]);
    setNotice('');
    if (!id) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending({ kind: 'load' });
    try {
      const detail = await request<ConversationDetail>(
        `/api/conversations/${encodeURIComponent(id)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setTurns(toTurns(detail.messages));
    } catch (error) {
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setNotice(failure(error));
      setConversationId(null);
      history.replaceState(null, '', conversationUrl(null));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setPending(null);
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
    if (!question || controllerRef.current) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    controllerRef.current = controller;
    setTurns([...history, { id, question }]);
    setInput('');
    setNotice('');
    setPending({ kind: 'answer', id });
    const update = (patch: Partial<Turn>) =>
      setTurns((previous) =>
        previous.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
      );
    try {
      const result = await request<ChatAnswer>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversation_id: conversationId }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      update({ answer: result.answer });
      if (!conversationId) {
        setConversationId(result.conversation_id);
        window.history.replaceState(null, '', conversationUrl(result.conversation_id));
        void loadConversations();
      }
    } catch (error) {
      if (controllerRef.current !== controller) return;
      update(controller.signal.aborted ? { stopped: true } : { error: failure(error) });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setPending(null);
        const active = document.activeElement;
        if (!active || active === document.body) inputRef.current?.focus();
      }
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

  const sidebar = {
    ...theme,
    health,
    conversations,
    historyError,
    activeId: conversationId,
    busy,
    onNew: reset,
    onOpen: open,
    onDelete: (id: string) => void remove(id),
    onReload: () => void loadConversations(),
  };

  if (!session)
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="flex items-center gap-2 text-sm text-ink-3" role="status">
          <LoaderCircle aria-hidden="true" size={16} className="animate-spin" /> Loading…
        </p>
      </main>
    );
  if (!session.authenticated)
    return (
      <Login
        onSignedIn={() => {
          setSession({ ...session, authenticated: true });
          setRefresh((value) => value + 1);
        }}
      />
    );

  return (
    <div className="min-h-dvh">
      <Sidebar {...sidebar} />
      <MobileSidebar {...sidebar} open={menuOpen} onClose={closeMenu} />

      <div className="flex min-h-dvh flex-col lg:pl-72">
        <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 border-b border-line bg-bg/80 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-4 lg:hidden">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              className="grid size-10 place-items-center rounded-xl text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Menu aria-hidden="true" size={20} />
            </button>
            <Brand />
          </div>
          <NewChatButton busy={busy} onNew={reset} compact />
        </header>

        <main className="relative flex flex-1 flex-col">
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
