// DeepSeek API client (project.md §6) — OpenAI-compatible chat-completions
// endpoint, called with a plain `fetch` rather than the `openai` SDK package:
// the surface area needed here (one completion call, optional tool-calling)
// is small enough that adding a whole dependency for it isn't worth it.
// Server-only, same guarantee as lib/fortyguard.ts and lib/supabaseServer.ts
// — DEEPSEEK_API_KEY must never reach the client bundle.
import "server-only";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: DeepseekToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

// DeepSeek's experimental multimodal model (launched Aug 2026) — text-only
// models (deepseek-chat/deepseek-reasoner) reject image content outright, so
// analyze_field_photo routes through this model instead of the configured
// DEEPSEEK_MODEL. Not used for tool-calling turns: combining vision input
// with function-calling on a preview-status model is unverified, so
// lib/copilotOrchestrator.ts's photo-analysis branch never attaches tools to
// a call using this model.
export const VISION_MODEL = "deepseek-v4-flash-vision-exp";

export type DeepseekToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type CompletionMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: DeepseekToolCall[];
};

function baseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
}

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set");
  return key;
}

function model(): string {
  return process.env.DEEPSEEK_MODEL || "deepseek-chat";
}

// Non-streaming call, used for every hop of the tool-calling loop (see
// lib/copilotOrchestrator.ts) — DeepSeek streams tool-call arguments as
// fragments that would need reassembling before any of them are usable, so
// there's no UX benefit to streaming a hop whose output isn't shown directly.
// The final answer's "typing" effect is instead simulated by the orchestrator
// chunking this call's plain-text result — see that file for why.
export async function chatCompletion(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  modelOverride?: string,
): Promise<CompletionMessage> {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: modelOverride ?? model(),
      messages,
      ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices?: { message: CompletionMessage }[] };
  const choice = data.choices?.[0];
  if (!choice) throw new Error("DeepSeek API returned no choices");
  return choice.message;
}
