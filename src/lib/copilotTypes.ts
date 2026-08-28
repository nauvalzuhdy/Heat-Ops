// Shared event/message shapes for the AI Copilot (project.md §6). Deliberately
// dependency-free (no "server-only" import, no deepseek.ts/copilotTools.ts
// imports) so both the server orchestrator and the client chat component can
// import from here without pulling server-only code into the client bundle.

/** One turn already exchanged with DeepSeek — what the client resends each request (stateless server, per §6 "riwayat chat ... opsional"). */
export type CopilotChatTurn = { role: "user" | "assistant"; content: string };

/**
 * One event in the SSE trace for a single assistant turn. Mirrors the visual
 * sequence in the reference UI (src/public/aicopilot1.png/aicopilot2.png):
 * tool trace steps ("reading"/"tool_result") appear first, then a "thinking"
 * pill, then the answer streams in as "token" events.
 */
export type CopilotEvent =
  | { type: "status"; stage: "reading" | "tool_result"; label: string }
  | { type: "status"; stage: "thinking"; label: string }
  | { type: "tool_data"; tool: string; data: unknown }
  /** Non-fatal, worth surfacing to the user (e.g. vision model unavailable, fell back to text-only). */
  | { type: "notice"; message: string }
  | { type: "token"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };
