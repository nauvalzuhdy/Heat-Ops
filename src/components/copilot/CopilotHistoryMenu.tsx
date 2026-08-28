"use client";

// Chat-history dropdown (localStorage-backed, see lib/copilotHistory.ts).
// Anchored under the History button in CopilotChat.tsx's header row.
import { Plus } from "lucide-react";
import type { StoredConversation } from "@/lib/copilotHistory";

export default function CopilotHistoryMenu({
  open,
  onClose,
  conversations,
  activeId,
  onSelect,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  conversations: StoredConversation[];
  activeId: string;
  onSelect: (conversation: StoredConversation) => void;
  onNewChat: () => void;
}) {
  if (!open) return null;

  return (
    <>
      {/* Click-outside dismiss — sits below the panel itself in z-index. */}
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div className="absolute right-0 top-full z-30 mt-2 max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card-md border border-border-subtle bg-surface shadow-float">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2.5 text-left text-sm font-medium text-accent transition-colors duration-200 hover:bg-surface-2"
        >
          <Plus size={14} />
          New chat
        </button>
        <div className="max-h-72 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-fg-muted">No previous conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  onClose();
                }}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-surface-2 ${
                  c.id === activeId ? "bg-accent-soft" : ""
                }`}
              >
                <span className="w-full truncate text-xs font-medium text-fg-primary">{c.title}</span>
                <span className="text-[10px] text-fg-muted">
                  {new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                  {new Date(c.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
