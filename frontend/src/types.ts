export interface Answer {
  request_id: string;
  conversation_id: string;
  answer: string;
}
export interface Session {
  mode: string;
  authenticated: boolean;
}
export interface Health {
  status: string;
  configured: boolean;
  agent: string | null;
}
// Conversations live in Microsoft Foundry; the browser only keeps the open one's ID.
export interface ConversationSummary {
  id: string;
  title: string;
  created_at: number;
}
export interface ConversationDetail {
  id: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string }[];
}
export interface Turn {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  stopped?: boolean;
}
