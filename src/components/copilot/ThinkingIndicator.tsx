"use client";

// Matches the reference UI's "Thinking" pill (src/public/aicopilot2.png) —
// shown between the tool trace and the streamed answer.
export default function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </span>
      Thinking
    </div>
  );
}
