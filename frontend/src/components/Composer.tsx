import { useLayoutEffect, type RefObject } from 'react';
import { ArrowUp, Square } from 'lucide-react';

const MAX_LENGTH = 2000;

interface Props {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  busy: boolean;
  followUp: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

export default function Composer({
  inputRef,
  value,
  busy,
  followUp,
  onChange,
  onSubmit,
  onStop,
}: Props) {
  // Fallback for engines without `field-sizing: content`.
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element || CSS.supports('field-sizing', 'content')) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value, inputRef]);

  return (
    <form
      className="group rounded-2xl border border-line-strong bg-surface p-2 shadow-[0_8px_30px_-12px] shadow-accent/25 transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-accent/40"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor="question">
        Ask a question about your Olist data
      </label>
      <textarea
        ref={inputRef}
        id="question"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_LENGTH}
        rows={1}
        enterKeyHint="send"
        placeholder={followUp ? 'Ask a follow-up…' : 'Ask anything about your sales data…'}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className="auto-grow block max-h-[200px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[0.9375rem] pointer-coarse:text-base leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
      />
      <div className="flex items-center gap-3 px-2 pb-0.5">
        <p className="m-0 min-w-0 flex-1 truncate text-xs text-ink-3">
          {followUp
            ? 'Follow-ups use this conversation as context'
            : 'Read-only · answered from the Olist warehouse'}
        </p>
        {value.length > MAX_LENGTH * 0.8 && (
          <span className="text-xs tabular-nums text-ink-3">
            {value.length}/{MAX_LENGTH}
          </span>
        )}
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-sans text-[0.6875rem] text-ink-3 sm:inline">
          Enter ↵
        </kbd>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop waiting for the answer"
            className="grid size-10 place-items-center rounded-xl bg-ink sm:size-9 text-bg transition-transform active:scale-95"
          >
            <Square aria-hidden="true" size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send question"
            disabled={!value.trim()}
            className="grid size-10 place-items-center rounded-xl bg-accent sm:size-9 text-on-accent shadow-sm transition-[transform,opacity,background-color] hover:bg-accent-strong active:scale-95 disabled:opacity-35"
          >
            <ArrowUp aria-hidden="true" size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </form>
  );
}
