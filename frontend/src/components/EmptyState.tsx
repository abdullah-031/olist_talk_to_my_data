import {
  ArrowUpRight,
  CalendarRange,
  MapPin,
  Package,
  Store,
  TrendingUp,
  Truck,
  type LucideIcon,
} from 'lucide-react';

const suggestions: { tag: string; question: string; icon: LucideIcon }[] = [
  { tag: 'Performance', question: 'What is our total revenue and order count?', icon: TrendingUp },
  { tag: 'Products', question: 'Which 5 categories generate the most revenue?', icon: Package },
  { tag: 'Trends', question: 'Show monthly revenue for 2018.', icon: CalendarRange },
  { tag: 'Customers', question: 'Which states have the most orders?', icon: MapPin },
  { tag: 'Sellers', question: 'Who are the top 10 sellers by revenue?', icon: Store },
  {
    tag: 'Shipping',
    question: 'Which categories have the highest average freight cost?',
    icon: Truck,
  },
];

export default function EmptyState({
  disabled,
  onAsk,
}: {
  disabled: boolean;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl animate-rise py-8 sm:py-16">
      <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs font-medium text-ink-2 backdrop-blur">
        <span className="size-1.5 rounded-full bg-good" aria-hidden="true" />
        Brazilian e-commerce · 2016–2018 · read-only
      </p>
      <h1 className="text-gradient m-0 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Talk to your data.
      </h1>
      <p className="mt-4 mb-8 max-w-xl sm:mb-10 text-base text-pretty text-ink-2 sm:text-lg">
        Ask about revenue, products, sellers, customers and shipping costs in plain language.
        Answers come straight from the Olist warehouse — tables turn into charts automatically.
      </p>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-ink-3 uppercase">Try asking</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map(({ tag, question, icon: Icon }) => (
          <li key={tag}>
            <button
              type="button"
              className="group flex h-full w-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-xs transition-[border-color,box-shadow,translate] hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onAsk(question)}
              disabled={disabled}
            >
              <span className="flex w-full items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-strong">
                  <Icon aria-hidden="true" size={16} />
                </span>
                <span className="text-xs font-medium text-ink-3">{tag}</span>
                <ArrowUpRight
                  aria-hidden="true"
                  size={16}
                  className="ml-auto text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </span>
              <span className="text-sm leading-snug font-medium text-ink">{question}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
