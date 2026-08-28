// Drives one AI Copilot turn (project.md §6): resolves tool calls against
// DeepSeek in a loop, then yields the final answer as a sequence of events
// the API route streams to the client over SSE. Kept separate from the route
// handler so the tool-calling logic is testable/reusable without spinning up
// a Request/Response pair.
import "server-only";
import { chatCompletion, VISION_MODEL, type ChatMessage } from "./deepseek";
import { COPILOT_TOOLS, executeCopilotTool, readingLabelFor, fetchSiteSummary, type CopilotToolContext } from "./copilotTools";
import type { CopilotChatTurn, CopilotEvent } from "./copilotTypes";

// Safety valve against a runaway back-and-forth if a model keeps requesting
// tools indefinitely — one hop is one get_site_data-style round trip. Bumped
// from the original 4 now that §6 registers 7 tools and a single question
// (e.g. "recommend something and price it out") can legitimately chain 2-3
// of them.
const MAX_TOOL_HOPS = 6;

function buildSystemPrompt(ctx: CopilotToolContext): string {
  return [
    "You are the HeatOps AI Copilot, embedded in an urban-heat-analysis platform built for the FortyGuard Hackathon'26.",
    "You answer questions about sites already analyzed in Map View and Operational Analyst: heat exposure, land-cover, forecasts, zone-level hotspots, intervention recommendations, ROI, and new-building feasibility.",
    "Hard rules:",
    "- Only use data already stored for a site, via your tools. Never claim to fetch new live data from FortyGuard, satellite imagery, or weather services — that only happens in Map View.",
    "- If a tool reports data as synthetic/cached or unavailable, say so plainly instead of presenting it as a real measurement.",
    "- Be concise and concrete: cite actual numbers from tool results instead of vague language. When referring to a zone, use its compass-position label (e.g. 'North', 'Southeast' — get_hotspot/check_new_building_feasibility already return it as zoneLabel) so it matches the Hotspot Detection tab's chart and map overlay. Never use the retired letter scheme ('Zone A'-'Zone I').",
    "- simulate_roi and compare_interventions always start from HeatOps' standard planning defaults, not whatever a user may have typed into the Heat Mitigation Planner dashboard form — say so if relevant.",
    "- If answering would need a capability you don't have a tool for (e.g. route/logistics planning, or anything requiring a brand-new live FortyGuard call), say that plainly instead of guessing.",
    "",
    "Single-site vs. cross-site tools — every other tool (get_site_data, get_hotspot, recommend_intervention, " +
      "simulate_roi, compare_interventions, check_new_building_feasibility, generate_report) needs ONE specific " +
      "site's id and answers about that one site only. get_all_sites and compare_all_sites are the opposite: they " +
      "look across every saved site and deliberately do NOT return per-zone/tile-level detail (too heavy to fetch " +
      "for all sites at once). Use this to decide which kind of tool a question needs:",
    "- A question comparing or listing sites ('which of my sites is hottest', 'list my sites', 'rank my sites by ...') → compare_all_sites (for a ranking/comparison) or get_all_sites (for a plain listing). Never try to rank sites yourself from memory or from a single get_site_data call — call compare_all_sites so the numbers and rounding are consistent.",
    "- A question about ONE site's detail (hotspot zones, a recommendation, ROI, building feasibility, a report) → the matching single-site tool, passing that site's id.",
    ctx.siteId
      ? `The user currently has site ${ctx.siteId} open in the Copilot — use it as the default siteId for single-site tools when the question doesn't name a different site. (Cross-site tools are still available if the user asks how this site compares to their others.)`
      : "No site is currently open (the user is in 'all sites' mode) — a single-site tool call with no siteId will " +
        "fail here (there is no 'currently open' site to fall back to), so for a single-site question: if the " +
        "user's message names a specific site (e.g. 'what canopy does Gigafactory Texas need'), your VERY FIRST " +
        "tool call this turn MUST be get_all_sites, to find the id whose name matches — do not call any " +
        "single-site tool before that, it will just fail and waste a round trip. Once you have the id, call the " +
        "single-site tool with it directly — don't ask the user to repeat a name they already gave. Only ask the " +
        "user which site they mean if no site was named, or if the name doesn't clearly match exactly one saved " +
        "site (say which sites you found close matches for).",
  ].join("\n");
}

function buildVisionSystemPrompt(ctx: CopilotToolContext, siteContext: Record<string, unknown> | null): string {
  const lines = [
    "You are the HeatOps AI Copilot's field-photo analysis mode, embedded in an urban-heat-analysis platform.",
    "The user has attached a photo taken at or near a site and wants your read on heat-relevant conditions: shade/canopy coverage, exposed hardscape (asphalt/concrete/roofing), signs of heat stress, or opportunities for mitigation (tree planting, shading structures, cool pavement, etc.).",
    "Be concrete about what you actually see in the image. Do not invent precise measurements from a photo — describe what's visible and reason qualitatively.",
    "You have no tools in this mode — you cannot look up additional site data beyond what's given below.",
  ];
  if (siteContext) {
    lines.push(`Known data for this site (from HeatOps, not derived from the photo): ${JSON.stringify(siteContext)}`);
    lines.push("If relevant, connect what you see in the photo to this site's saved heat/land-cover data — but don't fabricate a connection if the photo doesn't clearly relate to a specific saved metric.");
  } else if (ctx.siteId) {
    lines.push("No saved site data could be loaded for context — analyze the photo on its own.");
  }
  return lines.join("\n");
}

// Word-by-word reveal of the (already fully known) final answer, so the UI
// gets the same progressive "typing" feel real token streaming would give,
// without needing to parse DeepSeek's streamed tool-call delta format for a
// call whose result isn't shown until it completes anyway.
function chunkWords(text: string): string[] {
  const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let buf = "";
  for (const part of parts) {
    buf += part;
    if (!/^\s+$/.test(part)) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* revealAnswer(text: string): AsyncGenerator<CopilotEvent> {
  yield { type: "status", stage: "thinking", label: "Thinking" };
  for (const chunk of chunkWords(text)) {
    yield { type: "token", text: chunk };
    await sleep(15);
  }
  yield { type: "done" };
}

// analyze_field_photo (project.md §6) isn't a callable tool in the normal
// sense — the model can't produce image bytes as a tool argument, so an
// attached photo routes the whole turn through DeepSeek's experimental
// vision model instead of the tool-calling loop below. No tools are attached
// to this call: combining vision input with function-calling on a
// preview-status model is unverified, so site grounding is fetched directly
// (fetchSiteSummary) and embedded as plain text rather than offered as a tool.
async function* runPhotoAnalysis(
  history: CopilotChatTurn[],
  imageDataUrl: string,
  ctx: CopilotToolContext,
): AsyncGenerator<CopilotEvent> {
  yield { type: "status", stage: "reading", label: "Analyzing photo…" };

  const siteContext = ctx.siteId ? await fetchSiteSummary(ctx.siteId) : null;
  if (ctx.siteId && siteContext) {
    yield { type: "status", stage: "tool_result", label: `Loaded context for ${siteContext.name ?? "this site"}` };
  }

  const lastUserText = history[history.length - 1]?.content ?? "What do you see in this photo?";
  const priorTurns = history.slice(0, -1);

  const messages: ChatMessage[] = [
    { role: "system", content: buildVisionSystemPrompt(ctx, siteContext) },
    ...priorTurns.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    {
      role: "user",
      content: [
        { type: "text", text: lastUserText },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  try {
    const message = await chatCompletion(messages, undefined, VISION_MODEL);
    const text = message.content ?? "I couldn't produce an analysis for this photo.";
    yield* revealAnswer(text);
  } catch {
    // The vision model is an "Exp" preview release — degrade to a plain
    // text-only note rather than failing the whole turn if it's unavailable.
    yield {
      type: "notice",
      message: "Photo analysis is temporarily unavailable (DeepSeek's vision model didn't respond) — falling back to text-only.",
    };
    try {
      const fallbackMessages: ChatMessage[] = [
        {
          role: "system",
          content:
            buildVisionSystemPrompt(ctx, siteContext) +
            "\nNote: the actual photo could not be analyzed right now — you cannot see it. Say so, and answer only from the user's text.",
        },
        ...priorTurns.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
        { role: "user", content: lastUserText },
      ];
      const fallback = await chatCompletion(fallbackMessages);
      yield* revealAnswer(fallback.content ?? "I couldn't analyze this right now — please try again shortly.");
    } catch (err2) {
      yield { type: "error", message: err2 instanceof Error ? err2.message : "Unknown error" };
    }
  }
}

async function* runToolCallingTurn(history: CopilotChatTurn[], ctx: CopilotToolContext): AsyncGenerator<CopilotEvent> {
  const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(ctx) }, ...history];

  let finalText: string;
  let hops = 0;

  while (true) {
    const message = await chatCompletion(messages, COPILOT_TOOLS);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalText = message.content ?? "I don't have a good answer for that right now.";
      break;
    }

    if (hops >= MAX_TOOL_HOPS) {
      finalText = "I wasn't able to finish gathering data for this — try rephrasing your question.";
      break;
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      yield { type: "status", stage: "reading", label: readingLabelFor(call) };
      const result = await executeCopilotTool(call, ctx);
      yield { type: "status", stage: "tool_result", label: result.summaryLabel };
      yield { type: "tool_data", tool: call.function.name, data: result.structured };
      messages.push({ role: "tool", tool_call_id: call.id, content: result.resultJson });
    }

    hops++;
  }

  yield* revealAnswer(finalText);
}

export async function* runCopilotTurn(
  history: CopilotChatTurn[],
  ctx: CopilotToolContext,
  imageDataUrl?: string | null,
): AsyncGenerator<CopilotEvent> {
  try {
    if (imageDataUrl) {
      yield* runPhotoAnalysis(history, imageDataUrl, ctx);
    } else {
      yield* runToolCallingTurn(history, ctx);
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : "Unknown error" };
  }
}
