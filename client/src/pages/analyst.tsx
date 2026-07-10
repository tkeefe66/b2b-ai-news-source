import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Send, Trash2, Sparkles, Plus, Clock, ChevronDown, ChevronRight, Check, MessageSquare, X, Edit2 } from "lucide-react";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getTimeAgo } from "@/lib/time";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import type { ChatMessage, ChatSession } from "@shared/schema";


function MessageBubble({ message, isStreaming }: { message: { role: string; content: string }; isStreaming?: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`chat-message-${message.role}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
        {isUser ? (
          <span className="text-xs font-medium">You</span>
        ) : (
          <Brain className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className={`max-w-[80%] rounded-lg px-4 py-3 ${isUser ? "bg-primary text-primary-foreground" : "bg-muted/50 border border-border"}`}>
        {isUser ? (
          <p className="text-sm leading-relaxed">{message.content}</p>
        ) : (
          <div>
            <MarkdownRenderer content={message.content} />
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function SessionCard({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (id: number) => void;
}) {
  const date = new Date(session.updatedAt);
  const modelInfo = session.model ? MODEL_DISPLAY[session.model] : null;

  return (
    <Card
      className={`overflow-hidden cursor-pointer transition-colors ${isActive ? "border-primary shadow-sm bg-primary/5" : "border-border hover:bg-muted/20"}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      data-testid={`card-chat-session-${session.id}`}
    >
      <div className="flex items-center gap-3 p-3">
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate" data-testid={`text-session-title-${session.id}`}>
            {session.title}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {getTimeAgo(date)}
            </span>
            {modelInfo && (
              <span className={`text-[10px] font-medium ${modelInfo.color}`} data-testid={`text-session-model-${session.id}`}>
                {modelInfo.label}
              </span>
            )}
          </div>
        </div>
        <ConfirmDestructive
          title={`Delete "${session.title}"?`}
          description="This permanently deletes the chat session and all of its messages. This can't be undone."
          onConfirm={() => onDelete(session.id)}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            aria-label={`Delete session "${session.title}"`}
            data-testid={`button-delete-session-${session.id}`}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </ConfirmDestructive>
      </div>
    </Card>
  );
}

const SUGGESTED_PROMPTS = [
  "What are the biggest MarTech trends right now?",
  "How is AI changing B2B sales?",
  "What's happening in the CRM space?",
  "Summarize the latest news about marketing automation",
  "What are competitors doing in revenue intelligence?",
];

export default function Analyst() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-analyst");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [chatTitle, setChatTitle] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionsQuery = useQuery<ChatSession[]>({
    queryKey: ["/api/chat/sessions"],
  });

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/messages", activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return [];
      const res = await fetch(`/api/chat/messages?sessionId=${activeSessionId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!activeSessionId,
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat/sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      if (activeSessionId) {
        setActiveSessionId(null);
        setChatTitle("");
      }
    },
    onError: () => {
      toast({ title: "Couldn't delete session", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const messages = messagesQuery.data || [];
  const sessions = sessionsQuery.data || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const startNewChat = () => {
    setActiveSessionId(null);
    setChatTitle("");
    setStreamingContent("");
    setIsStreaming(false);
    setShowHistory(false);
    setInput("");
    queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", null] });
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMessage = text.trim();
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    let currentSessionId = activeSessionId;

    if (!currentSessionId) {
      try {
        const sessionTitle = userMessage.length > 60 ? userMessage.substring(0, 60) + "..." : userMessage;
        const res = await apiRequest("POST", "/api/chat/sessions", { title: sessionTitle, model: selectedModel });
        const session = await res.json();
        currentSessionId = session.id;
        setActiveSessionId(session.id);
        setChatTitle(sessionTitle);
        queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      } catch (err) {
        toast({ title: "Failed to create chat session", variant: "destructive" });
        setIsStreaming(false);
        return;
      }
    }

    queryClient.setQueryData<ChatMessage[]>(["/api/chat/messages", currentSessionId], (old) => [
      ...(old || []),
      { id: Date.now(), sessionId: currentSessionId, role: "user", content: userMessage, createdAt: new Date() } as ChatMessage,
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, sessionId: currentSessionId, model: selectedModel }),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Chat request failed");

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
                toast({ title: "Stream error", description: parsed.error, variant: "destructive" });
                break;
              }
              if (parsed.content) {
                accumulated += parsed.content;
                setStreamingContent(accumulated);
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
                setStreamingContent(accumulated);
              }
            } catch {}
          }
        }
      }

      setStreamingContent("");
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", currentSessionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
    } catch (err) {
      setIsStreaming(false);
      setStreamingContent("");
      toast({ title: "Failed to get response", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", currentSessionId] });
    }
  };

  const handleSaveDone = async () => {
    if (activeSessionId && chatTitle.trim()) {
      try {
        await apiRequest("PATCH", `/api/chat/sessions/${activeSessionId}`, { title: chatTitle.trim() });
        queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      } catch (err) {
        console.error("Failed to update session title", err);
        toast({ title: "Couldn't save chat title", description: "The server didn't respond. Try again.", variant: "destructive" });
        return;
      }
    }
    startNewChat();
    toast({ title: "Chat saved", description: "You can find it in your chat history." });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const loadSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    setChatTitle(session.title);
    setShowHistory(false);
    setStreamingContent("");
    setIsStreaming(false);
  };

  const showWelcome = !activeSessionId && messages.length === 0 && !isStreaming && !showHistory;
  const isInChat = activeSessionId !== null && !showHistory;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary shrink-0" />
              <h1 className="text-lg font-semibold leading-tight" data-testid="text-analyst-title">AI Analyst</h1>
            </div>
            {isInChat && activeSessionId ? (
              <div className="flex items-center gap-1.5 mt-1 ml-7">
                {isEditingTitle ? (
                  <input
                    type="text"
                    value={chatTitle}
                    onChange={(e) => setChatTitle(e.target.value)}
                    onBlur={() => setIsEditingTitle(false)}
                    onKeyDown={(e) => { if (e.key === "Enter") setIsEditingTitle(false); }}
                    className="text-xs bg-transparent border-b border-primary outline-none text-foreground w-full max-w-[200px]"
                    autoFocus
                    aria-label="Chat title"
                    data-testid="input-chat-title"
                  />
                ) : (
                  <button
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 truncate"
                    onClick={() => setIsEditingTitle(true)}
                    aria-label="Edit chat title"
                    data-testid="button-edit-title"
                  >
                    {chatTitle || "Untitled Chat"}
                    <Edit2 className="h-2.5 w-2.5 shrink-0" />
                  </button>
                )}
              </div>
            ) : !showHistory ? (
              <p className="text-[11px] text-muted-foreground mt-0.5 ml-7 leading-tight hidden sm:block">
                MarTech trends powered by your news knowledge base
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isInChat && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDone}
                  disabled={isStreaming}
                  className="h-7 text-[11px] px-2"
                  data-testid="button-save-done"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Done
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={startNewChat}
                  disabled={isStreaming}
                  className="h-7 text-[11px] px-2"
                  aria-label="New chat"
                  data-testid="button-new-chat"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button
              variant={showHistory ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="h-7 text-[11px] px-2"
              aria-label={showHistory ? "Hide chat history" : "Show chat history"}
              title={showHistory ? "Hide chat history" : "Show chat history"}
              data-testid="button-toggle-history"
            >
              <Clock className="h-3.5 w-3.5 mr-1" />
              {sessions.length > 0 && (
                <span>{sessions.length}</span>
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
              <h2 className="text-sm font-semibold text-foreground" data-testid="text-history-heading">Saved Chats</h2>
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
            {sessionsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No saved chats yet</p>
                <p className="text-xs text-muted-foreground mt-1">Start a conversation and it will appear here</p>
              </div>
            ) : (
              sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isActive={activeSessionId === session.id}
                  onSelect={() => loadSession(session)}
                  onDelete={(id) => deleteSessionMutation.mutate(id)}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          {messagesQuery.isLoading && activeSessionId ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`flex gap-3 ${i % 2 === 0 ? "flex-row-reverse" : ""}`}>
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <Skeleton className={`h-16 rounded-lg ${i % 2 === 0 ? "w-1/3" : "w-2/3"}`} />
                </div>
              ))}
            </div>
          ) : showWelcome ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Brain className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-base font-semibold mb-1" data-testid="text-welcome">MarTech AI Analyst</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                I have access to your entire news knowledge base. Ask me about trends, technologies, market shifts, or get analysis on any B2B MarTech topic.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg mb-6">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="text-xs h-auto py-2 px-3"
                    onClick={() => sendMessage(prompt)}
                    data-testid={`button-prompt-${i}`}
                  >
                    <Sparkles className="h-3 w-3 mr-1.5 text-primary shrink-0" />
                    {prompt}
                  </Button>
                ))}
              </div>
              {sessions.length > 0 && (
                <div className="w-full max-w-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground font-medium">Recent Chats</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-2">
                    {sessions.slice(0, 3).map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        isActive={false}
                        onSelect={() => loadSession(session)}
                        onDelete={(id) => deleteSessionMutation.mutate(id)}
                      />
                    ))}
                    {sessions.length > 3 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground"
                        onClick={() => setShowHistory(true)}
                        data-testid="button-view-all-history"
                      >
                        View all {sessions.length} chats
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isStreaming && streamingContent && (
                <div aria-live="polite">
                  <MessageBubble
                    message={{ role: "assistant", content: streamingContent }}
                    isStreaming
                  />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      )}

      {!showHistory && (
        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <div className="relative flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about MarTech trends, sales technology, AI in marketing..."
                className="resize-none min-h-[44px] max-h-[120px] pr-9"
                rows={1}
                disabled={isStreaming}
                aria-label="Chat message"
                data-testid="input-chat"
              />
              <VoiceInputButton
                onTranscript={(text) => setInput((prev) => prev ? prev + " " + text : text)}
                disabled={isStreaming}
                className="absolute right-1 top-1"
              />
            </div>
            <Button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isStreaming}
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
              aria-label="Send message"
              data-testid="button-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
