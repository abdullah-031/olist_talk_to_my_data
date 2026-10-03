import { useEffect, useRef } from 'react';
import {
  BarChart3,
  Bot,
  Database,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { ConversationSummary, Health } from '../types';
import ThemeToggle from './ThemeToggle';

const tables = ['Orders', 'Products', 'Categories', 'Sellers', 'Customers', 'Geography', 'Dates'];

interface Props {
  health: Health | null;
  conversations: ConversationSummary[] | null;
  historyError: string;
  activeId: string | null;
  busy: boolean;
  // Below the lg breakpoint the sidebar is a drawer that is only shown while open.
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onReload: () => void;
}

export function Brand() {
  return (
    <a href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Olist home">
      <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-accent to-accent-strong text-on-accent shadow-md shadow-accent/30">
        <BarChart3 aria-hidden="true" size={17} />
      </span>
      <strong className="text-xl font-semibold tracking-tight">
        olist<span className="text-accent">.</span>
      </strong>
    </a>
  );
}

export function NewChatButton({
  busy,
  onNew,
  compact,
}: {
  busy: boolean;
  onNew: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onNew}
      aria-label={compact ? 'New conversation' : undefined}
      className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-ink shadow-xs transition-colors hover:border-line-strong disabled:opacity-50"
    >
      <Plus aria-hidden="true" size={16} />
      {!compact && 'New conversation'}
    </button>
  );
}

export default function Sidebar({
  health,
  conversations,
  historyError,
  activeId,
  busy,
  open,
  onClose,
  onNew,
  onOpen,
  onDelete,
  onReload,
}: Props) {
  const online = health?.configured;
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      // Hand focus back to the menu button, unless the app already moved it (e.g. to the composer).
      const active = document.activeElement;
      if (!active || active === document.body || asideRef.current?.contains(active))
        opener?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 animate-fade bg-black/40 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={asideRef}
        id="sidebar"
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col border-r border-line bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:flex lg:max-w-none lg:bg-surface/60 lg:backdrop-blur-xl ${open ? 'flex animate-slide-in shadow-2xl lg:animate-none lg:shadow-none' : 'hidden'}`}
      >
        <div className="flex items-center justify-between gap-2 px-5 pt-6 pb-5">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close sidebar"
              className="grid size-9 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
        <div className="px-4">
          <NewChatButton busy={busy} onNew={onNew} />
        </div>

        <nav aria-label="Conversation history" className="mt-6 min-h-0 flex-1 overflow-y-auto px-4">
          <h2 className="flex items-center justify-between px-2 pb-2 text-[0.6875rem] font-semibold tracking-wider text-ink-3 uppercase">
            History
            <button
              type="button"
              onClick={onReload}
              aria-label="Refresh history"
              className="rounded p-0.5 transition-colors hover:text-ink pointer-coarse:p-1.5"
            >
              <RefreshCw aria-hidden="true" size={12} />
            </button>
          </h2>
          {historyError ? (
            <p className="px-2 text-sm text-ink-3">Could not load your conversations.</p>
          ) : conversations === null ? (
            <p className="px-2 text-sm text-ink-3">Loading…</p>
          ) : conversations.length ? (
            <ol className="space-y-0.5">
              {conversations.map((conversation) => {
                const active = conversation.id === activeId;
                return (
                  <li key={conversation.id} className="group relative">
                    <a
                      href={`?c=${encodeURIComponent(conversation.id)}`}
                      aria-current={active ? 'page' : undefined}
                      aria-disabled={busy || undefined}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                        event.preventDefault();
                        onOpen(conversation.id);
                      }}
                      className={`flex items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm pointer-coarse:py-2.5 pointer-coarse:pr-11 transition-colors hover:bg-surface-2 hover:text-ink ${active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2'} ${busy ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      <MessageSquareText
                        aria-hidden="true"
                        size={14}
                        className="shrink-0 text-ink-3"
                      />
                      <span className="truncate">{conversation.title}</span>
                    </a>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDelete(conversation.id)}
                      aria-label={`Delete conversation: ${conversation.title}`}
                      className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100 hover:text-danger-ink focus-visible:opacity-100 disabled:hidden"
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="px-2 text-sm text-ink-3">Your conversations will appear here.</p>
          )}

          <h2 className="mt-7 flex items-center gap-1.5 px-2 pb-2 text-[0.6875rem] font-semibold tracking-wider text-ink-3 uppercase">
            <Database aria-hidden="true" size={12} /> Warehouse
          </h2>
          <ul className="flex flex-wrap gap-1.5 px-2" aria-label="Warehouse subject areas">
            {tables.map((table) => (
              <li key={table} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
                {table}
              </li>
            ))}
          </ul>
        </nav>

        <div className="m-4 rounded-2xl border border-line bg-surface p-3 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-ink-2">
              <Bot aria-hidden="true" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-semibold">
                {health?.agent ?? 'Foundry agent'}
              </strong>
              <span className="block text-xs text-ink-3">Microsoft Foundry</span>
            </div>
            <span className="relative flex size-2.5" title={online ? 'Connected' : 'Not connected'}>
              {online && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
              )}
              <span
                className={`relative inline-flex size-2.5 rounded-full ${online ? 'bg-good' : 'bg-ink-3'}`}
              />
              <span className="sr-only">{online ? 'Connected' : 'Not connected'}</span>
            </span>
          </div>
          <p className="mt-3 mb-0 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-3">
            <ShieldCheck aria-hidden="true" size={13} /> Read-only access to the warehouse
          </p>
        </div>
      </aside>
    </>
  );
}
