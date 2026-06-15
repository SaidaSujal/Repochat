import React from 'react';

interface MarkdownViewerProps {
  text: string;
}

export function MarkdownViewer({ text }: MarkdownViewerProps) {
  if (!text) return null;

  const parseInlineMarkdown = (inlineText: string): React.ReactNode[] => {
    const parts = inlineText.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-bold text-rc-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={idx} className="bg-rc-bg-secondary border border-rc-border px-1.5 py-0.5 rounded text-xs font-mono text-rc-primary">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  const paragraphs = text.split(/\n\n+/);

  return (
    <div className="space-y-4">
      {paragraphs.map((para, pIdx) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        // Code block check
        if (trimmed.startsWith('```')) {
          const lines = trimmed.split('\n');
          const codeLines = lines.slice(1, -1).join('\n');
          return (
            <pre key={pIdx} className="bg-rc-bg-secondary border border-rc-border p-4 rounded-rc-xl overflow-x-auto text-sm font-mono text-rc-foreground-secondary my-4">
              <code>{codeLines}</code>
            </pre>
          );
        }

        // Bulleted lists check
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const items = trimmed.split(/\n/);
          return (
            <ul key={pIdx} className="list-disc pl-6 space-y-2 my-2">
              {items.map((item, iIdx) => (
                <li key={iIdx} className="text-rc-foreground-secondary text-sm leading-relaxed">
                  {parseInlineMarkdown(item.replace(/^[-*]\s+/, ''))}
                </li>
              ))}
            </ul>
          );
        }

        // Numbered lists check
        if (/^\d+\.\s+/.test(trimmed)) {
          const items = trimmed.split(/\n/);
          return (
            <ol key={pIdx} className="list-decimal pl-6 space-y-2 my-2">
              {items.map((item, iIdx) => (
                <li key={iIdx} className="text-rc-foreground-secondary text-sm leading-relaxed">
                  {parseInlineMarkdown(item.replace(/^\d+\.\s+/, ''))}
                </li>
              ))}
            </ol>
          );
        }

        // Headings check
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={pIdx} className="text-lg font-bold text-rc-foreground mt-6 mb-2">
              {parseInlineMarkdown(trimmed.replace(/^###\s+/, ''))}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={pIdx} className="text-xl font-bold text-rc-foreground mt-8 mb-3">
              {parseInlineMarkdown(trimmed.replace(/^##\s+/, ''))}
            </h2>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1 key={pIdx} className="text-2xl font-bold text-rc-foreground mt-10 mb-4">
              {parseInlineMarkdown(trimmed.replace(/^#\s+/, ''))}
            </h1>
          );
        }

        // Regular paragraphs
        return (
          <p key={pIdx} className="text-rc-foreground-secondary text-sm md:text-base leading-relaxed">
            {parseInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
}
export default MarkdownViewer;
