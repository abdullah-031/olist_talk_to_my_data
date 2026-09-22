export interface Plan {
  action: 'query' | 'clarify';
  message: string;
  metrics: string[];
  dimensions: string[];
  filters: Record<string, string | null>;
  sort_by: string;
  sort_direction: 'asc' | 'desc';
  limit: number;
}
export interface Column {
  key: string;
  label: string;
  format: 'text' | 'number' | 'currency';
}
export interface Answer {
  request_id: string;
  answer: string;
  plan: Plan;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  sql: string | null;
  parameters: (string | number)[];
  truncated: boolean;
  notes: string[];
  timings_ms: Record<string, number>;
  model: string;
  usage: Record<string, number>;
}
export interface Turn {
  id: string;
  question: string;
  result?: Answer;
  error?: string;
}
export interface WarehouseInfo {
  database: string;
  items: number;
  orders: number;
  first_date: string | null;
  last_date: string | null;
  definitions: string[];
  quality_warnings: string[];
}
