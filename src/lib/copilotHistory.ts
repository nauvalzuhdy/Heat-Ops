// AI Copilot chat history — client-side only, localStorage-backed. Follows
// the same pattern already used for theme persistence (store/uiStore.ts +
// components/theme/ThemeSync.tsx's "heatops-theme" key): a plain browser
// storage key, wrapped in try/catch, no new backend/database. The project's
// Copilot was always stateless server-side by design (project.md §6:
// "riwayat chat ... opsional" — the client resends full history each
// request), so this is the simplest mechanism consistent with that
// architecture rather than a new Supabase table.
//
// Deliberately stores only role/content pairs (the same shape already sent
// to /api/copilot/chat) — not per-turn trace/tool_data/images, which are
// ephemeral UI state tied to one live request, not meaningful to replay from
// storage.
import type { CopilotChatTurn } from "./copilotTypes";

export type StoredConversation = {
  id: string;
  siteId: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  messages: CopilotChatTurn[];
};

const MAX_CONVERSATIONS_PER_SITE = 20;

function storageKey(siteId: string): string {
  return `heatops-copilot-history-${siteId}`;
}

export function loadConversations(siteId: string): StoredConversation[] {
  try {
    const raw = localStorage.getItem(storageKey(siteId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredConversation[]) : [];
  } catch {
    return [];
  }
}

export function saveConversation(siteId: string, conversation: StoredConversation): void {
  try {
    const existing = loadConversations(siteId).filter((c) => c.id !== conversation.id);
    const next = [conversation, ...existing].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS_PER_SITE);
    localStorage.setItem(storageKey(siteId), JSON.stringify(next));
  } catch {
    // Storage full / private browsing — history just won't persist this
    // session, not worth surfacing as an error to the user mid-chat.
  }
}

export function makeConversationTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed || "New conversation";
}
