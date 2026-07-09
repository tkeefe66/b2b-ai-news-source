import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain } from "lucide-react";

interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
}

// Must be a model the server actually serves (see AVAILABLE_MODELS in server/ai-models.ts);
// the server silently falls back to this id when given an unknown model.
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Single source of truth for model badges. Includes legacy ids that still
// exist on old sessions/snapshots in the database.
export const MODEL_DISPLAY: Record<string, { label: string; color: string; badge: string }> = {
  "claude-haiku-4-5-20251001": { label: "Claude Haiku", color: "text-amber-700 dark:text-amber-400", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  "claude-sonnet-4-6": { label: "Claude Sonnet", color: "text-amber-700 dark:text-amber-400", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  "gemini-2.5-flash": { label: "Gemini 2.5 Flash", color: "text-blue-700 dark:text-blue-400", badge: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  "claude-haiku-4-5": { label: "Claude Haiku", color: "text-amber-700 dark:text-amber-400", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  "gpt-4.1-mini": { label: "GPT-4.1 Mini", color: "text-emerald-700 dark:text-emerald-400", badge: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  "gpt-4o": { label: "GPT-4o", color: "text-emerald-700 dark:text-emerald-400", badge: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: "text-emerald-700 dark:text-emerald-400",
  gemini: "text-blue-700 dark:text-blue-400",
  anthropic: "text-amber-700 dark:text-amber-400",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Google",
  anthropic: "Anthropic",
};

export function useSelectedModel(storageKey: string, defaultModel = DEFAULT_MODEL) {
  const [model, setModelState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(storageKey) || defaultModel;
    }
    return defaultModel;
  });

  const setModel = useCallback((newModel: string) => {
    setModelState(newModel);
    localStorage.setItem(storageKey, newModel);
  }, [storageKey]);

  return [model, setModel] as const;
}

export function ModelSelector({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (model: string) => void;
  compact?: boolean;
}) {
  const { data: models } = useQuery<AIModel[]>({
    queryKey: ["/api/models"],
  });

  // Heal stale selections (e.g. a localStorage value for a model the server no
  // longer offers) so the trigger never renders empty.
  useEffect(() => {
    if (models && models.length > 0 && !models.some(m => m.id === value)) {
      onChange(models[0].id);
    }
  }, [models, value, onChange]);

  if (!models) return null;

  if (compact) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="h-7 w-auto min-w-[140px] gap-1 border-muted-foreground/20 bg-muted/50 text-xs"
          data-testid="select-model"
        >
          <Brain className="h-3 w-3 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map(m => (
            <SelectItem key={m.id} value={m.id} data-testid={`select-model-option-${m.id}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium ${PROVIDER_COLORS[m.provider] || ""}`}>
                  {PROVIDER_LABELS[m.provider] || m.provider}
                </span>
                <span className="text-xs">{m.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-8 w-auto min-w-[180px] gap-1.5 text-xs"
        data-testid="select-model"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {models.map(m => (
          <SelectItem key={m.id} value={m.id} data-testid={`select-model-option-${m.id}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium uppercase ${PROVIDER_COLORS[m.provider] || ""}`}>
                {PROVIDER_LABELS[m.provider] || m.provider}
              </span>
              <span>{m.name}</span>
              <span className="text-muted-foreground text-[10px] ml-1">{m.description}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
