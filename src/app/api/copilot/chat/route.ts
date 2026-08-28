// AI Copilot chat endpoint (project.md §6 setup dasar). Stateless: the client
// resends the full turn history each request (see components/copilot/
// CopilotChat.tsx), so there's no server-side chat-session store yet — matches
// §6's "riwayat chat ... opsional" and keeps this step's scope to chat UI +
// DeepSeek connection + get_site_data, without adding a new Supabase table.
import { NextRequest } from "next/server";
import { runCopilotTurn } from "@/lib/copilotOrchestrator";
import type { CopilotChatTurn, CopilotEvent } from "@/lib/copilotTypes";

export const dynamic = "force-dynamic";

type RequestBody = {
  siteId: string | null;
  messages: CopilotChatTurn[];
  /** Optional field photo attached to this turn (data: URL) — see copilotOrchestrator.ts's photo-analysis branch. Not persisted anywhere; used only for this one request. */
  imageDataUrl?: string | null;
};

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/;
// Kept well under Vercel serverless functions' ~4.5MB request body limit —
// base64 inflates the original file size by ~33%, so this caps the original
// photo at roughly 3MB.
const MAX_IMAGE_DATA_URL_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: "Missing or empty 'messages'" }), { status: 400 });
  }
  const last = body.messages[body.messages.length - 1];
  if (last.role !== "user" || typeof last.content !== "string" || !last.content.trim()) {
    return new Response(JSON.stringify({ error: "Last message must be a non-empty user message" }), { status: 400 });
  }

  if (body.imageDataUrl != null) {
    if (typeof body.imageDataUrl !== "string" || !DATA_URL_RE.test(body.imageDataUrl)) {
      return new Response(JSON.stringify({ error: "imageDataUrl must be a PNG/JPEG/GIF/WebP data URL" }), { status: 400 });
    }
    if (body.imageDataUrl.length > MAX_IMAGE_DATA_URL_BYTES) {
      return new Response(JSON.stringify({ error: "Photo is too large — please attach one under ~3MB" }), { status: 413 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CopilotEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of runCopilotTurn(body.messages, { siteId: body.siteId ?? null }, body.imageDataUrl)) {
          send(event);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
