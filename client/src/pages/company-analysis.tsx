import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CompanyAnalysis } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Globe,
  TrendingUp,
  Shield,
  Target,
  ChevronDown,
  ChevronRight,
  Trash2,
  Loader2,
  Search,
  BarChart3,
  Compass,
  AlertTriangle,
  Sparkles,
  MessageCircleQuestion,
  Send,
} from "lucide-react";

function getOutlookBadge(outlook: string) {
  const firstLine = outlook.split("\n")[0].toLowerCase().replace(/[*:#]/g, "").trim();
  const verdictMatch = firstLine.match(/\b(growing|declining|mixed|stable)\b/);
  const verdict = verdictMatch ? verdictMatch[1] : null;
  if (verdict === "growing") return { label: "Growing", className: "text-green-600 dark:text-green-400" };
  if (verdict === "declining") return { label: "Declining", className: "text-red-600 dark:text-red-400" };
  if (verdict === "mixed") return { label: "Mixed", className: "text-amber-600 dark:text-amber-400" };
  return { label: "Stable", className: "text-blue-600 dark:text-blue-400" };
}

function stripVerdictLine(text: string): string {
  const lines = text.split("\n");
  const firstLine = lines[0].replace(/[*:#]/g, "").trim().toLowerCase();
  if (/^(verdict\s*:?\s*)?(growing|stable|declining|mixed)\s*$/i.test(firstLine) ||
      /^\*?\*?(verdict|growing|stable|declining|mixed)\*?\*?\s*$/i.test(lines[0].trim())) {
    return lines.slice(1).join("\n").replace(/^\s*\n/, "");
  }
  return text;
}


function CitationRef({ num }: { num: string }) {
  return (
    <sup
      className="text-[10px] font-bold text-primary cursor-default ml-[1px] align-super"
      title={`Source [${num}]`}
      data-testid={`citation-ref-${num}`}
    >[{num}]</sup>
  );
}

function renderWithCitations(text: string, keyPrefix: string) {
  const citationPattern = /\[(\d+)\]/g;
  const segments: (string | { num: string })[] = [];
  let lastIndex = 0;
  let match;
  while ((match = citationPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    segments.push({ num: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }
  return segments.map((seg, i) =>
    typeof seg === "string"
      ? <span key={`${keyPrefix}-${i}`}>{seg}</span>
      : <CitationRef key={`${keyPrefix}-${i}`} num={seg.num} />
  );
}

function RichText({ text }: { text: string }) {
  const verdictPatterns: Record<string, string> = {
    "GROWING": "text-green-600 dark:text-green-400 font-bold",
    "STABLE": "text-blue-600 dark:text-blue-400 font-bold",
    "DECLINING": "text-red-600 dark:text-red-400 font-bold",
    "MIXED": "text-amber-600 dark:text-amber-400 font-bold",
    "High": "text-green-600 dark:text-green-400 font-semibold",
    "Medium": "text-amber-600 dark:text-amber-400 font-semibold",
    "Low": "text-red-600 dark:text-red-400 font-semibold",
  };

  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const verdictClass = verdictPatterns[part.trim()];
          if (verdictClass) {
            return <span key={i} className={verdictClass}>{renderWithCitations(part, `v${i}`)}</span>;
          }
          const isProduct = /^(Demandbase One|Advertising|Data)$/i.test(part.trim());
          if (isProduct) {
            return <span key={i} className="font-bold text-primary">{renderWithCitations(part, `p${i}`)}</span>;
          }
          return <strong key={i} className="font-semibold text-foreground">{renderWithCitations(part, `b${i}`)}</strong>;
        }
        return <span key={i}>{renderWithCitations(part, `t${i}`)}</span>;
      })}
    </>
  );
}

const COLOR_SETS: Record<string, { text: string; bg: string }> = {
  "text-emerald-600 dark:text-emerald-400": { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500" },
  "text-blue-600 dark:text-blue-400": { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500" },
  "text-green-600 dark:text-green-400": { text: "text-green-600 dark:text-green-400", bg: "bg-green-500" },
  "text-amber-600 dark:text-amber-400": { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500" },
  "text-primary": { text: "text-primary", bg: "bg-primary" },
};

function MarkdownRenderer({ content, sectionColor }: { content: string; sectionColor?: string }) {
  const lines = content.split("\n");
  const key = sectionColor || "text-primary";
  const colors = COLOR_SETS[key] || { text: key, bg: "bg-primary" };
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={i} className={`font-semibold text-sm mt-4 mb-1 pb-1 border-b ${colors.text}`}>
              {trimmed.replace(/^### /, "")}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={i} className={`font-bold text-base mt-5 mb-2 underline underline-offset-4 decoration-1 ${colors.text}`}>
              {trimmed.replace(/^## /, "")}
            </h3>
          );
        }

        const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numberedMatch) {
          return (
            <div key={i} className="flex gap-2.5 pl-1">
              <span className={`font-bold shrink-0 min-w-[1.25rem] text-right ${colors.text}`}>{numberedMatch[1]}.</span>
              <span className="font-semibold text-foreground"><RichText text={numberedMatch[2]} /></span>
            </div>
          );
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const bulletText = trimmed.slice(2);
          const hasColon = bulletText.indexOf(":");
          if (hasColon > 0 && hasColon < 60) {
            const label = bulletText.slice(0, hasColon).replace(/\*\*/g, "");
            const rest = bulletText.slice(hasColon).replace(/^\:\s*\*\*\s*/, ": ");
            return (
              <div key={i} className="flex gap-2 pl-3">
                <span className={`mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full ${colors.bg}`} />
                <span className="text-foreground/80">
                  <span className="font-semibold text-foreground">{label}</span>
                  <RichText text={rest} />
                </span>
              </div>
            );
          }
          return (
            <div key={i} className="flex gap-2 pl-3">
              <span className={`mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full ${colors.bg}`} />
              <span className="text-foreground/80"><RichText text={bulletText} /></span>
            </div>
          );
        }
        return <p key={i} className="text-foreground/80"><RichText text={trimmed} /></p>;
      })}
    </div>
  );
}

const SECTION_COLORS: Record<string, { icon: string; heading: string }> = {
  "Financial Outlook": { icon: "text-emerald-500", heading: "text-emerald-600 dark:text-emerald-400" },
  "Strategic Direction": { icon: "text-blue-500", heading: "text-blue-600 dark:text-blue-400" },
  "Growth Signals": { icon: "text-green-500", heading: "text-green-600 dark:text-green-400" },
  "Risks & Challenges": { icon: "text-amber-500", heading: "text-amber-600 dark:text-amber-400" },
  "Demandbase Opportunity": { icon: "text-primary", heading: "text-primary" },
};

function AnalysisSection({
  title,
  icon: Icon,
  content,
  defaultOpen = false,
  badge,
}: {
  title: string;
  icon: typeof TrendingUp;
  content: string;
  defaultOpen?: boolean;
  badge?: { label: string; className?: string };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = SECTION_COLORS[title] || { icon: "text-muted-foreground", heading: "text-primary" };

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`button-toggle-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <Icon className={`h-4 w-4 shrink-0 ${colors.icon}`} />
        <span className="font-medium text-sm">{title}</span>
        {badge && (
          <>
            <span className="text-muted-foreground text-sm">—</span>
            <span className={`font-bold text-sm ${badge.className || ""} bg-transparent hover:bg-transparent px-0`}>
              {badge.label.toUpperCase()}
            </span>
          </>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t bg-muted/10">
          <div className="pt-3">
            <MarkdownRenderer content={content} sectionColor={colors.heading} />
          </div>
        </div>
      )}
    </div>
  );
}

type QAEntry = { question: string; answer: string };

function AnalysisQA({ analysisId }: { analysisId: number }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QAEntry[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [selectedModel] = useSelectedModel("selectedModel-pca");
  const { toast } = useToast();

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || isAsking) return;
    setIsAsking(true);
    setQuestion("");
    try {
      const res = await apiRequest("POST", `/api/company-analysis/${analysisId}/ask`, { question: q, model: selectedModel });
      const data = await res.json();
      setHistory(prev => [...prev, { question: q, answer: data.answer }]);
    } catch (err: any) {
      toast({ title: "Failed to get answer", description: err.message, variant: "destructive" });
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`qa-section-${analysisId}`}>
      <div className="flex items-center gap-2 p-3 bg-primary/5 border-b">
        <MessageCircleQuestion className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">Ask About This Analysis</span>
        <span className="text-[10px] text-muted-foreground ml-auto">Answers grounded in analysis data only</span>
      </div>

      {history.length > 0 && (
        <div className="px-4 pt-3 space-y-3 max-h-[400px] overflow-y-auto">
          {history.map((entry, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex gap-2">
                <span className="text-xs font-semibold text-primary shrink-0 mt-0.5">Q:</span>
                <p className="text-sm font-medium text-foreground" data-testid={`text-qa-question-${analysisId}-${i}`}>{entry.question}</p>
              </div>
              <div className="flex gap-2">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">A:</span>
                <div className="text-sm text-foreground/80 prose prose-sm dark:prose-invert max-w-none" data-testid={`text-qa-answer-${analysisId}-${i}`}>
                  <MarkdownRenderer content={entry.answer} sectionColor="text-primary" />
                </div>
              </div>
              {i < history.length - 1 && <div className="border-b border-dashed" />}
            </div>
          ))}
        </div>
      )}

      <div className="p-3 flex gap-2 items-end">
        <div className="flex-1 relative">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
            placeholder="Ask a question about this analysis..."
            className="resize-none min-h-[40px] max-h-[80px] text-sm pr-8"
            rows={1}
            disabled={isAsking}
            data-testid={`input-qa-question-${analysisId}`}
          />
          <VoiceInputButton
            onTranscript={(text) => setQuestion((prev) => prev ? prev + " " + text : text)}
            className="absolute right-1 top-1"
            disabled={isAsking}
          />
        </div>
        <Button
          size="icon"
          className="shrink-0 h-[40px] w-[40px]"
          onClick={handleAsk}
          disabled={!question.trim() || isAsking}
          data-testid={`button-qa-ask-${analysisId}`}
        >
          {isAsking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function AnalysisCard({ analysis, onDelete }: { analysis: CompanyAnalysis; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(true);
  const outlookBadge = getOutlookBadge(analysis.financialOutlook);

  return (
    <Card data-testid={`card-company-analysis-${analysis.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <button
            className="flex items-center gap-2 text-left"
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-toggle-analysis-${analysis.id}`}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">{analysis.companyName}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {analysis.companyWebsite}
                </span>
                {analysis.ticker && (
                  <a
                    href={`https://finance.yahoo.com/quote/${analysis.ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`link-ticker-${analysis.id}`}
                  >
                    ${analysis.ticker}
                  </a>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(analysis.createdAt).toLocaleDateString()}
                </span>
                {analysis.model && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${(MODEL_DISPLAY[analysis.model] || { badge: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" }).badge}`} data-testid={`badge-model-${analysis.id}`}>
                    {(MODEL_DISPLAY[analysis.model] || { label: analysis.model }).label}
                  </span>
                )}
              </div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onDelete(analysis.id)}
              data-testid={`button-delete-analysis-${analysis.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 pt-2">
          <AnalysisSection
            title="Financial Outlook"
            icon={BarChart3}
            content={stripVerdictLine(analysis.financialOutlook)}
            defaultOpen={true}
            badge={outlookBadge}
          />
          <AnalysisSection
            title="Strategic Direction"
            icon={Compass}
            content={analysis.strategicDirection}
          />
          <AnalysisSection
            title="Growth Signals"
            icon={TrendingUp}
            content={analysis.growthSignals}
          />
          <AnalysisSection
            title="Risks & Challenges"
            icon={AlertTriangle}
            content={analysis.risksAndChallenges}
          />
          <AnalysisSection
            title="Demandbase Opportunity"
            icon={Target}
            content={analysis.demandbaseOpportunity}
            defaultOpen={true}
          />
          {analysis.sourcesUsed && analysis.sourcesUsed.length > 0 && (
            <div className="pt-3 border-t space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sources</span>
              <div className="grid gap-1">
                {analysis.sourcesUsed.map((s, i) => {
                  const pipeIndex = s.indexOf(" | ");
                  const hasUrl = pipeIndex > 0 && s.slice(pipeIndex + 3).startsWith("http");
                  const label = hasUrl ? s.slice(0, pipeIndex) : s;
                  const url = hasUrl ? s.slice(pipeIndex + 3) : null;
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground" data-testid={`source-item-${i + 1}`}>
                      <sup className="text-[10px] font-bold text-primary shrink-0 mt-0.5">[{i + 1}]</sup>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid={`source-link-${i + 1}`}>{label}</a>
                      ) : (
                        <span>{label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <AnalysisQA analysisId={analysis.id} />
        </CardContent>
      )}
    </Card>
  );
}

export default function CompanyAnalysisPage() {
  const [website, setWebsite] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-pca");
  const { toast } = useToast();

  const { data: analyses = [], isLoading } = useQuery<CompanyAnalysis[]>({
    queryKey: ["/api/company-analyses"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async (companyWebsite: string) => {
      setProgressMessage("Starting analysis...");

      const res = await fetch("/api/company-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyWebsite, model: selectedModel }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to analyze company");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let result: CompanyAnalysis | null = null;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setProgressMessage(data.step);
            } else if (data.type === "complete") {
              result = data.analysis;
            } else if (data.type === "error") {
              throw new Error(data.error);
            }
          } catch (e: any) {
            if (e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }

      if (buffer.trim().startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.trim().slice(6));
          if (data.type === "complete") result = data.analysis;
          if (data.type === "error") throw new Error(data.error);
        } catch {}
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-analyses"] });
      setWebsite("");
      setProgressMessage("");
      toast({ title: "Analysis complete", description: "Company analysis has been generated." });
    },
    onError: (err: Error) => {
      setProgressMessage("");
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/company-analyses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-analyses"] });
      toast({ title: "Analysis deleted" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = website.trim();
    if (!trimmed) return;
    analyzeMutation.mutate(trimmed);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Building2 className="h-6 w-6 text-primary" />
            Public Company Analysis
          </h1>
          <p className="text-muted-foreground mt-1">
            Analyze public companies' financials, strategy, and Demandbase sales opportunities
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <div className="flex-1 relative flex items-center gap-1">
                <div className="flex-1 relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="Enter company website (e.g. salesforce.com)"
                    className="pl-9"
                    disabled={analyzeMutation.isPending}
                    data-testid="input-company-website"
                  />
                </div>
                <VoiceInputButton onTranscript={(text) => setWebsite((prev) => prev ? prev + " " + text : text)} disabled={analyzeMutation.isPending} />
              </div>
              <Button
                type="submit"
                disabled={!website.trim() || analyzeMutation.isPending}
                data-testid="button-analyze-company"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Analyze
                  </>
                )}
              </Button>
            </form>
            <div className="flex items-center">
              <ModelSelector value={selectedModel} onChange={setSelectedModel} compact data-testid="select-model-pca" />
            </div>
            {analyzeMutation.isPending && progressMessage && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 animate-pulse text-primary" />
                {progressMessage}
              </div>
            )}
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && analyses.length === 0 && !analyzeMutation.isPending && (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <h3 className="font-medium text-muted-foreground">No analyses yet</h3>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Enter a company website above to generate a comprehensive financial and strategic analysis
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {analyses.map((analysis) => (
            <AnalysisCard
              key={analysis.id}
              analysis={analysis}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}