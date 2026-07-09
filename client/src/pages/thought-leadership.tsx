import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Lightbulb, Clock, Zap, ChevronDown, ChevronRight, Trash2,
  Mic, Pen, BookOpen, Target, Users, Loader2, MessageSquare, Award, FileText,
  Linkedin, Copy, Check, X, Video, FilePen, Presentation, ExternalLink, RefreshCw,
  ChevronLeft, Save, Eye, ArrowRight, RotateCcw, Upload, ToggleLeft, ToggleRight
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { GoogleDrivePickerButton } from "@/components/google-drive-picker";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import MarkdownRenderer, { renderInline } from "@/components/MarkdownRenderer";
import type { ThoughtLeadership } from "@shared/schema";

interface TLSummaryItem {
  id: number;
  title: string;
  summary: string;
  articleCount: number;
  opportunityCount: number;
  model?: string | null;
  createdAt: string | Date;
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface ThoughtLeadershipOpportunity {
  title: string;
  format: string;
  audience: string;
  thesis: string;
  demandbase_angle: string;
  talking_points: string[];
  timeliness: string;
  competitive_differentiation: string;
}

const formatIconMap: Record<string, typeof Lightbulb> = {
  keynote: Mic,
  linkedin_article: Pen,
  research_report: BookOpen,
  framework: Target,
  manifesto: Award,
  executive_brief: FileText,
  podcast_topic: MessageSquare,
  panel_discussion: Users,
};

const formatLabelMap: Record<string, string> = {
  keynote: "Keynote",
  linkedin_article: "LinkedIn Article",
  research_report: "Research Report",
  framework: "Framework",
  manifesto: "Manifesto",
  executive_brief: "Executive Brief",
  podcast_topic: "Podcast Topic",
  panel_discussion: "Panel Discussion",
};

function LinkedInPostModal({ posts, onClose, onRefine, isRefining }: {
  posts: string[];
  onClose: () => void;
  onRefine: (feedback: string) => void;
  isRefining: boolean;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [refineFeedback, setRefineFeedback] = useState("");
  const [showRefineInput, setShowRefineInput] = useState(false);

  const handleCopy = async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="mt-3 space-y-3" data-testid="linkedin-post-result">
      {posts.map((post, idx) => (
        <div key={idx} className="border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Linkedin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                {posts.length > 1 ? `Post ${idx + 1} of ${posts.length}` : "Generated LinkedIn Post"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(post, idx)}
                className="h-7 px-2"
                data-testid={`button-copy-linkedin-post-${idx}`}
              >
                {copiedIndex === idx ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1 text-xs">{copiedIndex === idx ? "Copied!" : "Copy"}</span>
              </Button>
              {idx === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="h-7 w-7 p-0"
                  data-testid="button-close-linkedin-post"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line bg-white dark:bg-background rounded-md p-3 border border-blue-100 dark:border-blue-900">
            {post}
          </div>
        </div>
      ))}

      {!showRefineInput ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRefineInput(true)}
            disabled={isRefining}
            className="border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400"
            data-testid="button-show-refine"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refine {posts.length > 1 ? "Posts" : "Post"}
          </Button>
        </div>
      ) : (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-3" data-testid="refine-panel">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-2">
            What would you like to change?
          </p>
          <div className="relative">
            <Textarea
              placeholder="e.g., Make it more conversational, add a stronger CTA, focus more on ROI metrics, shorten it..."
              value={refineFeedback}
              onChange={(e) => setRefineFeedback(e.target.value)}
              className="text-xs resize-none mb-2 pr-8"
              rows={2}
              data-testid="input-refine-feedback"
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
              data-testid="button-cancel-refine"
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
              className="h-8 bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-confirm-refine"
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
  );
}

function ContentCreatedBanner({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-2 border border-emerald-200 dark:border-emerald-800 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 p-3" data-testid="banner-content-created">
      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <span className="text-xs text-foreground/80 flex-1">{label} created successfully</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
        data-testid="link-open-created-content"
      >
        Open <ExternalLink className="h-3 w-3" />
      </a>
      <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0" data-testid="button-close-banner">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface SlideOutlineItem {
  slideNumber: number;
  title: string;
  keyPoints: string[];
  speakerNotes: string;
}

interface PreviewData {
  type: "blog" | "webinar" | "presentation";
  content: string;
  abstract?: string;
  headline?: string;
  storyArc?: string;
  slideOutline?: SlideOutlineItem[];
  talkTrack?: string;
}

function PresentationContentView({ preview }: { preview: PreviewData }) {
  const [activeSection, setActiveSection] = useState<"headline" | "story" | "outline" | "talktrack">("headline");
  const [expandedSlide, setExpandedSlide] = useState<number | null>(null);

  const sections = [
    { id: "headline" as const, label: "Headline", icon: Zap },
    { id: "story" as const, label: "Story Arc", icon: BookOpen },
    { id: "outline" as const, label: "Slide Outline", icon: FileText },
    { id: "talktrack" as const, label: "Talk Track", icon: MessageSquare },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${activeSection === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            <s.icon className="h-3 w-3" />
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === "headline" && (
        <div className="p-5 bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-lg">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">The Hook</p>
          <p className="text-lg font-bold text-foreground leading-snug">
            {preview.headline || "No headline generated"}
          </p>
        </div>
      )}

      {activeSection === "story" && (
        <div className="p-4 bg-muted/30 rounded-lg prose-sm max-w-none">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">Narrative Arc</p>
          <MarkdownRenderer content={preview.storyArc || "No story arc generated"} />
        </div>
      )}

      {activeSection === "outline" && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
            {preview.slideOutline?.length || 0} Slides
          </p>
          {(preview.slideOutline || []).map((slide, idx) => (
            <div key={idx} className="border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedSlide(expandedSlide === idx ? null : idx)}
              >
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                  {slide.slideNumber}
                </span>
                <span className="text-sm font-medium flex-1">{slide.title}</span>
                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedSlide === idx ? "rotate-90" : ""}`} />
              </button>
              {expandedSlide === idx && (
                <div className="px-3 pb-3 space-y-2 border-t border-border bg-muted/10">
                  <div className="pt-2 space-y-1">
                    {slide.keyPoints.map((pt, pi) => (
                      <div key={pi} className="flex items-start gap-2 text-xs text-foreground/80">
                        <span className="mt-1.5 shrink-0 h-1 w-1 rounded-full bg-primary/60" />
                        <span>{pt}</span>
                      </div>
                    ))}
                  </div>
                  {slide.speakerNotes && (
                    <div className="pt-2 border-t border-border/50">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold flex items-center gap-1">
                        <MessageSquare className="h-2.5 w-2.5" />Speaker Notes
                      </p>
                      <p className="text-xs text-foreground/70 leading-relaxed">{slide.speakerNotes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeSection === "talktrack" && (
        <div className="p-4 bg-muted/30 rounded-lg prose-sm max-w-none">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">Full Talk Track</p>
          <MarkdownRenderer content={preview.talkTrack || "No talk track generated"} />
        </div>
      )}
    </div>
  );
}

function ContentPreviewModal({
  preview,
  onClose,
  onRefine,
  onSave,
  isRefining,
  isSaving,
  documentName,
}: {
  preview: PreviewData;
  onClose: () => void;
  onRefine: (feedback: string) => void;
  onSave: () => void;
  isRefining: boolean;
  isSaving: boolean;
  documentName: string;
}) {
  const [refineFeedback, setRefineFeedback] = useState("");
  const [showRefineInput, setShowRefineInput] = useState(false);
  const [activeTab, setActiveTab] = useState<"abstract" | "content">("abstract");

  const colorMap = {
    blog: { border: "border-violet-200 dark:border-violet-800", bg: "bg-violet-50/50 dark:bg-violet-950/20", text: "text-violet-700 dark:text-violet-400", btn: "bg-violet-600 hover:bg-violet-700" },
    webinar: { border: "border-teal-200 dark:border-teal-800", bg: "bg-teal-50/50 dark:bg-teal-950/20", text: "text-teal-700 dark:text-teal-400", btn: "bg-teal-600 hover:bg-teal-700" },
    presentation: { border: "border-orange-200 dark:border-orange-800", bg: "bg-orange-50/50 dark:bg-orange-950/20", text: "text-orange-700 dark:text-orange-400", btn: "bg-orange-600 hover:bg-orange-700" },
  };
  const colors = colorMap[preview.type];
  const typeLabel = preview.type === "blog" ? "Blog Post" : preview.type === "webinar" ? "Webinar" : "Presentation";

  return (
    <div className={`mt-3 ${colors.border} border rounded-lg overflow-hidden`} data-testid="content-preview-modal">
      <div className={`flex items-center justify-between px-4 py-2.5 ${colors.bg} border-b ${colors.border}`}>
        <div className="flex items-center gap-2">
          <Eye className={`h-4 w-4 ${colors.text}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${colors.text}`}>
            {typeLabel} Preview
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving || isRefining}
            className={`h-7 text-xs text-white ${colors.btn}`}
            data-testid="button-save-to-drive"
          >
            {isSaving ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-3 w-3 mr-1" />Save to Google Drive</>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" data-testid="button-close-preview">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {preview.type === "webinar" && (
        <div className={`flex border-b ${colors.border}`}>
          <button
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${activeTab === "abstract" ? `${colors.bg} ${colors.text} border-b-2 border-current` : "text-muted-foreground hover:bg-muted/30"}`}
            onClick={() => setActiveTab("abstract")}
            data-testid="tab-abstract"
          >
            <FileText className="h-3 w-3 inline mr-1" />
            Abstract
          </button>
          <button
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${activeTab === "content" ? `${colors.bg} ${colors.text} border-b-2 border-current` : "text-muted-foreground hover:bg-muted/30"}`}
            onClick={() => setActiveTab("content")}
            data-testid="tab-content"
          >
            <FileText className="h-3 w-3 inline mr-1" />
            Content
          </button>
        </div>
      )}

      <div className="max-h-[600px] overflow-auto">
        {preview.type === "blog" ? (
          <div className="p-5 bg-white dark:bg-background border-b border-border" data-testid="blog-preview-content">
            <div className="max-w-2xl mx-auto prose-sm">
              <MarkdownRenderer content={preview.content} />
            </div>
          </div>
        ) : preview.type === "webinar" && activeTab === "abstract" ? (
          <div className="p-5 bg-white dark:bg-background border-b border-border" data-testid="webinar-abstract-preview">
            <div className="max-w-2xl mx-auto prose-sm">
              <MarkdownRenderer content={preview.abstract || ""} />
            </div>
          </div>
        ) : (
          <div className="p-4" data-testid="presentation-content-preview">
            <PresentationContentView preview={preview} />
          </div>
        )}
      </div>

      <div className={`px-4 py-3 ${colors.bg} border-t ${colors.border}`}>
        {!showRefineInput ? (
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Review the content above, then save to Google Drive or refine with feedback.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRefineInput(true)}
              disabled={isRefining || isSaving}
              className={`${colors.border} ${colors.text}`}
              data-testid="button-show-preview-refine"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refine
            </Button>
          </div>
        ) : (
          <div data-testid="preview-refine-panel">
            <p className={`text-xs font-medium ${colors.text} mb-2`}>
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
                className={`h-8 text-white ${colors.btn}`}
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

function OpportunityCard({ opp, index, model }: { opp: ThoughtLeadershipOpportunity; index: number; model: string }) {
  const [expanded, setExpanded] = useState(index === 0);
  const [linkedInPosts, setLinkedInPosts] = useState<string[] | null>(null);
  const [createdContent, setCreatedContent] = useState<{ label: string; url: string; secondaryUrl?: string; secondaryLabel?: string } | null>(null);
  const [creationMode, setCreationMode] = useState<"blog" | "webinar" | "presentation" | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [presentationAudience, setPresentationAudience] = useState("");
  const [showLinkedInPrompt, setShowLinkedInPrompt] = useState(false);
  const [linkedInPostCount, setLinkedInPostCount] = useState("1");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [contentQuestions, setContentQuestions] = useState<IdeaQuestion[]>([]);
  const [contentAnswers, setContentAnswers] = useState<Record<string, string>>({});
  const [contentAcknowledgment, setContentAcknowledgment] = useState("");
  const [creationPhase, setCreationPhase] = useState<"setup" | "questions" | "ready">("setup");
  const [contentFollowUpRound, setContentFollowUpRound] = useState(1);
  const [allContentQA, setAllContentQA] = useState<{ question: string; answer: string }[]>([]);
  const { toast } = useToast();
  const FormatIcon = formatIconMap[opp.format] || Lightbulb;
  const formatLabel = formatLabelMap[opp.format] || opp.format;

  const oppPayload = {
    title: opp.title,
    thesis: opp.thesis,
    demandbase_angle: opp.demandbase_angle,
    talking_points: opp.talking_points,
    audience: opp.audience,
    format: opp.format,
    timeliness: opp.timeliness,
  };

  const defaultNames: Record<string, string> = {
    blog: `Blog: ${opp.title}`,
    webinar: opp.title,
    presentation: `Presentation: ${opp.title}`,
  };

  const contentQuestionsMutation = useMutation({
    mutationFn: async (contentType: "blog" | "webinar" | "presentation") => {
      const res = await apiRequest("POST", "/api/thought-leadership/content-questions", {
        contentType,
        title: opp.title,
        thesis: opp.thesis,
        audience: opp.audience,
        demandbase_angle: opp.demandbase_angle,
        talking_points: opp.talking_points,
        model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setContentAcknowledgment(data.acknowledgment || "");
      setContentQuestions(data.questions || []);
      setContentAnswers({});
      setAllContentQA([]);
      setContentFollowUpRound(1);
      setCreationPhase("questions");
    },
    onError: () => {
      toast({ title: "Failed to load questions", variant: "destructive" });
    },
  });

  const contentFollowUpMutation = useMutation({
    mutationFn: async () => {
      const currentAnswers = contentQuestions
        .filter(q => (contentAnswers[q.id] || "").trim())
        .map(q => ({ question: q.question, answer: contentAnswers[q.id] }));
      const combinedQA = [...allContentQA, ...currentAnswers];
      const res = await apiRequest("POST", "/api/thought-leadership/content-followup", {
        contentType: creationMode,
        title: opp.title,
        thesis: opp.thesis,
        audience: opp.audience,
        previousQA: combinedQA,
        round: contentFollowUpRound,
        model,
      });
      return { data: await res.json(), combinedQA };
    },
    onSuccess: ({ data, combinedQA }) => {
      setAllContentQA(combinedQA);
      if (data.ready || !data.questions || data.questions.length === 0) {
        if (data.reaction) setContentAcknowledgment(data.reaction);
        setCreationPhase("ready");
      } else {
        setContentAcknowledgment(data.reaction || "");
        setContentQuestions(data.questions);
        setContentAnswers({});
        setContentFollowUpRound(prev => prev + 1);
      }
    },
    onError: () => {
      toast({ title: "Failed to process", variant: "destructive" });
    },
  });

  const openCreationPrompt = (mode: "blog" | "webinar" | "presentation") => {
    if (creationMode === mode) {
      setCreationMode(null);
      setCreationPhase("setup");
      return;
    }
    setCreationMode(mode);
    setDocumentName(defaultNames[mode]);
    setPresentationAudience("");
    setCreationPhase("setup");
    setContentQuestions([]);
    setContentAnswers({});
    setContentAcknowledgment("");
    setAllContentQA([]);
    setContentFollowUpRound(1);
    contentQuestionsMutation.mutate(mode);
  };

  const resetCreationPrompt = () => {
    setCreationMode(null);
    setDocumentName("");
    setPresentationAudience("");
    setCreationPhase("setup");
    setContentQuestions([]);
    setContentAnswers({});
    setContentAcknowledgment("");
    setAllContentQA([]);
    setContentFollowUpRound(1);
  };

  const getCreatorAnswers = () => {
    return [...allContentQA, ...contentQuestions
      .filter(q => (contentAnswers[q.id] || "").trim())
      .map(q => ({ question: q.question, answer: contentAnswers[q.id] }))];
  };

  const contentAnsweredCount = contentQuestions.filter(q => (contentAnswers[q.id] || "").trim()).length;

  const linkedInMutation = useMutation({
    mutationFn: async (params: { postCount: number; refinement?: string; previousPosts?: string[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/linkedin-post", {
        ...oppPayload,
        postCount: params.postCount,
        refinement: params.refinement || "",
        previousPosts: params.previousPosts || [],
        model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setLinkedInPosts(data.posts || [data.post]);
      setShowLinkedInPrompt(false);
    },
    onError: () => {
      toast({ title: "Failed to generate posts", description: "Could not generate LinkedIn posts. Try again.", variant: "destructive" });
    },
  });

  const blogMutation = useMutation({
    mutationFn: async (params: { name: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/generate-blog", {
        ...oppPayload,
        documentName: params.name,
        refinement: params.refinement || "",
        previousContent: params.previousContent || "",
        creatorAnswers: params.creatorAnswers || [],
        model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPreview({ type: "blog", content: data.content });
      resetCreationPrompt();
    },
    onError: () => {
      toast({ title: "Failed to generate blog", description: "Could not generate blog preview. Try again.", variant: "destructive" });
    },
  });

  const webinarMutation = useMutation({
    mutationFn: async (params: { name: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/generate-webinar", {
        ...oppPayload,
        documentName: params.name,
        refinement: params.refinement || "",
        previousContent: params.previousContent || "",
        creatorAnswers: params.creatorAnswers || [],
        model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPreview({ type: "webinar", content: "", abstract: data.abstract, headline: data.headline, storyArc: data.storyArc, slideOutline: data.slideOutline, talkTrack: data.talkTrack });
      resetCreationPrompt();
    },
    onError: () => {
      toast({ title: "Failed to generate webinar", description: "Could not generate webinar preview. Try again.", variant: "destructive" });
    },
  });

  const presentationMutation = useMutation({
    mutationFn: async (params: { name: string; targetAudience: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/generate-presentation", {
        ...oppPayload,
        targetAudience: params.targetAudience,
        documentName: params.name,
        refinement: params.refinement || "",
        previousContent: params.previousContent || "",
        creatorAnswers: params.creatorAnswers || [],
        model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPreview({ type: "presentation", content: "", headline: data.headline, storyArc: data.storyArc, slideOutline: data.slideOutline, talkTrack: data.talkTrack });
      resetCreationPrompt();
    },
    onError: () => {
      toast({ title: "Failed to generate presentation", description: "Could not generate presentation preview. Try again.", variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("No preview to save");
      const body: Record<string, string> = {
        type: preview.type,
        documentName: documentName || defaultNames[preview.type],
      };
      if (preview.type === "blog") {
        body.content = preview.content;
      } else if (preview.type === "webinar") {
        body.content = preview.abstract || "";
        body.slidesContent = JSON.stringify(preview.slideOutline || []);
      } else {
        body.content = JSON.stringify(preview.slideOutline || []);
      }
      const res = await apiRequest("POST", "/api/thought-leadership/save-to-drive", body);
      return res.json();
    },
    onSuccess: (data) => {
      if (preview?.type === "webinar") {
        setCreatedContent({
          label: "Webinar",
          url: data.docUrl,
          secondaryUrl: data.slidesUrl,
          secondaryLabel: "Slide Deck",
        });
      } else {
        setCreatedContent({ label: preview?.type === "blog" ? "Blog post" : "Presentation", url: data.url });
      }
      setPreview(null);
      const typeLabel = preview?.type === "blog" ? "Blog" : preview?.type === "webinar" ? "Webinar" : "Presentation";
      toast({ title: `${typeLabel} saved to Google Drive`, description: `Your ${typeLabel.toLowerCase()} has been saved successfully.` });
    },
    onError: () => {
      toast({ title: "Failed to save", description: "Could not save to Google Drive. Try again.", variant: "destructive" });
    },
  });

  const isAnyGenerating = blogMutation.isPending || webinarMutation.isPending || presentationMutation.isPending;

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid={`card-opportunity-${index}`}>
      <div
        className="flex items-start gap-3 p-4 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/30 mt-0.5">
          <FormatIcon className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400">
              {formatLabel}
            </Badge>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" />
              {opp.audience}
            </span>
          </div>
          <h4 className="text-sm font-semibold text-foreground leading-snug" data-testid={`text-opp-title-${index}`}>
            {opp.title}
          </h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{opp.thesis}</p>
        </div>
        <div className="shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Core Thesis</h5>
            <p className="text-sm text-foreground/90 leading-relaxed">{opp.thesis}</p>
          </div>

          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Demandbase Angle</h5>
            <p className="text-sm text-foreground/90 leading-relaxed">{opp.demandbase_angle}</p>
          </div>

          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Key Talking Points</h5>
            <ul className="space-y-1.5">
              {opp.talking_points.map((tp, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                  <span className="text-amber-500 dark:text-amber-400 mt-0.5 shrink-0">
                    <Zap className="h-3.5 w-3.5" />
                  </span>
                  {renderInline(tp)}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 border border-blue-200 dark:border-blue-800">
              <h5 className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-1">Why Now</h5>
              <p className="text-xs text-foreground/80 leading-relaxed">{opp.timeliness}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 border border-emerald-200 dark:border-emerald-800">
              <h5 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">Competitive Edge</h5>
              <p className="text-xs text-foreground/80 leading-relaxed">{opp.competitive_differentiation}</p>
            </div>
          </div>

          <div className="pt-1">
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Create Content</h5>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (linkedInPosts) {
                    setLinkedInPosts(null);
                  } else {
                    setShowLinkedInPrompt(!showLinkedInPrompt);
                    setLinkedInPostCount("1");
                  }
                }}
                disabled={linkedInMutation.isPending}
                className="border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400"
                data-testid={`button-generate-linkedin-${index}`}
              >
                {linkedInMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating...</>
                ) : linkedInPosts ? (
                  <><Linkedin className="h-3.5 w-3.5 mr-1.5" />Hide Posts</>
                ) : (
                  <><Linkedin className="h-3.5 w-3.5 mr-1.5" />LinkedIn Post</>
                )}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); openCreationPrompt("blog"); }}
                disabled={blogMutation.isPending || isAnyGenerating}
                className="border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400"
                data-testid={`button-create-blog-${index}`}
              >
                {blogMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating...</>
                ) : (
                  <><FilePen className="h-3.5 w-3.5 mr-1.5" />Create Blog</>
                )}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); openCreationPrompt("webinar"); }}
                disabled={webinarMutation.isPending || isAnyGenerating}
                className="border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-400"
                data-testid={`button-create-webinar-${index}`}
              >
                {webinarMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating...</>
                ) : (
                  <><Video className="h-3.5 w-3.5 mr-1.5" />Create Webinar</>
                )}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); openCreationPrompt("presentation"); }}
                disabled={presentationMutation.isPending || isAnyGenerating}
                className="border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400"
                data-testid={`button-create-presentation-${index}`}
              >
                {presentationMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating...</>
                ) : (
                  <><Presentation className="h-3.5 w-3.5 mr-1.5" />Create Presentation</>
                )}
              </Button>
            </div>
          </div>

          {creationMode && !isAnyGenerating && (
            <div
              className={`border rounded-lg p-3 ${
                creationMode === "blog" ? "border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20" :
                creationMode === "webinar" ? "border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/20" :
                "border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20"
              }`}
              data-testid="creation-prompt-panel"
              onClick={(e) => e.stopPropagation()}
            >
              {contentQuestionsMutation.isPending && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Preparing questions...</span>
                </div>
              )}

              {creationPhase === "questions" && contentQuestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold ${
                      creationMode === "blog" ? "text-violet-700 dark:text-violet-400" :
                      creationMode === "webinar" ? "text-teal-700 dark:text-teal-400" :
                      "text-orange-700 dark:text-orange-400"
                    }`} data-testid="text-content-questions-heading">
                      {contentFollowUpRound === 1 ? "Shape your" : "Follow-up:"} {creationMode === "blog" ? "blog post" : creationMode === "webinar" ? "webinar" : "presentation"}
                    </p>
                    <Button variant="ghost" size="sm" onClick={resetCreationPrompt} className="h-7 text-xs" data-testid="button-cancel-creation">
                      <X className="h-3 w-3 mr-1" />Cancel
                    </Button>
                  </div>

                  {contentAcknowledgment && (
                    <p className="text-xs text-foreground/80 leading-relaxed" data-testid="text-content-acknowledgment">
                      {contentAcknowledgment}
                    </p>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    Answer what resonates — skip what doesn't. Your answers directly shape the final {creationMode === "blog" ? "blog" : creationMode === "webinar" ? "webinar" : "deck"}.
                  </p>

                  <div className="space-y-2.5">
                    {contentQuestions.map((q, qi) => (
                      <div key={q.id} className="rounded-md border border-border bg-background p-2.5" data-testid={`content-question-${qi}`}>
                        <div className="flex items-start gap-1.5 mb-1.5">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold mt-0.5 ${
                            creationMode === "blog" ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400" :
                            creationMode === "webinar" ? "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400" :
                            "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400"
                          }`}>
                            {qi + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground leading-snug" data-testid={`text-content-question-${qi}`}>{q.question}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 italic">{q.why}</p>
                          </div>
                        </div>
                        <div className="relative">
                          <Textarea
                            placeholder="Your thoughts..."
                            value={contentAnswers[q.id] || ""}
                            onChange={(e) => setContentAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                            rows={2}
                            className="resize-none text-xs pr-8"
                            data-testid={`input-content-answer-${qi}`}
                          />
                          <VoiceInputButton
                            onTranscript={(text) => setContentAnswers(prev => ({ ...prev, [q.id]: (prev[q.id] || "") ? prev[q.id] + " " + text : text }))}
                            className="absolute top-1 right-1"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <p className="text-[10px] text-muted-foreground">{contentAnsweredCount} of {contentQuestions.length} answered{contentFollowUpRound > 1 ? ` (follow-up ${contentFollowUpRound})` : ""}</p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          const answers = getCreatorAnswers();
                          setAllContentQA(answers);
                          setCreationPhase("ready");
                        }}
                        disabled={contentFollowUpMutation.isPending}
                        data-testid="button-skip-questions"
                      >
                        <ArrowRight className="h-3 w-3 mr-1" />
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => contentFollowUpMutation.mutate()}
                        disabled={contentAnsweredCount === 0 || contentFollowUpMutation.isPending}
                        className={`h-7 text-xs text-white ${
                          creationMode === "blog" ? "bg-violet-600 hover:bg-violet-700" :
                          creationMode === "webinar" ? "bg-teal-600 hover:bg-teal-700" :
                          "bg-orange-600 hover:bg-orange-700"
                        }`}
                        data-testid="button-proceed-to-generate"
                      >
                        {contentFollowUpMutation.isPending ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Reviewing...</>
                        ) : (
                          <><ArrowRight className="h-3 w-3 mr-1" />Continue</>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {creationPhase === "ready" && (
                <div className="space-y-2">
                  <p className={`text-xs font-medium mb-1 ${
                    creationMode === "blog" ? "text-violet-700 dark:text-violet-400" :
                    creationMode === "webinar" ? "text-teal-700 dark:text-teal-400" :
                    "text-orange-700 dark:text-orange-400"
                  }`}>
                    Name your {creationMode === "blog" ? "blog post" : creationMode === "webinar" ? "webinar" : "presentation"}
                  </p>
                  <div className="flex items-center gap-1">
                    <Input
                      type="text"
                      placeholder="Document name in Google Drive"
                      value={documentName}
                      onChange={(e) => setDocumentName(e.target.value)}
                      className="text-xs h-8 flex-1"
                      data-testid="input-document-name"
                    />
                    <VoiceInputButton
                      onTranscript={(text) => setDocumentName(prev => prev ? prev + " " + text : text)}
                    />
                  </div>
                  {creationMode === "presentation" && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="text"
                        placeholder="Target audience, e.g., CMOs at B2B SaaS companies"
                        value={presentationAudience}
                        onChange={(e) => setPresentationAudience(e.target.value)}
                        className="text-xs h-8 flex-1"
                        data-testid="input-presentation-audience"
                      />
                      <VoiceInputButton
                        onTranscript={(text) => setPresentationAudience(prev => prev ? prev + " " + text : text)}
                      />
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetCreationPrompt}
                        className="h-8 text-xs"
                        data-testid="button-cancel-creation-ready"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreationPhase("questions")}
                        className="h-8 text-xs"
                        data-testid="button-back-to-questions"
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                        Back
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        const name = documentName.trim();
                        if (!name) return;
                        const answers = getCreatorAnswers();
                        if (creationMode === "blog") blogMutation.mutate({ name, creatorAnswers: answers });
                        else if (creationMode === "webinar") webinarMutation.mutate({ name, creatorAnswers: answers });
                        else if (presentationAudience.trim()) {
                          presentationMutation.mutate({ name, targetAudience: presentationAudience.trim(), creatorAnswers: answers });
                        }
                      }}
                      disabled={
                        !documentName.trim() ||
                        (creationMode === "presentation" && !presentationAudience.trim())
                      }
                      className={`h-8 text-white ${
                        creationMode === "blog" ? "bg-violet-600 hover:bg-violet-700" :
                        creationMode === "webinar" ? "bg-teal-600 hover:bg-teal-700" :
                        "bg-orange-600 hover:bg-orange-700"
                      }`}
                      data-testid="button-confirm-creation"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Generate Preview
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showLinkedInPrompt && !linkedInMutation.isPending && !linkedInPosts && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-3" data-testid="linkedin-prompt-panel">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-2">How many LinkedIn posts would you like?</p>
              <p className="text-[11px] text-muted-foreground mb-2">Generate multiple posts to create a content series exploring different angles of this topic.</p>
              <div className="flex gap-2">
                <Select value={linkedInPostCount} onValueChange={setLinkedInPostCount}>
                  <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="select-linkedin-post-count" onClick={(e) => e.stopPropagation()}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 post</SelectItem>
                    <SelectItem value="2">2 posts</SelectItem>
                    <SelectItem value="3">3 posts</SelectItem>
                    <SelectItem value="4">4 posts</SelectItem>
                    <SelectItem value="5">5 posts</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    linkedInMutation.mutate({ postCount: parseInt(linkedInPostCount) });
                  }}
                  className="h-8 bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-confirm-linkedin"
                >
                  Generate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setShowLinkedInPrompt(false); }}
                  className="h-8"
                  data-testid="button-cancel-linkedin"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {linkedInPosts && (
            <LinkedInPostModal
              posts={linkedInPosts}
              onClose={() => setLinkedInPosts(null)}
              isRefining={linkedInMutation.isPending}
              onRefine={(feedback) => {
                linkedInMutation.mutate({
                  postCount: linkedInPosts.length,
                  refinement: feedback,
                  previousPosts: linkedInPosts,
                });
              }}
            />
          )}

          {preview && (
            <ContentPreviewModal
              preview={preview}
              documentName={documentName || defaultNames[preview.type]}
              onClose={() => setPreview(null)}
              isSaving={saveMutation.isPending}
              isRefining={blogMutation.isPending || webinarMutation.isPending || presentationMutation.isPending}
              onSave={() => saveMutation.mutate()}
              onRefine={(feedback) => {
                if (preview.type === "blog") {
                  blogMutation.mutate({ name: documentName || defaultNames.blog, refinement: feedback, previousContent: preview.content });
                } else if (preview.type === "webinar") {
                  webinarMutation.mutate({ name: documentName || defaultNames.webinar, refinement: feedback, previousContent: JSON.stringify({ abstract: preview.abstract, talkTrack: preview.talkTrack, storyArc: preview.storyArc }) });
                } else {
                  presentationMutation.mutate({ name: documentName || defaultNames.presentation, targetAudience: presentationAudience, refinement: feedback, previousContent: preview.content });
                }
              }}
            />
          )}

          {createdContent && (
            <div className="space-y-1">
              <ContentCreatedBanner
                label={createdContent.label}
                url={createdContent.url}
                onClose={() => setCreatedContent(null)}
              />
              {createdContent.secondaryUrl && (
                <ContentCreatedBanner
                  label={createdContent.secondaryLabel || "Slides"}
                  url={createdContent.secondaryUrl}
                  onClose={() => setCreatedContent(prev => prev ? { ...prev, secondaryUrl: undefined, secondaryLabel: undefined } : null)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisCard({
  item, isLatest, onDelete, model
}: {
  item: TLSummaryItem;
  isLatest: boolean;
  onDelete: (id: number) => void;
  model: string;
}) {
  const [expanded, setExpanded] = useState(isLatest);
  const date = new Date(item.createdAt);

  const detailQuery = useQuery<ThoughtLeadership>({
    queryKey: ["/api/thought-leadership", item.id],
    queryFn: async () => {
      const res = await fetch(`/api/thought-leadership?id=${item.id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: expanded,
  });

  let opportunities: ThoughtLeadershipOpportunity[] = [];
  if (detailQuery.data) {
    try { opportunities = JSON.parse(detailQuery.data.opportunities); } catch { opportunities = []; }
  }

  const oppCount = item.opportunityCount ?? opportunities.length;

  return (
    <Card
      className={`overflow-hidden ${isLatest ? "border-amber-300 dark:border-amber-700 shadow-sm" : "border-border"}`}
      data-testid={`card-tl-${item.id}`}
    >
      <div
        className="flex items-start gap-3 p-5 cursor-pointer select-none hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isLatest && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-500 text-white">Latest</Badge>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {getTimeAgo(date)}
            </span>
            <span className="text-xs text-muted-foreground">
              {item.articleCount.toLocaleString()} articles
            </span>
            <span className="text-xs text-muted-foreground">
              {oppCount} opportunities
            </span>
            {item.model && MODEL_DISPLAY[item.model] && (
              <span className={`text-[10px] font-medium ${MODEL_DISPLAY[item.model].color}`} data-testid={`text-tl-model-${item.id}`}>
                {MODEL_DISPLAY[item.model].label}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-foreground leading-tight" data-testid={`text-tl-title-${item.id}`}>
            {item.title}
          </h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
            data-testid={`button-delete-tl-${item.id}`}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4">
          <div className="text-sm text-foreground/80 leading-relaxed mb-4 whitespace-pre-line" data-testid={`text-tl-summary-${item.id}`}>
            {renderInline(item.summary)}
          </div>

          {detailQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailQuery.isError ? (
            <div className="text-sm text-destructive flex items-center gap-2">
              <span>Failed to load opportunities.</span>
              <Button variant="ghost" size="sm" onClick={() => detailQuery.refetch()} data-testid={`button-retry-detail-${item.id}`}>Retry</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h4 className="text-sm font-semibold">Opportunities ({opportunities.length})</h4>
              </div>
              {opportunities.map((opp, i) => (
                <OpportunityCard key={i} opp={opp} index={i} model={model} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface IdeaQuestion {
  id: string;
  question: string;
  why: string;
}

type IdeaPhase = "input" | "questions" | "generating" | "done";

function MyIdeasTab({ model }: { model: string }) {
  const { toast } = useToast();
  const [ideaText, setIdeaText] = useState("");
  const [phase, setPhase] = useState<IdeaPhase>("input");
  const [acknowledgment, setAcknowledgment] = useState("");
  const [questions, setQuestions] = useState<IdeaQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [generatedIdeas, setGeneratedIdeas] = useState<ThoughtLeadershipOpportunity[]>([]);
  const [currentIdea, setCurrentIdea] = useState("");
  const [allQA, setAllQA] = useState<{ question: string; answer: string }[]>([]);
  const [followUpRound, setFollowUpRound] = useState(1);

  const questionsMutation = useMutation({
    mutationFn: async (idea: string) => {
      const res = await apiRequest("POST", "/api/thought-leadership/from-idea/questions", { idea, model });
      return res.json();
    },
    onSuccess: (data) => {
      setAcknowledgment(data.acknowledgment || "");
      setQuestions(data.questions || []);
      setAnswers({});
      setAllQA([]);
      setFollowUpRound(1);
      setPhase("questions");
    },
    onError: () => {
      toast({ title: "Failed to process idea", description: "Could not generate questions. Try again.", variant: "destructive" });
    },
  });

  const followUpMutation = useMutation({
    mutationFn: async () => {
      const currentAnswers = questions
        .filter(q => (answers[q.id] || "").trim())
        .map(q => ({ question: q.question, answer: answers[q.id] }));
      const combinedQA = [...allQA, ...currentAnswers];
      const res = await apiRequest("POST", "/api/thought-leadership/from-idea/followup", {
        idea: currentIdea,
        previousQA: combinedQA,
        round: followUpRound,
        model,
      });
      return { data: await res.json(), combinedQA };
    },
    onSuccess: ({ data, combinedQA }) => {
      setAllQA(combinedQA);
      if (data.ready || !data.questions || data.questions.length === 0) {
        if (data.reaction) setAcknowledgment(data.reaction);
        setPhase("generating");
        generateFromAllAnswers(combinedQA);
      } else {
        setAcknowledgment(data.reaction || "");
        setQuestions(data.questions);
        setAnswers({});
        setFollowUpRound(prev => prev + 1);
        setPhase("questions");
      }
    },
    onError: () => {
      toast({ title: "Failed to process", variant: "destructive" });
      setPhase("questions");
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (answersArray: { question: string; answer: string }[]) => {
      const res = await apiRequest("POST", "/api/thought-leadership/from-idea/generate", {
        idea: currentIdea,
        answers: answersArray.map((a, i) => ({ questionId: `q${i}`, ...a })),
        model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.opportunity) {
        setGeneratedIdeas((prev) => [data.opportunity, ...prev]);
        toast({ title: "Idea developed", description: `"${data.opportunity.title}" is ready for content creation.` });
        setPhase("done");
      }
    },
    onError: () => {
      toast({ title: "Failed to develop idea", description: "Could not generate the opportunity. Try again.", variant: "destructive" });
      setPhase("questions");
    },
  });

  const generateFromAllAnswers = (qa: { question: string; answer: string }[]) => {
    generateMutation.mutate(qa);
  };

  const handleSubmitIdea = () => {
    setCurrentIdea(ideaText);
    questionsMutation.mutate(ideaText);
  };

  const handleContinue = () => {
    followUpMutation.mutate();
  };

  const startNewIdea = () => {
    setIdeaText("");
    setPhase("input");
    setAcknowledgment("");
    setQuestions([]);
    setAnswers({});
    setCurrentIdea("");
    setAllQA([]);
    setFollowUpRound(1);
  };

  const answeredCount = questions.filter(q => (answers[q.id] || "").trim()).length;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {phase === "input" && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2" data-testid="text-my-ideas-heading">
              <Pen className="h-4 w-4 text-amber-500" />
              Submit Your Idea
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Describe a thought leadership concept, topic, or angle. The AI strategist will ask you questions to draw out your genuine perspective before building the opportunity.
            </p>
            <div className="relative">
              <Textarea
                placeholder="e.g., 'I think the B2B industry is over-indexing on intent data and ignoring the fundamentals of relationship selling...'"
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                rows={4}
                className="mb-3 resize-none pr-8"
                data-testid="input-idea-text"
              />
              <VoiceInputButton
                onTranscript={(text) => setIdeaText(prev => prev ? prev + " " + text : text)}
                className="absolute top-1 right-1"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleSubmitIdea}
                disabled={!ideaText.trim() || questionsMutation.isPending}
                size="sm"
                data-testid="button-submit-idea"
              >
                {questionsMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Thinking...</>
                ) : (
                  <><MessageSquare className="h-4 w-4 mr-1.5" />Submit Idea</>
                )}
              </Button>
            </div>
          </Card>
        )}

        {(phase === "questions" || phase === "generating") && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2" data-testid="text-questions-heading">
                <MessageSquare className="h-4 w-4 text-amber-500" />
                {followUpRound === 1 ? "Let's Dig Deeper" : `Follow-up Round ${followUpRound}`}
              </h3>
              <Button variant="ghost" size="sm" onClick={startNewIdea} data-testid="button-start-over">
                <X className="h-3.5 w-3.5 mr-1" />
                Start Over
              </Button>
            </div>

            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 mb-4">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Your idea:</p>
              <p className="text-sm text-amber-900 dark:text-amber-200 italic">{currentIdea}</p>
            </div>

            {acknowledgment && (
              <p className="text-sm text-foreground/90 mb-4 leading-relaxed" data-testid="text-acknowledgment">
                {acknowledgment}
              </p>
            )}

            <p className="text-xs text-muted-foreground mb-4">
              Answer as many questions as you'd like — the more you share, the more authentic the final piece will be. Skip any that don't resonate.
            </p>

            <div className="space-y-4">
              {questions.map((q, idx) => (
                <div key={q.id} className="border border-border rounded-lg p-3" data-testid={`question-card-${idx}`}>
                  <div className="flex items-start gap-2 mb-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-[10px] font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug" data-testid={`text-question-${idx}`}>
                        {q.question}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 italic">{q.why}</p>
                    </div>
                  </div>
                  <div className="relative">
                    <Textarea
                      placeholder="Share your thoughts..."
                      value={answers[q.id] || ""}
                      onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      rows={2}
                      className="resize-none text-sm pr-8"
                      disabled={phase === "generating"}
                      data-testid={`input-answer-${idx}`}
                    />
                    <VoiceInputButton
                      onTranscript={(text) => setAnswers(prev => ({ ...prev, [q.id]: (prev[q.id] || "") ? prev[q.id] + " " + text : text }))}
                      disabled={phase === "generating"}
                      className="absolute top-1 right-1"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {answeredCount} of {questions.length} questions answered
              </p>
              <Button
                onClick={handleContinue}
                disabled={answeredCount === 0 || followUpMutation.isPending || generateMutation.isPending}
                size="sm"
                data-testid="button-generate-from-answers"
              >
                {(followUpMutation.isPending || generateMutation.isPending) ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />{generateMutation.isPending ? "Developing opportunity..." : "Reviewing your answers..."}</>
                ) : (
                  <><Lightbulb className="h-4 w-4 mr-1.5" />Continue</>
                )}
              </Button>
            </div>
          </Card>
        )}

        {phase === "done" && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                Opportunity created from your idea
              </p>
              <Button variant="outline" size="sm" onClick={startNewIdea} data-testid="button-new-idea">
                <Pen className="h-3.5 w-3.5 mr-1.5" />
                New Idea
              </Button>
            </div>
          </Card>
        )}

        {generatedIdeas.length === 0 && phase === "input" ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
              <Pen className="h-7 w-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-sm font-semibold mb-1" data-testid="text-no-ideas">No Ideas Yet</h2>
            <p className="text-xs text-muted-foreground max-w-sm">
              Submit an idea and answer the AI strategist's questions. Your answers shape the final thought leadership opportunity.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {generatedIdeas.map((opp, idx) => (
              <OpportunityCard key={`idea-${idx}`} opp={opp} index={idx} model={model} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TlDocumentItem {
  id: number;
  filename: string;
  description: string;
  extractedText: string;
  isActive: boolean;
  createdAt: string | Date;
}

function DocumentsTab() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const docsQuery = useQuery<TlDocumentItem[]>({
    queryKey: ["/api/tl-documents"],
  });

  const CHUNK_SIZE = 4 * 1024 * 1024;

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");

      const uploadAndProcess = async (uploadedFile: File): Promise<any> => {
        const useChunked = uploadedFile.size > CHUNK_SIZE;

        if (!useChunked) {
          const formData = new FormData();
          formData.append("file", uploadedFile);
          formData.append("description", description);
          const res = await fetch("/api/tl-documents/upload", { method: "POST", body: formData });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Upload failed");
          }
          return res.json();
        }

        const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const totalChunks = Math.ceil(uploadedFile.size / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, uploadedFile.size);
          const chunk = uploadedFile.slice(start, end);

          const formData = new FormData();
          formData.append("chunk", chunk, `chunk_${i}`);
          formData.append("uploadId", uploadId);
          formData.append("chunkIndex", String(i));
          formData.append("totalChunks", String(totalChunks));
          formData.append("filename", uploadedFile.name);

          const res = await fetch("/api/chunked-upload", { method: "POST", body: formData });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Chunk upload failed`);
          }

          const chunkResult = await res.json();
          if (chunkResult.complete) {
            const analyzeRes = await fetch("/api/tl-documents/upload-chunked", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filePath: chunkResult.filePath,
                filename: chunkResult.filename,
                size: chunkResult.size,
                description,
              }),
            });
            if (!analyzeRes.ok) {
              const data = await analyzeRes.json().catch(() => ({}));
              throw new Error(data.error || `Processing failed`);
            }
            return analyzeRes.json();
          }
        }
        throw new Error("Upload completed but file assembly failed. Please try again.");
      };

      const data = await uploadAndProcess(file);
      if (data.status === "processing" && data.jobId) {
        toast({ title: "File uploaded", description: data.progressMessage || "Processing in queue..." });
        const pollForResult = async (jobId: string, attempts = 0): Promise<any> => {
          if (attempts > 200) throw new Error("Processing timed out. Try a smaller file.");
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetch(`/api/tl-documents/upload-status/${jobId}`);
          if (pollRes.status === 404 && attempts > 10) throw new Error("Processing job was lost. Please try again.");
          if (pollRes.status === 404) return pollForResult(jobId, attempts + 1);
          const pollData = await pollRes.json();
          if (pollData.status === "done") return pollData;
          if (pollData.status === "error") throw new Error(pollData.error || "Processing failed");
          return pollForResult(jobId, attempts + 1);
        };
        return pollForResult(data.jobId);
      }
      return data;
    },
    onSuccess: () => {
      toast({ title: "Document uploaded", description: "It will be included in your next Thought Leadership analysis." });
      setFile(null);
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["/api/tl-documents"] });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/tl-documents/${id}`, { isActive });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tl-documents"] });
      toast({ title: variables.isActive ? "Document enabled" : "Document disabled" });
    },
    onError: () => {
      toast({ title: "Failed to update document", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tl-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tl-documents"] });
      toast({ title: "Document removed" });
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) setFile(droppedFile);
  };

  const docs = docsQuery.data || [];
  const activeDocs = docs.filter(d => d.isActive);

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <Upload className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Upload Document
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Upload documents (PDF, DOCX, PPTX, TXT) to provide additional context for AI-generated thought leadership analyses.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.pptm,.ppt,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
              e.target.value = "";
            }}
            data-testid="input-file-tl-document"
          />
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4 ${
              dragOver
                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                : file
                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
                  : "border-border hover:border-amber-400 hover:bg-muted/30"
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-tl-document"
          >
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium">{file.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="ml-2 text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Drop a file here or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, DOCX, PPTX, TXT — up to 50MB
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or import from</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <GoogleDrivePickerButton onFileSelected={(f) => setFile(f)} className="mb-2" />

          {file && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  What is this document? (required)
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder='e.g., "Forrester Wave report on ABM platforms Q1 2026" or "Internal competitive analysis of 6sense vs Demandbase"'
                  className="text-sm min-h-[80px]"
                  data-testid="input-document-description"
                />
              </div>
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || description.trim().length < 5}
                className="w-full"
                data-testid="button-upload-document"
              >
                {uploadMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Processing document...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-1.5" />Upload & Extract</>
                )}
              </Button>
            </div>
          )}
        </Card>

        {docsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-1/3 mb-2" />
                <Skeleton className="h-3 w-full" />
              </Card>
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload documents to enrich your thought leadership analyses with additional context.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                Uploaded Documents
                <Badge variant="secondary" className="ml-2 text-xs">{docs.length}</Badge>
              </h3>
              {activeDocs.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {activeDocs.length} active — included in next analysis
                </span>
              )}
            </div>
            <div className="space-y-2">
              {docs.map((doc) => (
                <Card key={doc.id} className={`p-4 transition-colors ${doc.isActive ? "" : "opacity-60"}`} data-testid={`card-tl-document-${doc.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-sm font-medium truncate">{doc.filename}</span>
                        {doc.isActive ? (
                          <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {getTimeAgo(new Date(doc.createdAt))}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: doc.id, isActive: !doc.isActive })}
                        className="h-8 w-8 p-0"
                        title={doc.isActive ? "Disable — exclude from analyses" : "Enable — include in analyses"}
                        data-testid={`button-toggle-document-${doc.id}`}
                      >
                        {doc.isActive ? (
                          <ToggleRight className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(doc.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                        data-testid={`button-delete-document-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ThoughtLeadershipPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"analyses" | "ideas" | "documents">("analyses");
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-tl");
  const [showForceGenerate, setShowForceGenerate] = useState(false);

  const tlQuery = useQuery<TLSummaryItem[]>({
    queryKey: ["/api/thought-leadership", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/thought-leadership?summary=true");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (force?: boolean) => {
      const res = await apiRequest("POST", "/api/thought-leadership", { model: selectedModel, force: force || false });
      return res.json();
    },
    onSuccess: (data: ThoughtLeadership & { cached?: boolean }) => {
      if (data.cached) {
        toast({
          title: "No new articles to analyze",
          description: "The news digest hasn't changed since the last analysis. Use 'Force New' to regenerate with a fresh perspective.",
          duration: 8000,
        });
        setShowForceGenerate(true);
        return;
      }
      let oppCount = 0;
      try { oppCount = JSON.parse(data.opportunities).length; } catch {}
      const summaryItem: TLSummaryItem = {
        id: data.id,
        title: data.title,
        summary: data.summary,
        articleCount: data.articleCount,
        opportunityCount: oppCount,
        model: data.model,
        createdAt: data.createdAt,
      };
      queryClient.setQueryData<TLSummaryItem[]>(["/api/thought-leadership", "summary"], (old) => {
        if (!old) return [summaryItem];
        const exists = old.some(i => i.id === data.id);
        if (exists) return old;
        return [summaryItem, ...old].slice(0, 10);
      });
      queryClient.setQueryData(["/api/thought-leadership", data.id], data);
      setShowForceGenerate(false);
      toast({ title: "Thought leadership analysis generated", description: `Analyzed ${data.articleCount?.toLocaleString() || 0} articles for executive content opportunities.` });
    },
    onError: () => {
      toast({ title: "Analysis failed", description: "Could not generate thought leadership analysis. Try again later.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/thought-leadership/${id}`);
      return id;
    },
    onSuccess: (id: number) => {
      queryClient.setQueryData<TLSummaryItem[]>(["/api/thought-leadership", "summary"], (old) =>
        old ? old.filter(i => i.id !== id) : []
      );
      toast({ title: "Analysis deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const items = tlQuery.data || [];

  const tabClass = (tab: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
      activeTab === tab
        ? "border-amber-500 text-amber-700 dark:text-amber-400"
        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
    }`;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4 pb-0">
        <div className="flex items-start justify-between gap-2 pb-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-thought-leadership-title">
              <Lightbulb className="h-5 w-5 text-amber-500 shrink-0" />
              Thought Leadership
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Executive-level content opportunities based on market trends and Demandbase's position
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeTab === "analyses" && (
              <div className="flex items-center gap-2">
                {showForceGenerate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowForceGenerate(false); generateMutation.mutate(true); }}
                    disabled={generateMutation.isPending}
                    data-testid="button-force-generate-tl"
                  >
                    {generateMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Regenerating...</>
                    ) : (
                      <><RotateCcw className="h-4 w-4 mr-1.5" />Force New</>
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => generateMutation.mutate(undefined)}
                  disabled={generateMutation.isPending}
                  size="sm"
                  data-testid="button-generate-tl"
                >
                  {generateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /><span className="hidden sm:inline">Analyzing articles...</span><span className="sm:hidden">Analyzing...</span></>
                  ) : (
                    <><Lightbulb className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Generate Analysis</span><span className="sm:hidden">Generate</span></>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between pb-2">
          <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
        </div>
        <div className="flex gap-0">
          <button
            className={tabClass("analyses")}
            onClick={() => setActiveTab("analyses")}
            data-testid="tab-analyses"
          >
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              AI Analyses
            </span>
          </button>
          <button
            className={tabClass("ideas")}
            onClick={() => setActiveTab("ideas")}
            data-testid="tab-ideas"
          >
            <span className="flex items-center gap-1.5">
              <Pen className="h-3.5 w-3.5" />
              My Ideas
            </span>
          </button>
          <button
            className={tabClass("documents")}
            onClick={() => setActiveTab("documents")}
            data-testid="tab-documents"
          >
            <span className="flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Documents
            </span>
          </button>
        </div>
      </div>

      {activeTab === "analyses" ? (
        <div className="flex-1 overflow-auto p-4">
          {tlQuery.isLoading ? (
            <div className="space-y-4 max-w-3xl mx-auto">
              {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <Skeleton className="h-5 w-2/3 mb-3" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-4/5" />
                </Card>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
                <Lightbulb className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-base font-semibold mb-1" data-testid="text-no-thought-leadership">No Thought Leadership Analysis Yet</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Generate an analysis to discover executive-level content opportunities based on current market trends and Demandbase's strategic position.
              </p>
              <Button
                onClick={() => generateMutation.mutate(undefined)}
                disabled={generateMutation.isPending}
                data-testid="button-generate-tl-empty"
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Analyzing articles...</>
                ) : (
                  <><Lightbulb className="h-4 w-4 mr-1.5" />Generate Thought Leadership Ideas</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              {items.map((item, idx) => (
                <AnalysisCard
                  key={item.id}
                  item={item}
                  isLatest={idx === 0}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  model={selectedModel}
                />
              ))}
            </div>
          )}
        </div>
      ) : activeTab === "ideas" ? (
        <MyIdeasTab model={selectedModel} />
      ) : (
        <DocumentsTab />
      )}
    </div>
  );
}
