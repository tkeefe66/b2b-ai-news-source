import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Target, Send, Copy, Check, RotateCcw, Swords, MessageSquare, Mail, FileText, BarChart3, Shield, Presentation, ExternalLink, Loader2, ArrowRight, X, Eye, Save, RefreshCw, ChevronRight, Clock, Trash2, ChevronDown } from "lucide-react";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { SiGoogleslides } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { getTimeAgo } from "@/lib/time";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import type { EnablementContent } from "@shared/schema";

type ContentType = {
  id: string;
  label: string;
  icon: typeof Swords;
  description: string;
  defaultPrompt: string;
};

const CONTENT_TYPES: ContentType[] = [
  { id: "battle-card", label: "Battle Card", icon: Swords, description: "Competitive positioning", defaultPrompt: "Create a competitive battle card" },
  { id: "talk-track", label: "Talk Track", icon: MessageSquare, description: "Discovery & pitch", defaultPrompt: "Create a talk track for discovery and pitch conversations" },
  { id: "email-sequence", label: "Email Sequence", icon: Mail, description: "Outreach templates", defaultPrompt: "Create a prospecting email sequence" },
  { id: "one-pager", label: "One-Pager", icon: FileText, description: "Executive summary", defaultPrompt: "Create a one-pager executive summary" },
  { id: "competitive-intel", label: "Competitive Intel", icon: Shield, description: "Win/loss analysis", defaultPrompt: "Create a competitive intelligence analysis" },
  { id: "roi-story", label: "ROI Story", icon: BarChart3, description: "Business case", defaultPrompt: "Create an ROI story and business case" },
  { id: "deck", label: "Deck", icon: Presentation, description: "Slide presentation", defaultPrompt: "Create a slide presentation deck" },
];


type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type QAItem = {
  question: string;
  answer: string;
};

type ProbeQuestion = {
  id: string;
  question: string;
  why: string;
};

interface EnablementPreview {
  content: string;
  isDeck: boolean;
}

function EnablementPreviewModal({
  preview,
  onClose,
  onRefine,
  onSave,
  onDone,
  isRefining,
  isSaving,
  documentName,
  onDocumentNameChange,
}: {
  preview: EnablementPreview;
  onClose: () => void;
  onRefine: (feedback: string) => void;
  onSave: (format: "document" | "slides") => void;
  onDone: () => void;
  isRefining: boolean;
  isSaving: boolean;
  documentName: string;
  onDocumentNameChange: (name: string) => void;
}) {
  const [refineFeedback, setRefineFeedback] = useState("");
  const [showRefineInput, setShowRefineInput] = useState(false);

  return (
    <div className="mt-3 border-primary/20 border rounded-lg overflow-hidden" data-testid="content-preview-modal">
      <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border-b border-primary/20">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {preview.isDeck ? "Deck Preview" : "Content Preview"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {preview.isDeck ? (
            <Button
              size="sm"
              onClick={() => onSave("slides")}
              disabled={isSaving || isRefining}
              className="h-7 text-xs"
              data-testid="button-save-to-drive"
            >
              {isSaving ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
              ) : (
                <><Save className="h-3 w-3 mr-1" />Save as Slides</>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onSave("document")}
              disabled={isSaving || isRefining}
              className="h-7 text-xs"
              data-testid="button-save-to-drive"
            >
              {isSaving ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
              ) : (
                <><Save className="h-3 w-3 mr-1" />Save to Google Drive</>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" aria-label="Close preview" data-testid="button-close-preview">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-primary/20 bg-primary/5 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wide font-medium">Name:</span>
        <input
          type="text"
          value={documentName}
          onChange={(e) => onDocumentNameChange(e.target.value)}
          className="flex-1 text-xs bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
          placeholder="Enter document name..."
          aria-label="Document name"
          data-testid="input-document-name"
        />
      </div>

      <div className="max-h-[500px] overflow-auto">
        <div className="p-5 bg-white dark:bg-background border-b border-border" data-testid="content-preview-text">
          <div className="max-w-2xl mx-auto prose-sm">
            <MarkdownRenderer content={preview.content} />
          </div>
        </div>
      </div>

      {!preview.isDeck && (
        <div className="px-4 py-2 border-t border-primary/20 bg-primary/5 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSave("slides")}
            disabled={isSaving || isRefining}
            className="h-7 text-xs gap-1.5"
            data-testid="button-save-as-slides"
          >
            <SiGoogleslides className="h-3 w-3 text-yellow-500" />
            Also save as Slides
          </Button>
        </div>
      )}

      <div className="px-4 py-3 bg-primary/5 border-t border-primary/20">
        {!showRefineInput ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={onDone}
                disabled={isRefining || isSaving}
                className="h-8 text-xs flex-1"
                data-testid="button-done-save"
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save &amp; Done
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRefineInput(true)}
                disabled={isRefining || isSaving}
                className="h-8 text-xs border-primary/20 text-primary"
                data-testid="button-show-preview-refine"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refine
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Content is auto-saved. Use Save &amp; Done to name it and return home, or export to Google Drive above.
            </p>
          </div>
        ) : (
          <div data-testid="preview-refine-panel">
            <p className="text-xs font-medium text-primary mb-2">
              What would you like to change?
            </p>
            <div className="relative">
              <Textarea
                placeholder="e.g., Make the tone more conversational, add more data points, shorten the introduction..."
                value={refineFeedback}
                onChange={(e) => setRefineFeedback(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="text-xs resize-none mb-2 pr-8"
                rows={2}
                aria-label="Refinement feedback"
                data-testid="input-preview-refine-feedback"
              />
              <VoiceInputButton
                onTranscript={(text) => setRefineFeedback(prev => prev ? prev + " " + text : text)}
                className="absolute top-1 right-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowRefineInput(false); setRefineFeedback(""); }}
                disabled={isRefining}
                className="h-8"
                data-testid="button-cancel-preview-refine"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (refineFeedback.trim()) {
                    onRefine(refineFeedback.trim());
                    setRefineFeedback("");
                    setShowRefineInput(false);
                  }
                }}
                disabled={!refineFeedback.trim() || isRefining}
                className="h-8"
                data-testid="button-confirm-preview-refine"
              >
                {isRefining ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refining...</>
                ) : (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refine</>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function HistoryCard({
  item,
  isLatest,
  onDelete,
  onContinue,
}: {
  item: EnablementContent;
  isLatest: boolean;
  onDelete: (id: number) => void;
  onContinue: (item: EnablementContent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(item.createdAt);
  const typeInfo = CONTENT_TYPES.find(t => t.id === item.contentType);
  const modelInfo = item.model ? MODEL_DISPLAY[item.model] : null;

  return (
    <Card
      className={`overflow-hidden ${isLatest ? "border-primary/40 shadow-sm" : "border-border"}`}
      data-testid={`card-enablement-history-${item.id}`}
    >
      <div
        className="flex items-start gap-3 p-4 cursor-pointer select-none hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        data-testid={`button-expand-history-${item.id}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isLatest && (
              <Badge className="text-[10px] px-1.5 py-0 bg-sunset text-sunset-foreground">Latest</Badge>
            )}
            {typeInfo && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sunset/40 text-sunset">
                {typeInfo.label}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {getTimeAgo(date)}
            </span>
            {modelInfo && (
              <span className={`text-[10px] font-medium ${modelInfo.color}`} data-testid={`text-model-history-${item.id}`}>
                {modelInfo.label}
              </span>
            )}
            {item.driveUrl && (
              <a
                href={item.driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                data-testid={`link-drive-history-${item.id}`}
              >
                <ExternalLink className="h-3 w-3" />
                Drive
              </a>
            )}
          </div>
          <h3 className="text-sm font-semibold text-foreground leading-tight" data-testid={`text-history-title-${item.id}`}>
            {item.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.prompt}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ConfirmDestructive
            title={`Delete "${item.title}"?`}
            description="This permanently deletes this content from your history. Anything already exported to Google Drive is kept. This can't be undone."
            onConfirm={() => onDelete(item.id)}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={`Delete content "${item.title}"`}
              data-testid={`button-delete-history-${item.id}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </ConfirmDestructive>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm max-h-[400px] overflow-y-auto" data-testid={`text-history-content-${item.id}`}>
            <MarkdownRenderer content={item.content} />
          </div>
          <div className="flex justify-end mt-3 pt-2 border-t border-border">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={(e) => { e.stopPropagation(); onContinue(item); }}
              data-testid={`button-continue-history-${item.id}`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Continue Working
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ContentCreatedBanner({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-4 py-2.5" data-testid="content-created-banner">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium text-green-800 dark:text-green-300">{label} saved</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          data-testid="link-created-content"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open in Google Drive
        </a>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" aria-label="Dismiss notification">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function Enablement() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-enablement");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [phase, setPhase] = useState<"idle" | "loading-questions" | "answering" | "loading-followup" | "generating" | "done">("idle");
  const [questions, setQuestions] = useState<ProbeQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [allQA, setAllQA] = useState<QAItem[]>([]);
  const [followUpRound, setFollowUpRound] = useState(1);
  const [acknowledgment, setAcknowledgment] = useState("");
  const [reaction, setReaction] = useState("");

  const [preview, setPreview] = useState<EnablementPreview | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [createdContent, setCreatedContent] = useState<{ label: string; url: string } | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [savedContentId, setSavedContentId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const historyQuery = useQuery<EnablementContent[]>({
    queryKey: ["/api/enablement/history"],
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/enablement/history/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enablement/history"] });
      toast({ title: "Content deleted" });
    },
    onError: () => {
      toast({ title: "Couldn't delete content", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [generatedContent, conversation, questions, phase, preview]);

  const isDeckContent = selectedType === "deck" || /\b(deck|presentation|slides?|pptx?|powerpoint)\b/i.test(lastPrompt);

  const collectStreamSilently = async (body: Record<string, unknown>): Promise<string> => {
    const response = await fetch("/api/enablement/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });

    if (!response.ok) throw new Error("Request failed");

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";

        for (const line of parts) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              toast({ title: "Error", description: parsed.error, variant: "destructive" });
              break;
            }
            if (parsed.content) {
              accumulated += parsed.content;
            }
          } catch {}
        }
      }

      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6);
        if (data !== "[DONE]") {
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              accumulated += parsed.content;
            }
          } catch {}
        }
      }
    }

    return accumulated;
  };

  const buildPreviewFromContent = (content: string): EnablementPreview => {
    return { content, isDeck: isDeckContent };
  };

  const startProbing = async (text: string, contentTypeOverride?: string) => {
    if (!text.trim() || phase === "loading-questions" || phase === "loading-followup" || phase === "generating") return;

    const userMessage = text.trim();
    const effectiveType = contentTypeOverride || selectedType || undefined;
    setInput("");
    setLastPrompt(userMessage);
    setPhase("loading-questions");
    setGeneratedContent(null);
    setPreview(null);
    setCreatedContent(null);
    setConversation([{ role: "user", content: userMessage }]);
    setAllQA([]);
    setFollowUpRound(1);
    setAcknowledgment("");
    setReaction("");
    setDocumentName("");

    try {
      const response = await fetch("/api/enablement/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, contentType: effectiveType, model: selectedModel }),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Failed to get questions");
      const data = await response.json();

      setQuestions(data.questions || []);
      setAcknowledgment(data.acknowledgment || "");
      setAnswers({});
      setPhase("answering");
    } catch (err) {
      setPhase("idle");
      setConversation([]);
      toast({ title: "Failed to start", description: "Could not generate questions. Please try again.", variant: "destructive" });
    }
  };

  const submitAnswersAndProbe = async () => {
    if (phase === "loading-followup" || phase === "generating") return;
    const answeredQA: QAItem[] = questions
      .map(q => ({ question: q.question, answer: (answers[q.id] || "").trim() }))
      .filter(qa => qa.answer);

    if (answeredQA.length === 0) {
      toast({ title: "Please answer at least one question", variant: "destructive" });
      return;
    }

    const mergedQA = [...allQA, ...answeredQA];
    setAllQA(mergedQA);
    setPhase("loading-followup");

    try {
      const response = await fetch("/api/enablement/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: lastPrompt,
          contentType: selectedType || undefined,
          previousQA: mergedQA,
          round: followUpRound,
          model: selectedModel,
        }),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Follow-up request failed");
      const data = await response.json();

      if (data.ready || !data.questions?.length) {
        setReaction(data.reaction || "");
        generateFromQA(mergedQA);
      } else {
        setReaction(data.reaction || "");
        setQuestions(data.questions);
        setAnswers({});
        setFollowUpRound(prev => prev + 1);
        setPhase("answering");
      }
    } catch (err) {
      setPhase("answering");
      toast({ title: "Follow-up failed", description: "Proceeding to generation.", variant: "destructive" });
      generateFromQA(mergedQA);
    }
  };

  const generateFromQA = async (qaToUse: QAItem[], refinement?: string, previousContent?: string) => {
    setPhase("generating");
    setPreview(null);
    setCreatedContent(null);
    setSavedContentId(null);
    if (!refinement) {
      const typeLabel = CONTENT_TYPES.find(t => t.id === selectedType)?.label || "Enablement";
      setDocumentName(`Demandbase ${typeLabel} - ${new Date().toLocaleDateString()}`);
    }

    const qaFormatted = qaToUse.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n");
    const fullMessage = refinement
      ? `${lastPrompt}\n\n---\nDISCOVERY ANSWERS:\n${qaFormatted}\n\n---\nREFINEMENT REQUEST: ${refinement}\n\nPREVIOUS CONTENT:\n${previousContent}`
      : `${lastPrompt}\n\n---\nDISCOVERY ANSWERS:\n${qaFormatted}`;

    const convo: ChatMessage[] = [
      { role: "user", content: lastPrompt },
      { role: "assistant", content: "I asked probing questions and got detailed answers." },
      { role: "user", content: refinement
        ? `Here are my answers to your questions:\n\n${qaFormatted}\n\nPlease regenerate the content with these changes: ${refinement}`
        : `Here are my answers to your questions:\n\n${qaFormatted}\n\nPlease generate the content now based on all of this.`
      },
    ];
    setConversation(convo);

    try {
      const result = await collectStreamSilently({
        message: fullMessage,
        contentType: selectedType || undefined,
        conversationHistory: convo.slice(0, -1),
        phase: "generate",
        model: selectedModel,
      });

      convo.push({ role: "assistant", content: result });
      setConversation([...convo]);
      setGeneratedContent(result);
      setPreview(buildPreviewFromContent(result));
      setPhase("done");

      const typeLabel = CONTENT_TYPES.find(t => t.id === selectedType)?.label || "Enablement";
      const title = documentName || `Demandbase ${typeLabel} - ${new Date().toLocaleDateString()}`;
      try {
        const saved = await apiRequest("POST", "/api/enablement/history", {
          title, contentType: selectedType || "general", prompt: lastPrompt, content: result, model: selectedModel,
        });
        const savedData = await saved.json();
        setSavedContentId(savedData.id);
        queryClient.invalidateQueries({ queryKey: ["/api/enablement/history"] });
      } catch (saveErr) {
        console.error("Failed to save content to history", saveErr);
        toast({ title: "Couldn't save to history", description: "The content was generated but not saved. Use Save & Done to retry.", variant: "destructive" });
      }
    } catch (err) {
      setPhase("answering");
      toast({ title: "Failed to generate content. You can try again.", variant: "destructive" });
    }
  };

  const skipToGeneration = async () => {
    if (phase === "generating") return;
    const userMessage = lastPrompt || input.trim();
    if (!userMessage) return;

    setInput("");
    setLastPrompt(userMessage);
    setGeneratedContent(null);
    setPreview(null);
    setCreatedContent(null);
    setQuestions([]);
    setAnswers({});
    setAllQA([]);
    setAcknowledgment("");
    setReaction("");
    setPhase("generating");
    setSavedContentId(null);
    const typeLabel = CONTENT_TYPES.find(t => t.id === selectedType)?.label || "Enablement";
    setDocumentName(`Demandbase ${typeLabel} - ${new Date().toLocaleDateString()}`);

    const newConvo: ChatMessage[] = [{ role: "user", content: userMessage }];
    setConversation(newConvo);

    try {
      const result = await collectStreamSilently({
        message: userMessage,
        contentType: selectedType || undefined,
        phase: "generate",
        model: selectedModel,
      });

      newConvo.push({ role: "assistant", content: result });
      setConversation([...newConvo]);
      setGeneratedContent(result);
      setPreview(buildPreviewFromContent(result));
      setPhase("done");

      const title = `Demandbase ${typeLabel} - ${new Date().toLocaleDateString()}`;
      try {
        const saved = await apiRequest("POST", "/api/enablement/history", {
          title, contentType: selectedType || "general", prompt: userMessage, content: result, model: selectedModel,
        });
        const savedData = await saved.json();
        setSavedContentId(savedData.id);
        queryClient.invalidateQueries({ queryKey: ["/api/enablement/history"] });
      } catch (saveErr) {
        console.error("Failed to save content to history", saveErr);
        toast({ title: "Couldn't save to history", description: "The content was generated but not saved. Use Save & Done to retry.", variant: "destructive" });
      }
    } catch (err) {
      setConversation([]);
      setPhase("idle");
      toast({ title: "Failed to generate content", variant: "destructive" });
    }
  };

  const handleRefine = (feedback: string) => {
    if (!generatedContent) return;
    setIsRefining(true);
    generateFromQA(allQA, feedback, generatedContent).finally(() => setIsRefining(false));
  };

  const handleSaveFromPreview = async (format: "document" | "slides") => {
    if (!generatedContent || isSaving) return;
    setIsSaving(true);
    try {
      const typeLabel = CONTENT_TYPES.find(t => t.id === selectedType)?.label || "Enablement";
      const title = documentName.trim() || `Demandbase ${typeLabel} - ${new Date().toLocaleDateString()}`;

      const response = await fetch("/api/enablement/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: generatedContent, title, format, enablementContentId: savedContentId }),
        credentials: "include",
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Export failed");
      }

      const result = await response.json();
      setPreview(null);
      setCreatedContent({
        label: format === "slides" ? "Presentation" : "Document",
        url: result.url,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/enablement/history"] });
      toast({
        title: format === "slides" ? "Presentation created" : "Document created",
        description: "Saved to Field Enablement Output folder in Google Drive",
      });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err.message || "Could not save to Google Drive",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = () => {
    if (phase === "done") {
      reset();
      startProbing(input);
    } else {
      startProbing(input);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDone = async () => {
    const title = documentName.trim() || `Demandbase ${CONTENT_TYPES.find(t => t.id === selectedType)?.label || "Enablement"} - ${new Date().toLocaleDateString()}`;
    if (savedContentId) {
      try {
        await apiRequest("PATCH", `/api/enablement/history/${savedContentId}`, { title });
        queryClient.invalidateQueries({ queryKey: ["/api/enablement/history"] });
      } catch (err) {
        console.error("Failed to update title", err);
        toast({ title: "Couldn't update title", description: "The server didn't respond. The content keeps its previous title.", variant: "destructive" });
      }
    } else if (generatedContent) {
      try {
        await apiRequest("POST", "/api/enablement/history", {
          title, contentType: selectedType || "general", prompt: lastPrompt, content: generatedContent, model: selectedModel,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/enablement/history"] });
      } catch (err) {
        console.error("Failed to save content", err);
        toast({ title: "Couldn't save content", description: "The server didn't respond. Try again.", variant: "destructive" });
      }
    }
    reset();
    toast({ title: "Content saved", description: "You can find it in your history below." });
  };

  const copyToClipboard = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    }
  };

  const reset = () => {
    setGeneratedContent(null);
    setSelectedType(null);
    setInput("");
    setLastPrompt("");
    setConversation([]);
    setPhase("idle");
    setQuestions([]);
    setAnswers({});
    setAllQA([]);
    setFollowUpRound(1);
    setAcknowledgment("");
    setReaction("");
    setPreview(null);
    setIsRefining(false);
    setIsSaving(false);
    setCreatedContent(null);
    setDocumentName("");
    setSavedContentId(null);
    textareaRef.current?.focus();
  };

  const handleContinue = (item: EnablementContent) => {
    setGeneratedContent(item.content);
    setSelectedType(item.contentType);
    setLastPrompt(item.prompt);
    setInput("");
    setConversation([]);
    setPhase("done");
    setQuestions([]);
    setAnswers({});
    setAllQA([]);
    setFollowUpRound(1);
    setAcknowledgment("");
    setReaction("");
    setPreview(null);
    setIsRefining(false);
    setIsSaving(false);
    setCreatedContent(null);
    setDocumentName(item.title);
    setSavedContentId(item.id);
    setShowHistory(false);
    if (item.model) setSelectedModel(item.model);
    toast({ title: "Loaded previous content", description: "You can now refine or export it." });
  };

  const historyItems = historyQuery.data || [];
  const showWelcome = phase === "idle" && conversation.length === 0 && questions.length === 0 && !showHistory;
  const isInQAFlow = phase === "answering" || phase === "loading-questions" || phase === "loading-followup";
  const answeredCount = questions.filter(q => (answers[q.id] || "").trim()).length;
  const contentTypeLabel = CONTENT_TYPES.find(t => t.id === selectedType)?.label || selectedType || "content";

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary shrink-0" />
              <h1 className="text-lg font-semibold leading-tight" data-testid="text-enablement-title">Field Enablement</h1>
            </div>
            {phase === "idle" ? (
              <p className="text-[11px] text-muted-foreground mt-0.5 ml-7 leading-tight hidden sm:block">
                Demandbase sales enablement powered by market intelligence
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-0.5 ml-7 leading-tight truncate">
                {lastPrompt || "Creating content..."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {generatedContent && (
              <Button
                variant="ghost"
                size="sm"
                onClick={copyToClipboard}
                className="h-7 text-[11px] px-2"
                data-testid="button-copy-content"
              >
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
            {phase !== "idle" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                className="h-7 text-[11px] px-2"
                aria-label="Start over"
                data-testid="button-reset"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant={showHistory ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="h-7 text-[11px] px-2"
              aria-label={showHistory ? "Hide content history" : "Show content history"}
              data-testid="button-toggle-history"
            >
              <Clock className="h-3.5 w-3.5 mr-1" />
              {historyItems.length > 0 && (
                <span>{historyItems.length}</span>
              )}
            </Button>
          </div>
        </div>
        <div className="flex items-center mt-2">
          <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
        </div>
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-foreground" data-testid="text-history-heading">Content History</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(false)}
                aria-label="Close history"
                data-testid="button-close-history"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {historyQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : historyItems.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No saved content yet</p>
                <p className="text-xs text-muted-foreground mt-1">Generate content and it will appear here</p>
              </div>
            ) : (
              historyItems.map((item, idx) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  isLatest={idx === 0}
                  onDelete={(id) => deleteHistoryMutation.mutate(id)}
                  onContinue={handleContinue}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4" ref={contentRef}>
          {showWelcome ? (
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8 mt-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
                <Target className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-base font-semibold mb-1" data-testid="text-enablement-welcome">Demandbase Field Enablement Agent</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Tell me what you need and I'll ask a few questions to make sure I create exactly the right material. Output is saved directly to Google Drive.
              </p>
            </div>

            <div className="mb-6">
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">What do you want to create?</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setSelectedType(type.id);
                      startProbing(type.defaultPrompt, type.id);
                    }}
                    className="flex items-center gap-2 p-3 rounded-lg border text-left transition-colors border-border hover:border-primary hover:bg-primary/5 group"
                    data-testid={`button-type-${type.id}`}
                  >
                    <type.icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div>
                      <p className="text-sm font-medium">{type.label}</p>
                      <p className="text-xs text-muted-foreground">{type.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {historyQuery.data && historyQuery.data.length > 0 && (
              <div className="mt-8" data-testid="enablement-history-section">
                <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Recent Content</p>
                <div className="space-y-3">
                  {historyQuery.data.map((item, idx) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      isLatest={idx === 0}
                      onDelete={(id) => deleteHistoryMutation.mutate(id)}
                      onContinue={handleContinue}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : isInQAFlow ? (
          <div className="max-w-3xl mx-auto">
            {(phase === "loading-questions" || phase === "loading-followup") && (
              <div className="flex items-center gap-2 py-8 justify-center" role="status">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {phase === "loading-questions" ? "Preparing targeted questions..." : "Reviewing your answers..."}
                </span>
              </div>
            )}

            {phase === "answering" && questions.length > 0 && (
              <Card className="p-5" data-testid="qa-questions-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2" data-testid="text-questions-heading">
                    <Target className="h-4 w-4 text-primary" />
                    {followUpRound === 1 ? `Shape your ${contentTypeLabel}` : `Follow-up Round ${followUpRound}`}
                  </h3>
                  <Button variant="ghost" size="sm" onClick={reset} data-testid="button-start-over">
                    <X className="h-3.5 w-3.5 mr-1" />
                    Start Over
                  </Button>
                </div>

                <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mb-4" data-testid="msg-user-request">
                  <p className="text-xs font-medium text-primary mb-1">Your request:</p>
                  <p className="text-sm text-foreground italic">{lastPrompt}</p>
                  {selectedType && (
                    <Badge variant="secondary" className="text-[10px] mt-2">
                      {contentTypeLabel}
                    </Badge>
                  )}
                </div>

                {(acknowledgment || reaction) && (
                  <p className="text-sm text-foreground/90 mb-4 leading-relaxed" data-testid="text-qa-reaction">
                    {reaction || acknowledgment}
                  </p>
                )}

                {allQA.length > 0 && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 mb-4" data-testid="previous-qa-summary">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                      Previous answers (Round {followUpRound - 1})
                    </p>
                    <div className="space-y-1">
                      {allQA.map((qa, i) => (
                        <div key={i} className="text-[11px] text-muted-foreground">
                          <span className="font-medium">Q:</span> {qa.question.substring(0, 80)}{qa.question.length > 80 ? "..." : ""} <span className="font-medium ml-1">A:</span> {qa.answer.substring(0, 60)}{qa.answer.length > 60 ? "..." : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground mb-3">
                  Answer what resonates — skip what doesn't. Your answers directly shape the final {contentTypeLabel}.
                </p>

                <div className="space-y-2.5">
                  {questions.map((q, i) => (
                    <div key={q.id} className="rounded-md border border-border bg-background p-2.5" data-testid={`qa-item-${i}`}>
                      <div className="flex items-start gap-1.5 mb-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground leading-snug" data-testid={`text-question-${i}`}>{q.question}</p>
                          {q.why && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 italic">{q.why}</p>
                          )}
                        </div>
                      </div>
                      <div className="relative">
                        <Textarea
                          value={answers[q.id] || ""}
                          onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder="Your thoughts..."
                          className="resize-none text-sm pr-8"
                          rows={2}
                          aria-label={`Answer to question ${i + 1}`}
                          data-testid={`input-answer-${i}`}
                        />
                        <VoiceInputButton
                          onTranscript={(text) => setAnswers(prev => ({ ...prev, [q.id]: (prev[q.id] || "") ? prev[q.id] + " " + text : text }))}
                          className="absolute top-1 right-1"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                  <p className="text-[10px] text-muted-foreground">
                    {answeredCount} of {questions.length} answered{followUpRound > 1 ? ` (follow-up ${followUpRound})` : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={skipToGeneration}
                      data-testid="button-skip-discovery"
                    >
                      <ArrowRight className="h-3 w-3 mr-1" />
                      Skip
                    </Button>
                    <Button
                      size="sm"
                      onClick={submitAnswersAndProbe}
                      disabled={answeredCount === 0}
                      className="h-7 text-xs"
                      data-testid="button-submit-answers"
                    >
                      <ArrowRight className="h-3 w-3 mr-1" />
                      Continue
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3" data-testid="msg-user-request-gen">
              <p className="text-xs font-medium text-primary mb-1">Your request:</p>
              <p className="text-sm text-foreground italic">{lastPrompt}</p>
              {selectedType && (
                <Badge variant="secondary" className="text-[10px] mt-2">
                  {contentTypeLabel}
                </Badge>
              )}
            </div>

            {allQA.length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-3" data-testid="qa-summary-gen">
                <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Discovery ({allQA.length} questions answered)
                </p>
                <div className="space-y-1">
                  {allQA.map((qa, i) => (
                    <div key={i} className="text-[11px]">
                      <span className="font-medium text-muted-foreground">Q:</span> <span className="text-foreground">{qa.question.substring(0, 100)}{qa.question.length > 100 ? "..." : ""}</span>
                      <br />
                      <span className="font-medium text-muted-foreground">A:</span> <span className="text-foreground">{qa.answer.substring(0, 100)}{qa.answer.length > 100 ? "..." : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === "generating" && (
              <div className="flex flex-col items-center gap-3 py-12" role="status" data-testid="generating-spinner">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  {isRefining ? "Refining your content..." : "Creating your content..."}
                </span>
                <p className="text-[10px] text-muted-foreground max-w-xs text-center">
                  This may take a moment — the AI is incorporating market intelligence and your discovery answers.
                </p>
              </div>
            )}

            {preview && phase === "done" && (
              <EnablementPreviewModal
                preview={preview}
                documentName={documentName}
                onDocumentNameChange={setDocumentName}
                onClose={() => setPreview(null)}
                onDone={handleDone}
                isSaving={isSaving}
                isRefining={isRefining}
                onSave={handleSaveFromPreview}
                onRefine={handleRefine}
              />
            )}

            {!preview && generatedContent && phase === "done" && createdContent && (
              <ContentCreatedBanner
                label={createdContent.label}
                url={createdContent.url}
                onClose={() => setCreatedContent(null)}
              />
            )}

            {!preview && generatedContent && phase === "done" && !createdContent && (
              <Card className="p-5" data-testid="msg-generated-content">
                <MarkdownRenderer content={generatedContent} />
              </Card>
            )}
          </div>
        )}
      </div>
      )}

      {(phase === "idle" || (phase === "done" && !preview)) && !showHistory && (
        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <div className="relative flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={phase === "done" ? "Start a new request..." : "Describe the enablement material you need..."}
                className="resize-none min-h-[44px] max-h-[120px] pr-9"
                rows={1}
                aria-label="Describe the enablement material you need"
                data-testid="input-enablement"
              />
              <VoiceInputButton
                onTranscript={(text) => setInput((prev) => prev ? prev + " " + text : text)}
                className="absolute right-1 top-1"
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!input.trim()}
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
              aria-label="Send request"
              data-testid="button-generate"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
