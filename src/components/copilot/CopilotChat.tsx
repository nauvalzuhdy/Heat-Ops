"use client";

// AI Copilot chat UI (project.md §6). Visual sequence follows the reference
// screenshots (src/public/aicopilot1.png/aicopilot2.png): a tool trace
// ("Reading site data…") streams in first, then a "Thinking" pill, then the
// answer reveals word-by-word — see lib/copilotOrchestrator.ts for the server
// side of this sequence. Stateless server: this component resends the full
// turn history with every request rather than relying on a server-side
// session; chat history across sessions is a client-only, localStorage-backed
// convenience layered on top (lib/copilotHistory.ts) — see UI/UX pass notes
// below.
import { useEffect, useRef, useState } from "react";
import { Send, Paperclip, Search, CheckCircle2, X, AlertTriangle, Clock, Sparkles } from "lucide-react";
import type { CopilotEvent, CopilotChatTurn } from "@/lib/copilotTypes";
import { loadConversations, saveConversation, makeConversationTitle, type StoredConversation } from "@/lib/copilotHistory";
import ThinkingIndicator from "./ThinkingIndicator";
import SiteSnapshotCard from "./SiteSnapshotCard";
import HotspotZoneMiniChart from "./HotspotZoneMiniChart";
import RoiResultMiniCard from "./RoiResultMiniCard";
import InterventionComparisonMiniTable from "./InterventionComparisonMiniTable";
import AllSitesRankingMiniTable from "./AllSitesRankingMiniTable";
import MarkdownMessage from "./MarkdownMessage";
import CopilotHistoryMenu from "./CopilotHistoryMenu";

type TraceItem = { id: string; stage: "reading" | "tool_result"; label: string };

type UserMsg = { id: string; role: "user"; content: string; imagePreviewUrl?: string };
type AssistantMsg = {
  id: string;
  role: "assistant";
  content: string;
  trace: TraceItem[];
  toolData: Record<string, unknown>;
  notices: string[];
  thinking: boolean;
  streaming: boolean;
  error?: string;
};
type Msg = UserMsg | AssistantMsg;

// Bytes, not the resulting base64 string length — see the matching check in
// app/api/copilot/chat/route.ts (MAX_IMAGE_DATA_URL_BYTES), which caps the
// base64 form to stay under Vercel's request-body limit. ~33% base64
// inflation means a 3MB original comfortably clears that.
const MAX_IMAGE_FILE_BYTES = 3 * 1024 * 1024;

// Grounded in tools that actually exist (lib/copilotTools.ts) — not
// aspirational questions the Copilot has no way to answer. Two sets: one for
// a specific site open in the Copilot, one for "all sites" mode (siteId ===
// null) where per-site tools don't apply until a site is named or picked.
const SITE_SUGGESTED_QUESTIONS = [
  "How hot is this site right now?",
  "Which zone is the hottest?",
  "What canopy intervention do you recommend?",
  "Compare trees vs solar for this site",
  "Can I add a new building here?",
  "Generate a report for this site",
];

const ALL_SITES_SUGGESTED_QUESTIONS = [
  "Which of my sites is the hottest?",
  "Rank my sites by hotspot severity",
  "List all my saved sites",
  "What canopy intervention would help my hottest site?",
];

// Local-only key for bucketing chat history in "all sites" mode — never sent
// to /api/copilot/chat (the request always sends the real, nullable siteId
// prop); lib/copilotHistory.ts's storage key just needs some non-null
// string to key localStorage by, and this keeps that file's `siteId: string`
// signature untouched rather than threading null through it too.
const ALL_SITES_HISTORY_KEY = "__all_sites__";

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const TOOL_DATA_RENDERERS: Record<string, (data: unknown) => JSX.Element | null> = {
  get_site_data: (data) => <SiteSnapshotCard data={data} />,
  get_hotspot: (data) => <HotspotZoneMiniChart data={data} />,
  simulate_roi: (data) => <RoiResultMiniCard data={data} />,
  compare_interventions: (data) => <InterventionComparisonMiniTable data={data} />,
  compare_all_sites: (data) => <AllSitesRankingMiniTable data={data} />,
};

function TraceRow({ item }: { item: TraceItem }) {
  const Icon = item.stage === "reading" ? Search : CheckCircle2;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
      <Icon size={12} className={item.stage === "reading" ? "text-fg-muted" : "text-emerald-500"} />
      {item.label}
    </div>
  );
}

function AssistantTurn({ msg }: { msg: AssistantMsg }) {
  return (
    <div className="flex max-w-[85%] flex-col gap-2">
      {msg.trace.length > 0 && (
        <div className="flex flex-col gap-1 border-l-2 border-border-subtle pl-2.5">
          {msg.trace.map((t) => (
            <TraceRow key={t.id} item={t} />
          ))}
        </div>
      )}

      {Object.entries(msg.toolData).map(([tool, data]) => {
        const render = TOOL_DATA_RENDERERS[tool];
        return render ? <div key={tool}>{render(data)}</div> : null;
      })}

      {msg.notices.map((n, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {n}
        </p>
      ))}

      {msg.thinking && <ThinkingIndicator />}

      {msg.error ? (
        <p className="rounded-card-sm bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          Something went wrong: {msg.error}
        </p>
      ) : (
        msg.content && (
          <div className="rounded-card-sm bg-surface-2 px-3 py-2.5">
            <MarkdownMessage content={msg.content} />
          </div>
        )
      )}
    </div>
  );
}

function EmptyState({ siteId, onPick }: { siteId: string | null; onPick: (question: string) => void }) {
  const questions = siteId ? SITE_SUGGESTED_QUESTIONS : ALL_SITES_SUGGESTED_QUESTIONS;
  return (
    // Vertical centering uses `m-auto` on the inner wrapper rather than
    // `justify-center` on this scroll container: with justify-center, once
    // the content (icon + heading + text + buttons) is taller than the
    // available space, the top of the content (the icon/heading) overflows
    // past the scrollable area and gets clipped with no way to scroll up to
    // it. `m-auto` centers only when there's slack and otherwise falls back
    // to flex-start, so the icon and heading always render in full.
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-3 text-center">
      <div className="m-auto flex flex-col items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkles size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-fg-primary">
            {siteId ? "How can I help you understand this site?" : "How can I help across all your sites?"}
          </h2>
          <p className="mx-auto mt-0.5 max-w-sm text-xs leading-snug text-fg-muted">
            {siteId
              ? "Ask about heat, hotspots, interventions, ROI, new-building feasibility, or attach a field photo — the Copilot only answers from data already saved for this site."
              : "Ask about heat, hotspots, or comparisons across every site you've saved. Name a specific site for detail on it, or the Copilot will ask which one you mean."}
          </p>
        </div>
        <div className="flex max-w-xl flex-wrap justify-center gap-1.5">
          {questions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-xs text-fg-secondary transition-colors duration-200 hover:border-accent-border hover:text-accent"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function storedTurnsToMessages(turns: CopilotChatTurn[]): Msg[] {
  return turns.map((t) =>
    t.role === "user"
      ? { id: newId(), role: "user", content: t.content }
      : { id: newId(), role: "assistant", content: t.content, trace: [], toolData: {}, notices: [], thinking: false, streaming: false },
  );
}

export default function CopilotChat({ siteId }: { siteId: string | null }) {
  // Chat-history storage (lib/copilotHistory.ts) needs a non-null string key
  // — "all sites" mode buckets its history under a fixed local key instead
  // of threading null through that file's storage-key format. The real,
  // possibly-null siteId (below) is what's actually sent to the API.
  const historyKey = siteId ?? ALL_SITES_HISTORY_KEY;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [conversationId, setConversationId] = useState(() => newId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversationTitleRef = useRef<string | null>(null);
  const conversationCreatedAtRef = useRef<number>(Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setConversations(loadConversations(historyKey));
  }, [historyKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function persistTurn(turns: CopilotChatTurn[]) {
    if (turns.length === 0) return;
    if (!conversationTitleRef.current) {
      const firstUser = turns.find((t) => t.role === "user");
      conversationTitleRef.current = makeConversationTitle(firstUser?.content ?? "New conversation");
    }
    saveConversation(historyKey, {
      id: conversationId,
      siteId: historyKey,
      createdAt: conversationCreatedAtRef.current,
      updatedAt: Date.now(),
      title: conversationTitleRef.current,
      messages: turns,
    });
    setConversations(loadConversations(historyKey));
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(newId());
    conversationTitleRef.current = null;
    conversationCreatedAtRef.current = Date.now();
    setInput("");
    setPendingImage(null);
  }

  function handleSelectConversation(conversation: StoredConversation) {
    setMessages(storedTurnsToMessages(conversation.messages));
    setConversationId(conversation.id);
    conversationTitleRef.current = conversation.title;
    conversationCreatedAtRef.current = conversation.createdAt;
    setInput("");
    setPendingImage(null);
  }

  function applyEvent(assistantId: string, event: CopilotEvent) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || m.role !== "assistant") return m;
        switch (event.type) {
          case "status":
            if (event.stage === "thinking") return { ...m, thinking: true };
            return { ...m, trace: [...m.trace, { id: newId(), stage: event.stage, label: event.label }] };
          case "tool_data":
            return { ...m, toolData: { ...m.toolData, [event.tool]: event.data } };
          case "notice":
            return { ...m, notices: [...m.notices, event.message] };
          case "token":
            return { ...m, thinking: false, content: m.content + event.text };
          case "error":
            return { ...m, thinking: false, streaming: false, error: event.message };
          case "done":
            return { ...m, streaming: false };
          default:
            return m;
        }
      }),
    );
  }

  function handleFileSelect(file: File | undefined) {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Please attach an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setImageError("Photo is too large — please attach one under 3MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPendingImage({ dataUrl: reader.result, name: file.name });
      }
    };
    reader.onerror = () => setImageError("Couldn't read that file — try a different one.");
    reader.readAsDataURL(file);
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !pendingImage) || sending) return;

    const userMsg: UserMsg = {
      id: newId(),
      role: "user",
      content: text || "What do you see in this photo?",
      imagePreviewUrl: pendingImage?.dataUrl,
    };
    const assistantId = newId();
    const assistantMsg: AssistantMsg = {
      id: assistantId,
      role: "assistant",
      content: "",
      trace: [],
      toolData: {},
      notices: [],
      thinking: false,
      streaming: true,
    };

    const requestHistory: CopilotChatTurn[] = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    const imageDataUrl = pendingImage?.dataUrl ?? null;

    setInput("");
    setPendingImage(null);
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setSending(true);

    // Tracked locally alongside the streamed UI state (applyEvent) purely so
    // the final text is available synchronously right after the loop below,
    // without waiting on React state (which wouldn't reflect the last
    // setMessages call yet at that point) — used only to persist history.
    let accumulatedContent = "";
    let turnFailed = false;

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, messages: requestHistory, imageDataUrl }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const event = JSON.parse(payload) as CopilotEvent;
            if (event.type === "token") accumulatedContent += event.text;
            if (event.type === "error") turnFailed = true;
            applyEvent(assistantId, event);
          } catch {
            // Ignore a malformed SSE chunk rather than aborting the whole turn.
          }
        }
      }
    } catch (err) {
      turnFailed = true;
      applyEvent(assistantId, {
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSending(false);
      if (!turnFailed) {
        persistTurn([...requestHistory, { role: "assistant", content: accumulatedContent }]);
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex shrink-0 items-center justify-end pb-1">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          className="flex items-center gap-1.5 rounded-btn px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors duration-200 hover:bg-surface-2 hover:text-fg-primary"
        >
          <Clock size={14} />
          History
        </button>
        <CopilotHistoryMenu
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          conversations={conversations}
          activeId={conversationId}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
        />
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-1 py-1">
        {messages.length === 0 ? (
          <EmptyState
            siteId={siteId}
            onPick={(q) => {
              setInput(q);
              textareaRef.current?.focus();
            }}
          />
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex flex-col items-end gap-1.5">
                {m.imagePreviewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imagePreviewUrl} alt="Attached field photo" className="max-h-40 max-w-[60%] rounded-card-sm object-cover" />
                )}
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-card-sm bg-accent px-3 py-2 text-sm text-accent-fg">
                  {m.content}
                </p>
              </div>
            ) : (
              <AssistantTurn key={m.id} msg={m} />
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>

      {pendingImage && (
        <div className="mb-2 flex items-center gap-2 rounded-card-sm border border-border-subtle px-2 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingImage.dataUrl} alt="" className="h-10 w-10 rounded object-cover" />
          <span className="flex-1 truncate text-xs text-fg-secondary">{pendingImage.name}</span>
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            className="rounded p-1 text-fg-muted transition-colors duration-200 hover:bg-surface-2 hover:text-fg-primary"
            aria-label="Remove attached photo"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {imageError && <p className="mb-2 text-[11px] text-red-600 dark:text-red-400">{imageError}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex shrink-0 items-end gap-2 border-t border-border-subtle pt-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            handleFileSelect(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach a field photo for the Copilot to analyze"
          className="shrink-0 rounded-btn border border-border-subtle p-2.5 text-fg-secondary transition-colors duration-200 hover:bg-surface-2 hover:text-fg-primary"
        >
          <Paperclip size={16} />
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            pendingImage
              ? "Ask about this photo (optional)…"
              : siteId
                ? "Ask the Copilot about this site…"
                : "Ask the Copilot about any of your sites…"
          }
          rows={1}
          className="min-h-[42px] flex-1 resize-none rounded-btn border border-border-subtle bg-transparent px-3 py-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent-border"
        />

        <button
          type="submit"
          disabled={sending || (!input.trim() && !pendingImage)}
          className="shrink-0 rounded-btn bg-accent p-2.5 text-accent-fg transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
