import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import {
  TrendingUp, TrendingDown, RefreshCw, Clock, Zap, BarChart3,
  Rocket, ArrowUpRight, ArrowDownRight, Minus, Building2, Sparkles,
  FileText, Trash2, Calendar, Save, ChevronDown, ChevronRight,
  ExternalLink, Eye, BookOpen, History, AlertTriangle, Target,
  Bookmark, BookmarkCheck, X, Loader2, Linkedin, FilePen, Video,
  Presentation, ArrowRight, ChevronLeft, Copy, Check,
  Pen
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getTimeAgo } from "@/lib/time";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import { DateRangePicker } from "@/components/date-range-picker";
import type { TrendAnalysis, DashboardView, Article, TrendSnapshot, TrendWatchlistItem } from "@shared/schema";

import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie
} from "recharts";

interface CompetitiveMentionItem {
  date: string;
  competitor: string;
  count: number;
}

interface NewsCategory {
  id: number;
  name: string;
  color_bg: string;
  color_text: string;
}

interface DashboardConfig {
  dateRange: string;
  category: string;
  selectedCompetitors: string[];
  selectedTopics: string[];
}

interface TrendItem {
  name: string;
  description: string;
  category: string;
  momentum: "rising" | "stable" | "declining";
  confidence: number;
  articleIds: number[];
}

interface EmergingSignal {
  name: string;
  description: string;
  category: string;
}

interface TrendContentQuestion {
  id: string;
  question: string;
  why: string;
}

interface SlideOutlineItem {
  slideNumber: number;
  title: string;
  keyPoints: string[];
  speakerNotes: string;
}

interface ContentPreview {
  type: "blog" | "webinar" | "presentation";
  content: string;
  abstract?: string;
  headline?: string;
  storyArc?: string;
  slideOutline?: SlideOutlineItem[];
  talkTrack?: string;
}

function TrendPresentationView({ preview }: { preview: ContentPreview }) {
  const [activeSection, setActiveSection] = useState<"headline" | "story" | "outline" | "talktrack">("headline");
  const [expandedSlide, setExpandedSlide] = useState<number | null>(null);

  const sections = [
    { id: "headline" as const, label: "Headline" },
    { id: "story" as const, label: "Story Arc" },
    { id: "outline" as const, label: "Slide Outline" },
    { id: "talktrack" as const, label: "Talk Track" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${activeSection === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === "headline" && (
        <div className="p-5 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">The Hook</p>
          <p className="text-lg font-bold text-foreground leading-snug">{preview.headline || "No headline generated"}</p>
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
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">{preview.slideOutline?.length || 0} Slides</p>
          {(preview.slideOutline || []).map((slide, idx) => (
            <div key={idx} className="border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedSlide(expandedSlide === idx ? null : idx)}
              >
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{slide.slideNumber}</span>
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
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Speaker Notes</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{slide.speakerNotes}</p>
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


function TrendLinkedInModal({ posts, onClose, onRefine, isRefining }: {
  posts: string[];
  onClose: () => void;
  onRefine: (feedback: string) => void;
  isRefining: boolean;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [refineFeedback, setRefineFeedback] = useState("");
  const [showRefineInput, setShowRefineInput] = useState(false);

  return (
    <div className="mt-3 space-y-3" data-testid="trend-linkedin-result">
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
                onClick={async () => { await navigator.clipboard.writeText(post); setCopiedIndex(idx); setTimeout(() => setCopiedIndex(null), 2000); }}
                className="h-7 px-2"
                data-testid={`button-copy-trend-li-${idx}`}
              >
                {copiedIndex === idx ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1 text-xs">{copiedIndex === idx ? "Copied!" : "Copy"}</span>
              </Button>
              {idx === 0 && (
                <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" aria-label="Close LinkedIn posts" data-testid="button-close-trend-li">
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
          <Button variant="outline" size="sm" onClick={() => setShowRefineInput(true)} disabled={isRefining} className="border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400" data-testid="button-trend-li-refine">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refine {posts.length > 1 ? "Posts" : "Post"}
          </Button>
        </div>
      ) : (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-3" data-testid="trend-li-refine-panel">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-2">What would you like to change?</p>
          <div className="relative">
            <Textarea placeholder="e.g., Make it more conversational, add a stronger CTA..." aria-label="Refinement feedback" value={refineFeedback} onChange={(e) => setRefineFeedback(e.target.value)} className="text-xs resize-none mb-2 pr-8" rows={2} data-testid="input-trend-li-refine" />
            <VoiceInputButton onTranscript={(text) => setRefineFeedback(prev => prev ? prev + " " + text : text)} className="absolute top-1 right-1" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowRefineInput(false); setRefineFeedback(""); }} disabled={isRefining} className="h-8" data-testid="button-cancel-trend-li-refine">Cancel</Button>
            <Button size="sm" onClick={() => { if (refineFeedback.trim()) { onRefine(refineFeedback.trim()); setRefineFeedback(""); setShowRefineInput(false); } }} disabled={!refineFeedback.trim() || isRefining} className="h-8" data-testid="button-submit-trend-li-refine">
              {isRefining ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refining...</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refine</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrendContentPreviewModal({ preview, onClose, onRefine, onSave, isRefining, isSaving, documentName }: {
  preview: ContentPreview;
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
    blog: { border: "border-violet-200 dark:border-violet-800", bg: "bg-violet-50/50 dark:bg-violet-950/20", text: "text-violet-700 dark:text-violet-400" },
    webinar: { border: "border-teal-200 dark:border-teal-800", bg: "bg-teal-50/50 dark:bg-teal-950/20", text: "text-teal-700 dark:text-teal-400" },
    presentation: { border: "border-orange-200 dark:border-orange-800", bg: "bg-orange-50/50 dark:bg-orange-950/20", text: "text-orange-700 dark:text-orange-400" },
  };
  const colors = colorMap[preview.type];
  const typeLabel = preview.type === "blog" ? "Blog Post" : preview.type === "webinar" ? "Webinar" : "Presentation";

  return (
    <div className={`mt-3 ${colors.border} border rounded-lg overflow-hidden`} data-testid="trend-content-preview">
      <div className={`flex items-center justify-between px-4 py-2.5 ${colors.bg} border-b ${colors.border}`}>
        <div className="flex items-center gap-2">
          <Eye className={`h-4 w-4 ${colors.text}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${colors.text}`}>{typeLabel} Preview</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={onSave} disabled={isSaving || isRefining} className="h-7 text-xs" data-testid="button-trend-save-drive">
            {isSaving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</> : <><Save className="h-3 w-3 mr-1" />Save to Google Drive</>}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" aria-label="Close preview" data-testid="button-close-trend-preview"><X className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {preview.type === "webinar" && (
        <div className={`flex border-b ${colors.border}`}>
          <button className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${activeTab === "abstract" ? `${colors.bg} ${colors.text} border-b-2 border-current` : "text-muted-foreground hover:bg-muted/30"}`} onClick={() => setActiveTab("abstract")} data-testid="tab-trend-abstract">
            <FileText className="h-3 w-3 inline mr-1" />Abstract
          </button>
          <button className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${activeTab === "content" ? `${colors.bg} ${colors.text} border-b-2 border-current` : "text-muted-foreground hover:bg-muted/30"}`} onClick={() => setActiveTab("content")} data-testid="tab-trend-content">
            Content
          </button>
        </div>
      )}

      <div className="max-h-[500px] overflow-auto">
        {preview.type === "blog" ? (
          <div className="p-5 bg-white dark:bg-background border-b border-border" data-testid="trend-blog-preview">
            <div className="max-w-2xl mx-auto prose-sm"><MarkdownRenderer content={preview.content} /></div>
          </div>
        ) : preview.type === "webinar" && activeTab === "abstract" ? (
          <div className="p-5 bg-white dark:bg-background border-b border-border" data-testid="trend-webinar-abstract">
            <div className="max-w-2xl mx-auto prose-sm"><MarkdownRenderer content={preview.abstract || ""} /></div>
          </div>
        ) : (
          <div className="p-4" data-testid="trend-presentation-preview">
            <TrendPresentationView preview={preview} />
          </div>
        )}
      </div>

      <div className={`px-4 py-2.5 border-t ${colors.border} ${colors.bg}`}>
        {!showRefineInput ? (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setShowRefineInput(true)} disabled={isRefining} className={`${colors.border} ${colors.text}`} data-testid="button-trend-preview-refine">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refine
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className={`text-xs font-medium ${colors.text}`}>What would you like to change?</p>
            <div className="relative">
              <Textarea placeholder="e.g., Add more data points, make it shorter..." aria-label="Refinement feedback" value={refineFeedback} onChange={(e) => setRefineFeedback(e.target.value)} className="text-xs resize-none pr-8" rows={2} data-testid="input-trend-preview-refine" />
              <VoiceInputButton onTranscript={(text) => setRefineFeedback(prev => prev ? prev + " " + text : text)} className="absolute top-1 right-1" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowRefineInput(false); setRefineFeedback(""); }} className="h-8" data-testid="button-cancel-trend-preview-refine">Cancel</Button>
              <Button size="sm" onClick={() => { if (refineFeedback.trim()) { onRefine(refineFeedback.trim()); setRefineFeedback(""); setShowRefineInput(false); } }} disabled={!refineFeedback.trim() || isRefining} className="h-8" data-testid="button-submit-trend-preview-refine">
                {isRefining ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refining...</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refine</>}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendContentGenerator({ name, description, category, model, idSuffix }: {
  name: string;
  description: string;
  category: string;
  model: string;
  idSuffix: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [linkedInPosts, setLinkedInPosts] = useState<string[] | null>(null);
  const [showLinkedInPrompt, setShowLinkedInPrompt] = useState(false);
  const [linkedInPostCount, setLinkedInPostCount] = useState("1");
  const [creationMode, setCreationMode] = useState<"blog" | "webinar" | "presentation" | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [presentationAudience, setPresentationAudience] = useState("");
  const [preview, setPreview] = useState<ContentPreview | null>(null);
  const [contentQuestions, setContentQuestions] = useState<TrendContentQuestion[]>([]);
  const [contentAnswers, setContentAnswers] = useState<Record<string, string>>({});
  const [contentAcknowledgment, setContentAcknowledgment] = useState("");
  const [creationPhase, setCreationPhase] = useState<"setup" | "questions" | "ready">("setup");
  const [contentFollowUpRound, setContentFollowUpRound] = useState(1);
  const [allContentQA, setAllContentQA] = useState<{ question: string; answer: string }[]>([]);
  const [createdContent, setCreatedContent] = useState<{ label: string; url: string; secondaryUrl?: string; secondaryLabel?: string } | null>(null);
  const { toast } = useToast();

  const oppPayload = {
    title: name,
    thesis: description,
    demandbase_angle: `This trend relates to ${category} and has implications for Demandbase's positioning in the B2B marketing and sales technology landscape.`,
    talking_points: [description],
    audience: "B2B marketing and sales leaders",
    format: "blog",
    timeliness: "Current market trend identified through news analysis",
  };

  const defaultNames: Record<string, string> = {
    blog: `Blog: ${name}`,
    webinar: name,
    presentation: `Presentation: ${name}`,
  };

  const contentQuestionsMutation = useMutation({
    mutationFn: async (contentType: "blog" | "webinar" | "presentation") => {
      const res = await apiRequest("POST", "/api/thought-leadership/content-questions", { contentType, title: name, thesis: description, audience: "B2B marketing and sales leaders", demandbase_angle: oppPayload.demandbase_angle, talking_points: [description], model });
      return res.json();
    },
    onSuccess: (data) => { setContentAcknowledgment(data.acknowledgment || ""); setContentQuestions(data.questions || []); setContentAnswers({}); setAllContentQA([]); setContentFollowUpRound(1); setCreationPhase("questions"); },
    onError: () => { toast({ title: "Failed to load questions", variant: "destructive" }); },
  });

  const contentFollowUpMutation = useMutation({
    mutationFn: async () => {
      const currentAnswers = contentQuestions.filter(q => (contentAnswers[q.id] || "").trim()).map(q => ({ question: q.question, answer: contentAnswers[q.id] }));
      const combinedQA = [...allContentQA, ...currentAnswers];
      const res = await apiRequest("POST", "/api/thought-leadership/content-followup", { contentType: creationMode, title: name, thesis: description, audience: "B2B marketing and sales leaders", previousQA: combinedQA, round: contentFollowUpRound, model });
      return { data: await res.json(), combinedQA };
    },
    onSuccess: ({ data, combinedQA }) => {
      setAllContentQA(combinedQA);
      if (data.ready || !data.questions || data.questions.length === 0) { if (data.reaction) setContentAcknowledgment(data.reaction); setCreationPhase("ready"); }
      else { setContentAcknowledgment(data.reaction || ""); setContentQuestions(data.questions); setContentAnswers({}); setContentFollowUpRound(prev => prev + 1); }
    },
    onError: () => { toast({ title: "Failed to process", variant: "destructive" }); },
  });

  const openCreationPrompt = (mode: "blog" | "webinar" | "presentation") => {
    if (creationMode === mode) { setCreationMode(null); setCreationPhase("setup"); return; }
    setCreationMode(mode); setDocumentName(defaultNames[mode]); setPresentationAudience(""); setCreationPhase("setup");
    setContentQuestions([]); setContentAnswers({}); setContentAcknowledgment(""); setAllContentQA([]); setContentFollowUpRound(1);
    contentQuestionsMutation.mutate(mode);
  };

  const resetCreationPrompt = () => {
    setCreationMode(null); setDocumentName(""); setCreationPhase("setup");
    setContentQuestions([]); setContentAnswers({}); setContentAcknowledgment(""); setAllContentQA([]); setContentFollowUpRound(1);
  };

  const getCreatorAnswers = () => [...allContentQA, ...contentQuestions.filter(q => (contentAnswers[q.id] || "").trim()).map(q => ({ question: q.question, answer: contentAnswers[q.id] }))];
  const contentAnsweredCount = contentQuestions.filter(q => (contentAnswers[q.id] || "").trim()).length;

  const linkedInMutation = useMutation({
    mutationFn: async (params: { postCount: number; refinement?: string; previousPosts?: string[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/linkedin-post", { ...oppPayload, postCount: params.postCount, refinement: params.refinement || "", previousPosts: params.previousPosts || [], model });
      return res.json();
    },
    onSuccess: (data) => { setLinkedInPosts(data.posts || [data.post]); setShowLinkedInPrompt(false); },
    onError: () => { toast({ title: "Failed to generate posts", variant: "destructive" }); },
  });

  const blogMutation = useMutation({
    mutationFn: async (params: { name: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/generate-blog", { ...oppPayload, documentName: params.name, refinement: params.refinement || "", previousContent: params.previousContent || "", creatorAnswers: params.creatorAnswers || [], model });
      return res.json();
    },
    onSuccess: (data) => { setPreview({ type: "blog", content: data.content }); resetCreationPrompt(); },
    onError: () => { toast({ title: "Failed to generate blog", variant: "destructive" }); },
  });

  const webinarMutation = useMutation({
    mutationFn: async (params: { name: string; refinement?: string; previousContent?: string; designTemplate?: string; creatorAnswers?: { question: string; answer: string }[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/generate-webinar", { ...oppPayload, documentName: params.name, refinement: params.refinement || "", previousContent: params.previousContent || "", creatorAnswers: params.creatorAnswers || [], model });
      return res.json();
    },
    onSuccess: (data) => { setPreview({ type: "webinar", content: "", abstract: data.abstract, headline: data.headline, storyArc: data.storyArc, slideOutline: data.slideOutline, talkTrack: data.talkTrack }); resetCreationPrompt(); },
    onError: () => { toast({ title: "Failed to generate webinar", variant: "destructive" }); },
  });

  const presentationMutation = useMutation({
    mutationFn: async (params: { name: string; targetAudience: string; refinement?: string; previousContent?: string; designTemplate?: string; creatorAnswers?: { question: string; answer: string }[] }) => {
      const res = await apiRequest("POST", "/api/thought-leadership/generate-presentation", { ...oppPayload, targetAudience: params.targetAudience, documentName: params.name, refinement: params.refinement || "", previousContent: params.previousContent || "", creatorAnswers: params.creatorAnswers || [], model });
      return res.json();
    },
    onSuccess: (data) => { setPreview({ type: "presentation", content: "", headline: data.headline, storyArc: data.storyArc, slideOutline: data.slideOutline, talkTrack: data.talkTrack }); resetCreationPrompt(); },
    onError: () => { toast({ title: "Failed to generate presentation", variant: "destructive" }); },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("No preview");
      const body: Record<string, string> = { type: preview.type, documentName: documentName || defaultNames[preview.type] };
      if (preview.type === "blog") body.content = preview.content;
      else if (preview.type === "webinar") { body.content = preview.abstract || ""; body.slidesContent = JSON.stringify(preview.slideOutline || []); }
      else body.content = preview.content;
      const res = await apiRequest("POST", "/api/thought-leadership/save-to-drive", body);
      return res.json();
    },
    onSuccess: (data) => {
      if (preview?.type === "webinar") setCreatedContent({ label: "Webinar", url: data.docUrl, secondaryUrl: data.slidesUrl, secondaryLabel: "Slide Deck" });
      else setCreatedContent({ label: preview?.type === "blog" ? "Blog post" : "Presentation", url: data.url });
      setPreview(null);
      toast({ title: `${preview?.type === "blog" ? "Blog" : preview?.type === "webinar" ? "Webinar" : "Presentation"} saved to Google Drive` });
    },
    onError: () => { toast({ title: "Failed to save", variant: "destructive" }); },
  });

  const isAnyGenerating = blogMutation.isPending || webinarMutation.isPending || presentationMutation.isPending;

  const closeDialog = () => {
    setExpanded(false);
    resetCreationPrompt();
    setLinkedInPosts(null);
    setShowLinkedInPrompt(false);
    setPreview(null);
    setCreatedContent(null);
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setExpanded(true)} data-testid={`button-create-content-${idSuffix}`}>
        <Pen className="h-3 w-3 mr-1" />Create Content
      </Button>

      <Dialog open={expanded} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className={`w-[95vw] max-h-[85vh] overflow-y-auto p-4 sm:p-6 ${linkedInPosts || preview ? "max-w-2xl" : "max-w-lg"}`} data-testid={`trend-content-gen-${idSuffix}`}>
          <DialogHeader className="pb-3 border-b border-border">
            <DialogTitle className="text-sm font-semibold">{name}</DialogTitle>
            {!linkedInPosts && !preview && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>}
          </DialogHeader>

          {!linkedInPosts && !preview && (<>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => { setShowLinkedInPrompt(!showLinkedInPrompt); setLinkedInPostCount("1"); }} disabled={linkedInMutation.isPending} className="h-9 text-xs border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 justify-start" data-testid={`button-trend-linkedin-${idSuffix}`}>
              {linkedInMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin shrink-0" />Generating...</> : <><Linkedin className="h-3.5 w-3.5 mr-1.5 shrink-0" />LinkedIn Post</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openCreationPrompt("blog")} disabled={blogMutation.isPending || isAnyGenerating} className="h-9 text-xs border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 justify-start" data-testid={`button-trend-blog-${idSuffix}`}>
              {blogMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin shrink-0" />Generating...</> : <><FilePen className="h-3.5 w-3.5 mr-1.5 shrink-0" />Create Blog</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openCreationPrompt("webinar")} disabled={webinarMutation.isPending || isAnyGenerating} className="h-9 text-xs border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-400 justify-start" data-testid={`button-trend-webinar-${idSuffix}`}>
              {webinarMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin shrink-0" />Generating...</> : <><Video className="h-3.5 w-3.5 mr-1.5 shrink-0" />Create Webinar</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openCreationPrompt("presentation")} disabled={presentationMutation.isPending || isAnyGenerating} className="h-9 text-xs border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 justify-start" data-testid={`button-trend-presentation-${idSuffix}`}>
              {presentationMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin shrink-0" />Generating...</> : <><Presentation className="h-3.5 w-3.5 mr-1.5 shrink-0" />Create Presentation</>}
            </Button>
          </div>

          {creationMode && !isAnyGenerating && (
            <div className={`border rounded-lg p-3 sm:p-4 ${creationMode === "blog" ? "border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20" : creationMode === "webinar" ? "border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/20" : "border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20"}`} data-testid="trend-creation-prompt">
              {contentQuestionsMutation.isPending && (
                <div className="flex items-center gap-2 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /><span className="text-xs text-muted-foreground">Preparing questions...</span></div>
              )}

              {creationPhase === "questions" && contentQuestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold ${creationMode === "blog" ? "text-violet-700 dark:text-violet-400" : creationMode === "webinar" ? "text-teal-700 dark:text-teal-400" : "text-orange-700 dark:text-orange-400"}`} data-testid="text-trend-questions-heading">
                      {contentFollowUpRound === 1 ? "Shape your" : "Follow-up:"} {creationMode === "blog" ? "blog post" : creationMode === "webinar" ? "webinar" : "presentation"}
                    </p>
                    <Button variant="ghost" size="sm" onClick={resetCreationPrompt} className="h-7 text-xs" data-testid="button-trend-cancel-creation"><X className="h-3 w-3 mr-1" />Cancel</Button>
                  </div>
                  {contentAcknowledgment && <p className="text-xs text-foreground/80 leading-relaxed">{contentAcknowledgment}</p>}
                  <p className="text-xs text-muted-foreground">Answer what resonates. Your answers directly shape the final {creationMode === "blog" ? "blog" : creationMode === "webinar" ? "webinar" : "deck"}.</p>
                  <div className="space-y-2.5">
                    {contentQuestions.map((q, qi) => (
                      <div key={q.id} className="rounded-md border border-border bg-background p-2.5" data-testid={`trend-question-${qi}`}>
                        <div className="flex items-start gap-1.5 mb-1.5">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold mt-0.5 ${creationMode === "blog" ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400" : creationMode === "webinar" ? "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400" : "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400"}`}>{qi + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground leading-snug">{q.question}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 italic">{q.why}</p>
                          </div>
                        </div>
                        <div className="relative">
                          <Textarea placeholder="Your thoughts..." aria-label={`Answer to question ${qi + 1}`} value={contentAnswers[q.id] || ""} onChange={(e) => setContentAnswers(prev => ({ ...prev, [q.id]: e.target.value }))} rows={2} className="resize-none text-xs pr-8" data-testid={`input-trend-answer-${qi}`} />
                          <VoiceInputButton onTranscript={(text) => setContentAnswers(prev => ({ ...prev, [q.id]: (prev[q.id] || "") ? prev[q.id] + " " + text : text }))} className="absolute top-1 right-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pt-2 border-t border-border gap-2">
                    <p className="text-[10px] text-muted-foreground">{contentAnsweredCount} of {contentQuestions.length} answered</p>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setAllContentQA(getCreatorAnswers()); setCreationPhase("ready"); }} disabled={contentFollowUpMutation.isPending} data-testid="button-trend-skip-questions">
                        <ArrowRight className="h-3 w-3 mr-1" />Skip
                      </Button>
                      <Button size="sm" onClick={() => contentFollowUpMutation.mutate()} disabled={contentAnsweredCount === 0 || contentFollowUpMutation.isPending} className="h-7 text-xs" data-testid="button-trend-proceed">
                        {contentFollowUpMutation.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Reviewing...</> : <><ArrowRight className="h-3 w-3 mr-1" />Continue</>}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {creationPhase === "ready" && (
                <div className="space-y-3">
                  <p className={`text-xs font-medium ${creationMode === "blog" ? "text-violet-700 dark:text-violet-400" : creationMode === "webinar" ? "text-teal-700 dark:text-teal-400" : "text-orange-700 dark:text-orange-400"}`}>
                    Name your {creationMode === "blog" ? "blog post" : creationMode === "webinar" ? "webinar" : "presentation"}
                  </p>
                  <div className="flex items-center gap-1">
                    <Input type="text" placeholder="Document name in Google Drive" aria-label="Document name" value={documentName} onChange={(e) => setDocumentName(e.target.value)} className="text-xs h-8 flex-1" data-testid="input-trend-doc-name" />
                    <VoiceInputButton onTranscript={(text) => setDocumentName(prev => prev ? prev + " " + text : text)} />
                  </div>
                  {creationMode === "presentation" && (
                    <div className="flex items-center gap-1">
                      <Input type="text" placeholder="Target audience, e.g., CMOs at B2B SaaS companies" aria-label="Target audience" value={presentationAudience} onChange={(e) => setPresentationAudience(e.target.value)} className="text-xs h-8 flex-1" data-testid="input-trend-pres-audience" />
                      <VoiceInputButton onTranscript={(text) => setPresentationAudience(prev => prev ? prev + " " + text : text)} />
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 justify-end">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={resetCreationPrompt} className="h-8 text-xs" data-testid="button-trend-cancel-ready">Cancel</Button>
                      <Button variant="ghost" size="sm" onClick={() => setCreationPhase("questions")} className="h-8 text-xs" data-testid="button-trend-back-questions">
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" />Back
                      </Button>
                    </div>
                    <Button size="sm" onClick={() => {
                      const n = documentName.trim(); if (!n) return;
                      const answers = getCreatorAnswers();
                      if (creationMode === "blog") blogMutation.mutate({ name: n, creatorAnswers: answers });
                      else if (creationMode === "webinar") webinarMutation.mutate({ name: n, creatorAnswers: answers });
                      else if (presentationAudience.trim()) presentationMutation.mutate({ name: n, targetAudience: presentationAudience.trim(), creatorAnswers: answers });
                    }} disabled={!documentName.trim() || (creationMode === "presentation" && !presentationAudience.trim())} className="h-8" data-testid="button-trend-generate-preview">
                      <Eye className="h-3.5 w-3.5 mr-1.5" />Generate Preview
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showLinkedInPrompt && !linkedInMutation.isPending && !linkedInPosts && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-3" data-testid="trend-linkedin-prompt">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-2">How many LinkedIn posts would you like?</p>
              <div className="flex flex-wrap gap-2">
                <Select value={linkedInPostCount} onValueChange={setLinkedInPostCount}>
                  <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="select-trend-li-count"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map(v => <SelectItem key={v} value={v}>{v} post{v !== "1" ? "s" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => linkedInMutation.mutate({ postCount: parseInt(linkedInPostCount) })} className="h-8" data-testid="button-trend-confirm-li">Generate</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowLinkedInPrompt(false)} className="h-8" data-testid="button-trend-cancel-li">Cancel</Button>
              </div>
            </div>
          )}
          </>)}

          {linkedInPosts && (
            <TrendLinkedInModal posts={linkedInPosts} onClose={() => setLinkedInPosts(null)} isRefining={linkedInMutation.isPending} onRefine={(feedback) => linkedInMutation.mutate({ postCount: linkedInPosts.length, refinement: feedback, previousPosts: linkedInPosts })} />
          )}

          {preview && (
            <TrendContentPreviewModal
              preview={preview}
              documentName={documentName || (preview.type ? defaultNames[preview.type] : "")}
              onClose={() => setPreview(null)}
              isSaving={saveMutation.isPending}
              isRefining={blogMutation.isPending || webinarMutation.isPending || presentationMutation.isPending}
              onSave={() => saveMutation.mutate()}
              onRefine={(feedback) => {
                if (preview.type === "blog") blogMutation.mutate({ name: documentName, refinement: feedback, previousContent: preview.content, creatorAnswers: getCreatorAnswers() });
                else if (preview.type === "webinar") webinarMutation.mutate({ name: documentName, refinement: feedback, previousContent: JSON.stringify({ abstract: preview.abstract, talkTrack: preview.talkTrack }), creatorAnswers: getCreatorAnswers() });
                else presentationMutation.mutate({ name: documentName, targetAudience: presentationAudience, refinement: feedback, previousContent: preview.content, creatorAnswers: getCreatorAnswers() });
              }}
            />
          )}

          {createdContent && (
            <div className="border border-emerald-200 dark:border-emerald-800 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 p-3" data-testid="trend-created-content">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{createdContent.label} saved!</span>
                </div>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <a href={createdContent.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 dark:text-blue-400 underline" data-testid="link-trend-created-doc">Open in Google Drive</a>
                  {createdContent.secondaryUrl && (
                    <a href={createdContent.secondaryUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 dark:text-blue-400 underline" data-testid="link-trend-created-secondary">{createdContent.secondaryLabel || "Open"}</a>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </>
  );
}

interface CompanySentimentItem {
  company: string;
  sentiment: number;
  label: "positive" | "negative" | "neutral" | "mixed";
  trending: "improving" | "declining" | "stable";
  reason: string;
}

interface ParsedSnapshot {
  id: number;
  trends: TrendItem[];
  emergingSignals: EmergingSignal[];
  companySentiment: CompanySentimentItem[];
  articleCount: number;
  days: number;
  model: string | null;
  createdAt: string;
}

const DATE_RANGES = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const CATEGORY_COLORS: Record<string, string> = {
  "AI & Automation": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "Sales Strategy": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "MarTech Stack": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Data & Privacy": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  "Buyer Behavior": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Revenue Operations": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  "Competitive Landscape": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "Content & Personalization": "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatSnapshotLabel(snap: { createdAt: string; days: number; model: string | null }): string {
  const endDate = new Date(snap.createdAt);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - snap.days);
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  const range = `${fmt(startDate)}-${fmt(endDate)}`;
  if (snap.model && MODEL_DISPLAY[snap.model]) {
    return `${range} - ${MODEL_DISPLAY[snap.model].label}`;
  }
  return range;
}

function safeJsonParse(str: string | null | undefined, fallback: any[] = []): any {
  try {
    return JSON.parse(str || "[]") || fallback;
  } catch {
    return fallback;
  }
}

function parseSnapshot(snap: TrendSnapshot): ParsedSnapshot {
  return {
    id: snap.id,
    trends: safeJsonParse(snap.trends),
    emergingSignals: safeJsonParse(snap.emergingSignals),
    companySentiment: safeJsonParse(snap.companySentiment),
    articleCount: snap.articleCount,
    days: snap.days,
    model: snap.model,
    createdAt: snap.createdAt as unknown as string,
  };
}

function MomentumIcon({ momentum }: { momentum: string }) {
  if (momentum === "rising") return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />;
  if (momentum === "declining") return <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function TrendingIcon({ trending }: { trending: string }) {
  if (trending === "improving") return <ArrowUpRight className="h-3 w-3 text-emerald-500" />;
  if (trending === "declining") return <ArrowDownRight className="h-3 w-3 text-red-500" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function TrendCard({ trend, onDrillDown, isWatched, onWatch, model }: {
  trend: TrendItem;
  onDrillDown: () => void;
  isWatched?: boolean;
  onWatch?: (trend: TrendItem) => void;
  model: string;
}) {
  const catColor = CATEGORY_COLORS[trend.category] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  const confidencePct = Math.round(trend.confidence * 100);
  const idSuffix = trend.name.slice(0, 20).replace(/\s+/g, "-").toLowerCase();

  return (
    <Card className={`p-4 hover:shadow-md transition-shadow ${isWatched ? "ring-1 ring-amber-300 dark:ring-amber-700" : ""}`} data-testid={`card-trend-${trend.name.slice(0, 20)}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <MomentumIcon momentum={trend.momentum} />
          <span className="text-xs font-medium capitalize text-muted-foreground">
            {trend.momentum}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Badge className={`text-[10px] px-1.5 py-0 ${catColor}`}>
            {trend.category}
          </Badge>
          {onWatch && (
            <Button
              variant="ghost"
              size="sm"
              className={`px-1.5 ${isWatched ? "text-amber-500" : "text-muted-foreground"}`}
              onClick={() => onWatch(trend)}
              aria-label={isWatched ? "Remove trend from watchlist" : "Add trend to watchlist"}
              data-testid={`button-watch-trend-${trend.name.slice(0, 20)}`}
            >
              {isWatched ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>
      <h4 className="text-sm font-semibold text-foreground leading-tight mb-1.5">
        {trend.name}
      </h4>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {trend.description}
      </p>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-16 bg-muted rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={confidencePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Confidence"
          >
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{confidencePct}%</span>
        </div>
        <div className="flex items-center gap-1">
          {trend.articleIds && trend.articleIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={onDrillDown}
              data-testid={`button-drilldown-${trend.name.slice(0, 20)}`}
            >
              <FileText className="h-3 w-3 mr-1" />
              {trend.articleIds.length} articles
            </Button>
          )}
          <TrendContentGenerator name={trend.name} description={trend.description} category={trend.category} model={model} idSuffix={`trend-${idSuffix}`} />
        </div>
      </div>
    </Card>
  );
}

function ArticleDrilldownDialog({
  open,
  onClose,
  articleIds,
  trendName,
}: {
  open: boolean;
  onClose: () => void;
  articleIds: number[];
  trendName: string;
}) {
  const articlesQuery = useQuery<{ articles: Article[] }>({
    queryKey: ["/api/articles/by-ids", articleIds],
    queryFn: async () => {
      const res = await fetch("/api/articles/by-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: articleIds }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch articles");
      return res.json();
    },
    enabled: open && articleIds.length > 0,
  });

  const matchedArticles = articlesQuery.data?.articles || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" />
            Supporting Articles
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{trendName}</p>
        </DialogHeader>
        <div className="flex-1 overflow-auto space-y-2">
          {articlesQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : matchedArticles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No matching articles found.
            </p>
          ) : (
            matchedArticles.map((article) => (
              <Card key={article.id} className="p-3" data-testid={`card-drill-article-${article.id}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-foreground leading-tight line-clamp-2">
                      {article.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {article.category && (
                        <Badge variant="secondary" className="text-[10px]">
                          {article.category}
                        </Badge>
                      )}
                      {article.sourceName && (
                        <span className="text-[10px] text-muted-foreground">
                          {article.sourceName}
                        </span>
                      )}
                      {article.publishedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(article.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {article.link && (
                    <a href={article.link} target="_blank" rel="noopener noreferrer" data-testid={`link-article-${article.id}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Open article in new tab">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompanySentimentChart({ data }: { data: CompanySentimentItem[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No company sentiment data available</p>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.sentiment - a.sentiment);
  const chartData = sorted.map(c => ({
    company: c.company,
    sentiment: parseFloat(c.sentiment.toFixed(2)),
    label: c.label,
    trending: c.trending,
    reason: c.reason,
  }));

  return (
    <div className="space-y-3">
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" horizontal={false} />
            <XAxis
              type="number"
              domain={[-1, 1]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <YAxis
              dataKey="company"
              type="category"
              tick={{ fontSize: 10 }}
              width={100}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs max-w-[250px]">
                    <p className="font-semibold">{d.company}</p>
                    <p className="text-muted-foreground mt-0.5">Sentiment: {d.sentiment > 0 ? "+" : ""}{d.sentiment}</p>
                    <p className="text-muted-foreground">Trending: {d.trending}</p>
                    <p className="text-muted-foreground mt-1">{d.reason}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="sentiment" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.sentiment >= 0 ? "hsl(142, 71%, 45%)" : "hsl(0, 72%, 51%)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((c) => (
          <div key={c.company} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <TrendingIcon trending={c.trending} />
            <span>{c.company}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitiveIntelChart({
  data,
  selectedCompetitors,
  onToggleCompetitor,
}: {
  data: CompetitiveMentionItem[];
  selectedCompetitors: string[];
  onToggleCompetitor: (c: string) => void;
}) {
  const allCompetitors = useMemo(
    () => Array.from(new Set(data.map((d) => d.competitor))),
    [data]
  );

  const active = selectedCompetitors.length > 0
    ? selectedCompetitors
    : allCompetitors.slice(0, 5);

  const chartData = useMemo(() => {
    const filtered = data.filter((d) => active.includes(d.competitor));
    const byDate: Record<string, Record<string, number>> = {};

    for (const item of filtered) {
      if (!byDate[item.date]) byDate[item.date] = {};
      byDate[item.date][item.competitor] = item.count;
    }

    return Object.keys(byDate)
      .sort()
      .map((date) => ({
        date,
        dateLabel: formatDate(date),
        ...byDate[date],
      }));
  }, [data, active]);

  if (allCompetitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">
          No competitors configured. Add competitors in the Sources page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {allCompetitors.map((comp) => (
          <Badge
            key={comp}
            variant={active.includes(comp) ? "default" : "secondary"}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-pressed={active.includes(comp)}
            onClick={() => onToggleCompetitor(comp)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleCompetitor(comp);
              }
            }}
            data-testid={`badge-competitor-${comp}`}
          >
            {comp}
          </Badge>
        ))}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
            <YAxis
              tick={{ fontSize: 10 }}
              label={{ value: "Mentions", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs">
                    <p className="font-semibold mb-1">{label}</p>
                    {payload.map((p: any) => (
                      <div key={p.dataKey} className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span>{p.dataKey}: {p.value} mentions</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {active.map((comp, i) => (
              <Line
                key={comp}
                type="monotone"
                dataKey={comp}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface DemandbaseMentionsData {
  byDate: Array<{ date: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  total: number;
  topArticles: Article[];
}

const DB_CATEGORY_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function DemandbaseIntelChart({ data }: { data: DemandbaseMentionsData }) {
  const chartData = useMemo(() =>
    data.byDate.map(d => ({ ...d, dateLabel: formatDate(d.date) })),
    [data.byDate]
  );

  if (data.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">
          No Demandbase mentions found in this time period.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-bold text-primary" data-testid="text-db-total-mentions">{data.total}</p>
          <p className="text-xs text-muted-foreground">Total Mentions</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-bold text-foreground" data-testid="text-db-days-active">{data.byDate.length}</p>
          <p className="text-xs text-muted-foreground">Days with Coverage</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-bold text-foreground" data-testid="text-db-avg-per-day">
            {data.byDate.length > 0 ? (data.total / data.byDate.length).toFixed(1) : "0"}
          </p>
          <p className="text-xs text-muted-foreground">Avg. per Day</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <p className="text-xs font-medium text-muted-foreground mb-2">Mentions Over Time</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs">
                        <p className="font-semibold mb-1">{label}</p>
                        <p>{payload[0].value} mentions</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(217, 91%, 60%)"
                  fill="hsl(217, 91%, 60%)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">By Category</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.byCategory}
                  dataKey="count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={40}
                  paddingAngle={2}
                >
                  {data.byCategory.map((_, i) => (
                    <Cell key={i} fill={DB_CATEGORY_COLORS[i % DB_CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs">
                        <p className="font-semibold">{d.category}</p>
                        <p>{d.count} articles</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 mt-1">
            {data.byCategory.slice(0, 5).map((c, i) => (
              <div key={c.category} className="flex items-center gap-1.5 text-[10px]">
                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: DB_CATEGORY_COLORS[i % DB_CATEGORY_COLORS.length] }} />
                <span className="text-muted-foreground truncate">{c.category}</span>
                <span className="ml-auto font-medium">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.topArticles.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent Articles Mentioning Demandbase</p>
          <div className="space-y-1.5">
            {data.topArticles.slice(0, 5).map(article => (
              <a
                key={article.id}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 p-2 rounded-md border border-border hover:bg-muted/50 transition-colors group"
                data-testid={`link-db-article-${article.id}`}
              >
                <ExternalLink className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0 group-hover:text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground line-clamp-1">{article.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {article.sourceName && (
                      <span className="text-[10px] text-muted-foreground">{article.sourceName}</span>
                    )}
                    {article.publishedAt && (
                      <span className="text-[10px] text-muted-foreground">{formatDate(typeof article.publishedAt === "string" ? article.publishedAt : new Date(article.publishedAt).toISOString())}</span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveViewDialog({
  open,
  onClose,
  onSave,
  currentConfig,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  currentConfig: DashboardConfig;
}) {
  const [name, setName] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save Dashboard View</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="View name..."
            aria-label="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-view-name"
          />
          <p className="text-xs text-muted-foreground">
            Saves current filters: {currentConfig.dateRange}d range
            {currentConfig.category !== "all" && `, ${currentConfig.category}`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (name.trim()) {
                  onSave(name.trim());
                  setName("");
                }
              }}
              disabled={!name.trim()}
              data-testid="button-confirm-save-view"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OldTrendsSection({
  trends,
  onDelete,
}: {
  trends: TrendAnalysis[];
  onDelete: (id: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (trends.length === 0) return null;

  return (
    <div className="space-y-3">
      {trends.map((trend) => {
        const expanded = expandedId === trend.id;
        const date = new Date(trend.createdAt);
        const timeAgo = getTimeAgo(date);

        return (
          <Card key={trend.id} className="p-4" data-testid={`card-trend-${trend.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeAgo}
                  </span>
                  {trend.model && MODEL_DISPLAY[trend.model] && (
                    <span className={`text-[10px] font-medium ${MODEL_DISPLAY[trend.model].color}`} data-testid={`text-trend-model-${trend.id}`}>
                      {MODEL_DISPLAY[trend.model].label}
                    </span>
                  )}
                </div>
                <h3
                  className="text-sm font-semibold text-foreground leading-tight"
                  data-testid={`text-trend-title-${trend.id}`}
                >
                  {trend.title}
                </h3>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <ConfirmDestructive
                  title={`Delete "${trend.title}"?`}
                  description="This AI report is permanently deleted. This can't be undone."
                  onConfirm={() => onDelete(trend.id)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete report"
                    data-testid={`button-delete-trend-${trend.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </ConfirmDestructive>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setExpandedId(expanded ? null : trend.id)}
                  aria-label={expanded ? "Collapse report" : "Expand report"}
                  data-testid={`button-toggle-trend-${trend.id}`}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {expanded && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {trend.keyThemes.map((theme, i) => (
                    <Badge key={i} variant="secondary" className="text-xs" data-testid={`badge-theme-${trend.id}-${i}`}>
                      <Zap className="h-3 w-3 mr-1" />
                      {theme}
                    </Badge>
                  ))}
                </div>
                <div className="rounded-md bg-muted/30 p-3" data-testid={`text-trend-summary-${trend.id}`}>
                  <MarkdownRenderer content={trend.summary} />
                </div>
                <div data-testid={`text-trend-insights-${trend.id}`}>
                  <MarkdownRenderer content={trend.insights} />
                </div>
                {trend.articleIds && trend.articleIds.length > 0 && (
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                    Based on {trend.articleIds.length.toLocaleString()} articles
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}


interface WatchlistHistoryEntry {
  snapshotId: number;
  date: string;
  momentum: string;
  confidence: number;
  articleCount: number;
  description: string;
  days: number;
}

function WatchlistItemCard({ item, onRemove, onUpdate }: {
  item: TrendWatchlistItem;
  onRemove: (id: number) => void;
  onUpdate: (id: number, data: Partial<TrendWatchlistItem>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(item.notes || "");
  const catColor = CATEGORY_COLORS[item.category || ""] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

  const historyQuery = useQuery<{ item: TrendWatchlistItem; history: WatchlistHistoryEntry[] }>({
    queryKey: [`/api/trends/watchlist/${item.id}/history`],
    enabled: expanded,
  });

  const history = historyQuery.data?.history || [];
  const latestEntry = history[0];

  return (
    <Card className="p-4" data-testid={`card-watchlist-${item.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <BookmarkCheck className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <h4 className="text-sm font-semibold truncate">{item.trendName}</h4>
            {item.category && <Badge className={`text-[10px] px-1.5 py-0 ${catColor}`}>{item.category}</Badge>}
            {!item.isActive && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
          </div>
          {latestEntry && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MomentumIcon momentum={latestEntry.momentum as any} />
              <span className="capitalize">{latestEntry.momentum}</span>
              <span>|</span>
              <span>{Math.round(latestEntry.confidence * 100)}% confidence</span>
              <span>|</span>
              <span>{latestEntry.articleCount} articles</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse watched trend" : "Expand watched trend"}
            data-testid={`button-expand-watchlist-${item.id}`}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          <ConfirmDestructive
            title={`Stop watching "${item.trendName}"?`}
            description="The trend is removed from your watchlist along with your notes and its tracked history view. This can't be undone."
            confirmLabel="Remove"
            onConfirm={() => onRemove(item.id)}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              aria-label="Remove from watchlist"
              data-testid={`button-remove-watchlist-${item.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </ConfirmDestructive>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Tracking since {new Date(item.createdAt!).toLocaleDateString()}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] ml-auto"
              onClick={() => onUpdate(item.id, { isActive: !item.isActive })}
              data-testid={`button-toggle-active-${item.id}`}
            >
              {item.isActive ? "Pause Tracking" : "Resume Tracking"}
            </Button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Notes</span>
              {!editingNotes && (
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setEditingNotes(true)}>
                  Edit
                </Button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex gap-2">
                <Input
                  className="flex-1 text-xs h-7"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about why you're tracking this trend..."
                  aria-label="Watchlist notes"
                  data-testid={`input-notes-${item.id}`}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { onUpdate(item.id, { notes }); setEditingNotes(false); }}
                  data-testid={`button-save-notes-${item.id}`}
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{item.notes || "No notes yet"}</p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Snapshot History</span>
            </div>
            {historyQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading history...
              </div>
            ) : historyQuery.isError ? (
              <p className="text-xs text-destructive py-2">
                Failed to load history. Try collapsing and expanding again.
              </p>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No matching snapshots found yet. Generate more snapshots to see how this trend evolves.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((entry, i) => (
                  <div key={entry.snapshotId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs py-1.5 px-2 rounded bg-muted/50">
                    <span className="text-muted-foreground w-20 flex-shrink-0">
                      {new Date(entry.date).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <MomentumIcon momentum={entry.momentum as any} />
                      <span className="capitalize">{entry.momentum}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div
                        className="h-1.5 w-10 bg-muted rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuenow={Math.round(entry.confidence * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Confidence"
                      >
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(entry.confidence * 100)}%` }} />
                      </div>
                      <span className="text-muted-foreground">{Math.round(entry.confidence * 100)}%</span>
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap">{entry.articleCount} articles</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{entry.days}d</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function WatchlistTab({ watchlist, isLoading, onRemove, onUpdate }: {
  watchlist: TrendWatchlistItem[];
  isLoading: boolean;
  onRemove: (id: number) => void;
  onUpdate: (id: number, data: Partial<TrendWatchlistItem>) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 max-w-3xl mx-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-5 w-2/3 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        ))}
      </div>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
          <Bookmark className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-base font-semibold mb-1" data-testid="text-empty-watchlist">
          No Watched Trends
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Click the bookmark icon on any trend in the Dashboard tab to start tracking it.
          You'll see how its momentum and confidence change across snapshots over time.
        </p>
      </div>
    );
  }

  const active = watchlist.filter(w => w.isActive);
  const paused = watchlist.filter(w => !w.isActive);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Eye className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">Tracking {active.length} trend{active.length !== 1 ? "s" : ""}</span>
        {paused.length > 0 && (
          <span className="text-xs text-muted-foreground">({paused.length} paused)</span>
        )}
      </div>

      {active.map(item => (
        <WatchlistItemCard key={item.id} item={item} onRemove={onRemove} onUpdate={onUpdate} />
      ))}
      {paused.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider pt-2">
            Paused
          </div>
          {paused.map(item => (
            <WatchlistItemCard key={item.id} item={item} onRemove={onRemove} onUpdate={onUpdate} />
          ))}
        </>
      )}
    </div>
  );
}

export default function Trends() {
  const { toast } = useToast();
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-trends");
  const [activeTab, setActiveTab] = useState<"dashboard" | "briefs" | "watchlist">("dashboard");
  const [dateRange, setDateRange] = useState("30");
  const [customDateRange, setCustomDateRange] = useState<{ from?: Date; to?: Date } | undefined>();
  const [category, setCategory] = useState("all");
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [snapshotDays, setSnapshotDays] = useState("30");
  const [trendsExpanded, setTrendsExpanded] = useState(true);
  const [signalsExpanded, setSignalsExpanded] = useState(true);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [drilldownTrend, setDrilldownTrend] = useState<TrendItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categoriesQuery = useQuery<NewsCategory[]>({
    queryKey: ["/api/news-categories"],
  });

  const competitiveQueryUrl = useMemo(() => {
    const params = new URLSearchParams({ days: dateRange });
    if (dateRange === "custom" && customDateRange?.from && customDateRange?.to) {
      params.set("dateFrom", customDateRange.from.toISOString().split("T")[0]);
      params.set("dateTo", customDateRange.to.toISOString().split("T")[0]);
    }
    return `/api/analytics/competitive-mentions?${params.toString()}`;
  }, [dateRange, customDateRange]);

  const competitiveQuery = useQuery<CompetitiveMentionItem[]>({
    queryKey: [competitiveQueryUrl],
  });

  const demandbaseQueryUrl = useMemo(() => {
    const params = new URLSearchParams({ days: dateRange });
    if (dateRange === "custom" && customDateRange?.from && customDateRange?.to) {
      params.set("dateFrom", customDateRange.from.toISOString().split("T")[0]);
      params.set("dateTo", customDateRange.to.toISOString().split("T")[0]);
    }
    return `/api/analytics/demandbase-mentions?${params.toString()}`;
  }, [dateRange, customDateRange]);

  const demandbaseQuery = useQuery<DemandbaseMentionsData>({
    queryKey: [demandbaseQueryUrl],
  });

  const viewsQuery = useQuery<DashboardView[]>({
    queryKey: ["/api/dashboard-views"],
  });

  const trendsQuery = useQuery<TrendAnalysis[]>({
    queryKey: ["/api/trends"],
  });

  const snapshotsQuery = useQuery<TrendSnapshot[]>({
    queryKey: ["/api/trends/snapshots"],
  });

  const watchlistQuery = useQuery<TrendWatchlistItem[]>({
    queryKey: ["/api/trends/watchlist"],
  });

  const watchedNames = useMemo(() => {
    return new Set((watchlistQuery.data || []).map(w => w.trendName.toLowerCase()));
  }, [watchlistQuery.data]);

  const addToWatchlistMutation = useMutation({
    mutationFn: async (data: { trendName: string; category: string; firstSeenSnapshotId?: number }) => {
      const res = await apiRequest("POST", "/api/trends/watchlist", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/watchlist"] });
      toast({ title: "Added to watchlist", description: "This trend will be tracked across future snapshots." });
    },
    onError: () => {
      toast({ title: "Failed to add", variant: "destructive" });
    },
  });

  const removeFromWatchlistMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/trends/watchlist/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
    onError: () => {
      toast({ title: "Couldn't remove from watchlist", description: "The removal failed. Try again.", variant: "destructive" });
    },
  });

  const updateWatchlistMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TrendWatchlistItem> }) => {
      const res = await apiRequest("PATCH", `/api/trends/watchlist/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/watchlist"] });
    },
    onError: () => {
      toast({ title: "Couldn't update watchlist item", description: "The update failed. Try again.", variant: "destructive" });
    },
  });

  const parsedSnapshots = useMemo(() => {
    if (!snapshotsQuery.data) return [];
    return snapshotsQuery.data.map(parseSnapshot);
  }, [snapshotsQuery.data]);

  const activeSnapshot = useMemo(() => {
    if (selectedSnapshotId !== null) {
      return parsedSnapshots.find(s => s.id === selectedSnapshotId) || parsedSnapshots[0] || null;
    }
    return parsedSnapshots[0] || null;
  }, [parsedSnapshots, selectedSnapshotId]);

  const handleWatchTrend = useCallback((trend: TrendItem) => {
    const existing = (watchlistQuery.data || []).find(w => w.trendName.toLowerCase() === trend.name.toLowerCase());
    if (existing) {
      removeFromWatchlistMutation.mutate(existing.id);
    } else {
      addToWatchlistMutation.mutate({
        trendName: trend.name,
        category: trend.category,
        firstSeenSnapshotId: activeSnapshot?.id,
      });
    }
  }, [watchlistQuery.data, activeSnapshot, addToWatchlistMutation, removeFromWatchlistMutation]);

  const filteredTrends = useMemo(() => {
    if (!activeSnapshot) return [];
    if (categoryFilter === "all") return activeSnapshot.trends;
    return activeSnapshot.trends.filter(t => t.category === categoryFilter);
  }, [activeSnapshot, categoryFilter]);

  const availableCategories = useMemo(() => {
    if (!activeSnapshot) return [];
    return Array.from(new Set(activeSnapshot.trends.map(t => t.category))).sort();
  }, [activeSnapshot]);

  const generateSnapshotMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/trends/generate-snapshot", {
        model: selectedModel,
        days: parseInt(snapshotDays),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/snapshots"] });
      toast({
        title: "Trend snapshot generated",
        description: `Analyzed ${data.articleCount} articles from the last ${data.days} days.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Snapshot generation failed",
        description: err.message || "Could not generate trend snapshot.",
        variant: "destructive",
      });
    },
  });

  const deleteSnapshotMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/trends/snapshots/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/snapshots"] });
      setSelectedSnapshotId(null);
      toast({ title: "Snapshot deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analyze-trends", { model: selectedModel });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends"] });
      const count = data?.articleIds?.length || 0;
      toast({ title: "Trend analysis generated", description: `Analyzed ${count.toLocaleString()} articles.` });
    },
    onError: () => {
      toast({ title: "Analysis failed", description: "Could not generate trend analysis.", variant: "destructive" });
    },
  });

  const deleteTrendMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/trends/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends"] });
      toast({ title: "Report deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const saveViewMutation = useMutation({
    mutationFn: async (name: string) => {
      const config: DashboardConfig = { dateRange, category, selectedCompetitors, selectedTopics: [] };
      const res = await apiRequest("POST", "/api/dashboard-views", {
        name,
        config: JSON.stringify(config),
        isDefault: false,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-views"] });
      setSaveDialogOpen(false);
      toast({ title: "View saved" });
    },
    onError: () => {
      toast({ title: "Failed to save view", variant: "destructive" });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/dashboard-views/${id}`);
      return id;
    },
    onSuccess: (id: number) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-views"] });
      setActiveViewId(prev => (prev === id ? null : prev));
      toast({ title: "View deleted" });
    },
    onError: () => {
      toast({ title: "Couldn't delete view", description: "The delete failed. Try again.", variant: "destructive" });
    },
  });

  const loadView = useCallback((view: DashboardView) => {
    try {
      const config: DashboardConfig = JSON.parse(view.config);
      if (config.dateRange) setDateRange(config.dateRange);
      if (config.category) setCategory(config.category);
      if (config.selectedCompetitors) setSelectedCompetitors(config.selectedCompetitors);
      setActiveViewId(view.id);
      toast({ title: `Loaded "${view.name}"` });
    } catch {
      toast({ title: "Failed to load view config", variant: "destructive" });
    }
  }, [toast]);

  const handleToggleCompetitor = useCallback((comp: string) => {
    setSelectedCompetitors((prev) =>
      prev.includes(comp) ? prev.filter((c) => c !== comp) : [...prev, comp]
    );
  }, []);

  const categories = categoriesQuery.data || [];
  const views = viewsQuery.data || [];
  const trends = trendsQuery.data || [];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-trends-title">
              <TrendingUp className="h-5 w-5 text-primary" />
              Trends & Analytics
            </h1>
            <p className="text-xs text-muted-foreground">
              AI-powered trend snapshots and competitive intelligence
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "dashboard" | "briefs" | "watchlist")}
        >
          <TabsList>
            <TabsTrigger value="dashboard" data-testid="button-tab-dashboard">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="briefs" data-testid="button-tab-briefs">
              <FileText className="h-4 w-4 mr-1.5" />
              AI Reports ({trends.length})
            </TabsTrigger>
            <TabsTrigger value="watchlist" data-testid="button-tab-watchlist">
              <Bookmark className="h-4 w-4 mr-1.5" />
              Watchlist {(watchlistQuery.data?.length || 0) > 0 ? `(${watchlistQuery.data?.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === "watchlist" ? (
          <WatchlistTab
            watchlist={watchlistQuery.data || []}
            isLoading={watchlistQuery.isLoading}
            onRemove={(id) => removeFromWatchlistMutation.mutate(id)}
            onUpdate={(id, data) => updateWatchlistMutation.mutate({ id, data })}
          />
        ) : activeTab === "dashboard" ? (
          <div className="space-y-4 max-w-5xl mx-auto">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Generate Trend Snapshot</span>
                  <Select value={snapshotDays} onValueChange={setSnapshotDays}>
                    <SelectTrigger className="w-28" data-testid="select-snapshot-days">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_RANGES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => generateSnapshotMutation.mutate()}
                    disabled={generateSnapshotMutation.isPending}
                    size="sm"
                    data-testid="button-generate-snapshot"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1.5 ${generateSnapshotMutation.isPending ? "animate-spin" : ""}`} />
                    {generateSnapshotMutation.isPending ? "Analyzing..." : "Generate"}
                  </Button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {availableCategories.length > 0 && (
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-48" data-testid="select-trend-category">
                        <SelectValue placeholder="Filter by category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {availableCategories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </Card>

            {generateSnapshotMutation.isPending && (
              <Card className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <RefreshCw className="h-8 w-8 text-primary animate-spin mb-3" />
                  <h3 className="text-sm font-semibold mb-1">Analyzing articles...</h3>
                  <p className="text-xs text-muted-foreground">
                    This may take 30-60 seconds depending on the number of articles.
                  </p>
                </div>
              </Card>
            )}

            {!generateSnapshotMutation.isPending && activeSnapshot && (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTrendsExpanded(prev => !prev)}
                      aria-label={trendsExpanded ? "Collapse market trends" : "Expand market trends"}
                      data-testid="button-collapse-trends"
                    >
                      {trendsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <Target className="h-4 w-4 text-primary" />
                      Market Trends
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {activeSnapshot.articleCount} articles / {activeSnapshot.days}d
                    </Badge>
                    {activeSnapshot.model && MODEL_DISPLAY[activeSnapshot.model] && (
                      <span className={`text-[10px] font-medium ${MODEL_DISPLAY[activeSnapshot.model].color}`}>
                        {MODEL_DISPLAY[activeSnapshot.model].label}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimestamp(activeSnapshot.createdAt)}
                    </span>
                  </div>
                  {trendsExpanded && (
                    <div className="flex items-center gap-1">
                      {parsedSnapshots.length > 1 && (
                        <Select
                          value={selectedSnapshotId?.toString() || activeSnapshot.id.toString()}
                          onValueChange={(val) => setSelectedSnapshotId(parseInt(val))}
                        >
                          <SelectTrigger className="w-64" data-testid="select-snapshot-history">
                            <History className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                            <SelectValue placeholder="History" />
                          </SelectTrigger>
                          <SelectContent>
                            {parsedSnapshots.map((snap) => (
                              <SelectItem key={snap.id} value={snap.id.toString()}>
                                <span className="text-xs">{formatSnapshotLabel(snap)}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <ConfirmDestructive
                        title={`Delete snapshot from ${formatTimestamp(activeSnapshot.createdAt)}?`}
                        description="This trend snapshot — its trends, emerging signals, and company sentiment — is permanently deleted, and watched trends lose this point in their history. This can't be undone."
                        onConfirm={() => deleteSnapshotMutation.mutate(activeSnapshot.id)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Delete snapshot"
                          data-testid="button-delete-snapshot"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </ConfirmDestructive>
                    </div>
                  )}
                </div>

                {trendsExpanded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredTrends.map((trend, i) => (
                      <TrendCard
                        key={i}
                        trend={trend}
                        onDrillDown={() => setDrilldownTrend(trend)}
                        isWatched={watchedNames.has(trend.name.toLowerCase())}
                        onWatch={handleWatchTrend}
                        model={selectedModel}
                      />
                    ))}
                  </div>
                )}

                {activeSnapshot.emergingSignals.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSignalsExpanded(prev => !prev)}
                        aria-label={signalsExpanded ? "Collapse emerging signals" : "Expand emerging signals"}
                        data-testid="button-collapse-signals"
                      >
                        {signalsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-semibold">Emerging Signals</h3>
                      <Badge variant="secondary" className="text-[10px]">Early Detection</Badge>
                    </div>
                    {signalsExpanded && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {activeSnapshot.emergingSignals.map((signal, i) => {
                          const catColor = CATEGORY_COLORS[signal.category] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
                          return (
                            <div key={i} className="rounded-lg border border-border p-3" data-testid={`card-signal-${i}`}>
                              <div className="flex items-start gap-2">
                                <Sparkles className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-xs font-semibold text-foreground leading-tight mb-1">
                                    {signal.name}
                                  </h4>
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    {signal.description}
                                  </p>
                                  <div className="flex items-center justify-between gap-2 mt-1.5">
                                    <Badge className={`text-[10px] px-1 py-0 ${catColor}`}>
                                      {signal.category}
                                    </Badge>
                                    <TrendContentGenerator name={signal.name} description={signal.description} category={signal.category} model={selectedModel} idSuffix={`signal-${i}`} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                )}

                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Company Sentiment</h3>
                    <Badge variant="secondary" className="text-[10px]">Coverage Analysis</Badge>
                  </div>
                  <CompanySentimentChart data={activeSnapshot.companySentiment} />
                </Card>
              </>
            )}

            {!generateSnapshotMutation.isPending && !activeSnapshot && (
              <Card className="p-8">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-base font-semibold mb-1" data-testid="text-no-snapshots">
                    No Trend Snapshots Yet
                  </h2>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    Generate an AI-powered trend snapshot to see meaningful B2B marketing and sales technology trends, company sentiment, and emerging signals.
                  </p>
                  <Button
                    onClick={() => generateSnapshotMutation.mutate()}
                    disabled={generateSnapshotMutation.isPending}
                    data-testid="button-generate-snapshot-empty"
                  >
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    Generate First Snapshot
                  </Button>
                </div>
              </Card>
            )}

            <Card className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold" data-testid="text-competitive-heading">
                    Competitive Intelligence
                  </h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={dateRange} onValueChange={(val) => {
                    setDateRange(val);
                    if (val !== "custom") setCustomDateRange(undefined);
                  }}>
                    <SelectTrigger className="w-28" data-testid="select-date-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...DATE_RANGES, { label: "6 months", value: "180" }, { label: "1 year", value: "365" }].map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                  {dateRange === "custom" && (
                    <DateRangePicker
                      dateRange={customDateRange}
                      onDateRangeChange={(range) => setCustomDateRange(range ? { from: range.from, to: range.to } : undefined)}
                    />
                  )}

                  {views.length > 0 && (
                    <Select
                      value={activeViewId !== null ? activeViewId.toString() : ""}
                      onValueChange={(val) => {
                        const view = views.find((v) => v.id.toString() === val);
                        if (view) loadView(view);
                      }}
                    >
                      <SelectTrigger className="w-36" data-testid="select-saved-view">
                        <Eye className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                        <SelectValue placeholder="Saved Views" />
                      </SelectTrigger>
                      <SelectContent>
                        {views.map((view) => (
                          <SelectItem key={view.id} value={view.id.toString()}>
                            {view.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSaveDialogOpen(true)}
                    data-testid="button-save-view"
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save
                  </Button>

                  {views.length > 0 && (() => {
                    const activeView = views.find((v) => v.id === activeViewId);
                    return (
                      <ConfirmDestructive
                        title={`Delete view "${activeView?.name ?? ""}"?`}
                        description="This saved dashboard view and its filter configuration are permanently deleted. This can't be undone."
                        onConfirm={() => {
                          if (activeView) deleteViewMutation.mutate(activeView.id);
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={!activeView || deleteViewMutation.isPending}
                          aria-label="Delete current view"
                          title={activeView ? `Delete view "${activeView.name}"` : "Select a saved view to delete it"}
                          data-testid="button-delete-view"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </ConfirmDestructive>
                    );
                  })()}
                </div>
              </div>
              {competitiveQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <CompetitiveIntelChart
                  data={competitiveQuery.data || []}
                  selectedCompetitors={selectedCompetitors}
                  onToggleCompetitor={handleToggleCompetitor}
                />
              )}
            </Card>

            <Card className="p-4" data-testid="card-demandbase-intel">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-semibold">Demandbase Intelligence</h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={dateRange} onValueChange={(val) => {
                    setDateRange(val);
                    if (val !== "custom") setCustomDateRange(undefined);
                  }}>
                    <SelectTrigger className="w-28" data-testid="select-db-date-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...DATE_RANGES, { label: "6 months", value: "180" }, { label: "1 year", value: "365" }].map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                  {dateRange === "custom" && (
                    <DateRangePicker
                      dateRange={customDateRange}
                      onDateRangeChange={(range) => setCustomDateRange(range ? { from: range.from, to: range.to } : undefined)}
                    />
                  )}
                </div>
              </div>
              {demandbaseQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <DemandbaseIntelChart
                  data={demandbaseQuery.data || { byDate: [], byCategory: [], total: 0, topArticles: [] }}
                />
              )}
            </Card>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-end mb-3">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                size="sm"
                data-testid="button-generate-trends"
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                {generateMutation.isPending ? "Analyzing..." : "Generate AI Report"}
              </Button>
            </div>
            {trendsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="p-4">
                    <Skeleton className="h-5 w-2/3 mb-3" />
                    <div className="flex gap-2 mb-3 flex-wrap">
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-5 w-24 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-4/5" />
                  </Card>
                ))}
              </div>
            ) : trends.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                  <BookOpen className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-base font-semibold mb-1" data-testid="text-no-trends">
                  No AI Trend Reports Yet
                </h2>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  Click "Generate AI Report" to have AI review your news articles and produce a detailed analysis report.
                </p>
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  data-testid="button-generate-trends-empty"
                >
                  <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                  {generateMutation.isPending ? "Analyzing..." : "Generate First Report"}
                </Button>
              </div>
            ) : (
              <OldTrendsSection
                trends={trends}
                onDelete={(id) => deleteTrendMutation.mutate(id)}
              />
            )}
          </div>
        )}
      </div>

      {drilldownTrend && (
        <ArticleDrilldownDialog
          open={!!drilldownTrend}
          onClose={() => setDrilldownTrend(null)}
          articleIds={drilldownTrend.articleIds}
          trendName={drilldownTrend.name}
        />
      )}

      <SaveViewDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={(name) => saveViewMutation.mutate(name)}
        currentConfig={{ dateRange, category, selectedCompetitors, selectedTopics: [] }}
      />
    </div>
  );
}
