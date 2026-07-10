import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function renderInline(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const regex = /\*\*\*(.*?)\*\*\*|\*\*(.*?)\*\*|\*(.*?)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      tokens.push(<strong key={key} className="font-semibold italic">{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      tokens.push(<strong key={key} className="font-semibold">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      tokens.push(<em key={key} className="italic">{match[3]}</em>);
    } else if (match[4] !== undefined) {
      tokens.push(
        <code key={key} className="px-1.5 py-0.5 rounded bg-muted text-[13px] font-mono">{match[4]}</code>
      );
    } else if (match[5] && match[6]) {
      tokens.push(
        <a key={key} href={match[6]} target="_blank" rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80"
          data-testid={`link-inline-${key}`}>{match[5]}</a>
      );
    }
    key++;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex));
  return tokens.length > 0 ? tokens : text;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-border">
      {language && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
          <span className="text-[11px] text-muted-foreground font-mono">{language}</span>
          <button
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-copy-code"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
      <pre className="p-3 overflow-x-auto bg-muted/30">
        <code className="text-[13px] font-mono text-foreground leading-relaxed">{code}</code>
      </pre>
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(<CodeBlock key={i} language={language} code={codeLines.join("\n")} />);
      i++;
      continue;
    }

    if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
      elements.push(<hr key={i} className="my-4 border-border" />);
      i++;
      continue;
    }

    // Pipe tables: header row, separator row (|---|---|), then body rows.
    if (line.trim().startsWith("|") && line.trim().length > 1) {
      const start = i;
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const isSeparator = tableLines.length >= 2 && /^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(tableLines[1]);
      if (isSeparator) {
        const parseRow = (row: string) =>
          row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
        const header = parseRow(tableLines[0]);
        const rows = tableLines.slice(2).map(parseRow);
        elements.push(
          <div key={start} className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {header.map((h, hi) => (
                    <th key={hi} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">{renderInline(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-border last:border-0">
                    {header.map((_, ci) => (
                      <td key={ci} className="px-3 py-2 align-top text-foreground leading-relaxed">{renderInline(r[ci] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      } else {
        // Not a real table — render the collected lines as plain paragraphs.
        tableLines.forEach((tl, ti) => {
          elements.push(
            <p key={`${start}-${ti}`} className="text-sm text-foreground leading-relaxed mb-1.5">{renderInline(tl)}</p>
          );
        });
      }
      continue;
    }

    if (line.startsWith("#### ")) {
      elements.push(
        <h4 key={i} className="text-sm font-semibold text-foreground mt-3 mb-1">{renderInline(line.slice(5))}</h4>
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="text-sm font-bold text-foreground mt-4 mb-1.5">{renderInline(line.slice(4))}</h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="text-base font-bold text-foreground mt-5 mb-2">{renderInline(line.slice(3))}</h2>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} className="text-lg font-bold text-foreground mt-5 mb-3 first:mt-0">{renderInline(line.slice(2))}</h1>
      );
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={i} className="border-l-4 border-muted-foreground/30 pl-4 py-1 my-3 text-sm text-muted-foreground italic">
          {quoteLines.map((ql, qi) => (
            <p key={qi} className="leading-relaxed">{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      elements.push(
        <div key={i} className="flex gap-2 ml-1 mb-1.5">
          <span className="text-muted-foreground shrink-0 font-medium text-sm min-w-[1.25rem] text-right">{numberedMatch[1]}.</span>
          <span className="text-sm text-foreground leading-relaxed">{renderInline(numberedMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    const indentedNumbered = line.match(/^(\s{2,})(\d+)\.\s+(.+)/);
    if (indentedNumbered) {
      const depth = Math.floor(indentedNumbered[1].length / 2);
      elements.push(
        <div key={i} className="flex gap-2 mb-1" style={{ marginLeft: `${(depth + 1) * 12}px` }}>
          <span className="text-muted-foreground shrink-0 font-medium text-sm min-w-[1.25rem] text-right">{indentedNumbered[2]}.</span>
          <span className="text-sm text-foreground/85 leading-relaxed">{renderInline(indentedNumbered[3])}</span>
        </div>
      );
      i++;
      continue;
    }

    const indentedBullet = line.match(/^(\s{2,})([-*])\s+(.+)/);
    if (indentedBullet) {
      const depth = Math.floor(indentedBullet[1].length / 2);
      elements.push(
        <div key={i} className="flex gap-2 mb-1" style={{ marginLeft: `${(depth + 1) * 12}px` }}>
          <span className="text-muted-foreground/60 shrink-0 mt-[7px] h-1 w-1 rounded-full bg-current" />
          <span className="text-sm text-foreground/85 leading-relaxed">{renderInline(indentedBullet[3])}</span>
        </div>
      );
      i++;
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-2 ml-3 mb-1.5">
          <span className="text-muted-foreground shrink-0 mt-[7px] h-1.5 w-1.5 rounded-full bg-current" />
          <span className="text-sm text-foreground leading-relaxed">{renderInline(line.slice(2))}</span>
        </div>
      );
      i++;
      continue;
    }

    if (line.startsWith("**") && line.endsWith("**") && !line.slice(2, -2).includes("**")) {
      elements.push(
        <p key={i} className="text-sm font-semibold text-foreground mt-3 mb-1">{renderInline(line)}</p>
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    elements.push(
      <p key={i} className="text-sm text-foreground leading-relaxed mb-1.5">{renderInline(line)}</p>
    );
    i++;
  }

  return (
    <div className={`space-y-0 ${className}`} data-testid="markdown-content">
      {elements}
    </div>
  );
}
