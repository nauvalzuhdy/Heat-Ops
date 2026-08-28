"use client";

// Renders a Copilot answer's markdown properly instead of showing raw `##`/
// `**`/`|` characters. Uses react-markdown (a real parser producing a React
// element tree, not string-replace) with remark-gfm for tables/autolinks —
// no `rehype-raw`/`dangerouslySetInnerHTML` anywhere, so arbitrary HTML in a
// model response is never executed, only ever shown as literal text.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-fg-primary first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-fg-primary first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2.5 text-sm font-semibold text-fg-primary first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-fg-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline underline-offset-2 hover:text-accent-strong">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    // react-markdown gives fenced code blocks a `language-xxx` className on
    // the inner <code>; plain inline code has no className — that's the
    // reliable way to tell them apart (not children length/newlines).
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className="block whitespace-pre-wrap break-words font-mono text-[12px]">{children}</code>;
    }
    return (
      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-fg-primary">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-card-sm border border-border-subtle bg-surface-2 p-3 last:mb-0">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border-subtle">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1 font-semibold text-fg-secondary">{children}</th>,
  td: ({ children }) => <td className="border-b border-border-subtle px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-border-subtle" />,
};

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-sm text-fg-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
