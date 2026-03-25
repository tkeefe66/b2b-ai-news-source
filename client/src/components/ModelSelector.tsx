import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain } from "lucide-react";

interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "text-emerald-600 dark:text-emerald-400",
  gemini: "text-blue-600 dark:text-blue-400",
  anthropic: "text-amber-600 dark:text-amber-400",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Google",
  anthropic: "Anthropic",
};

export function useSelectedModel(storageKey: string, defaultModel = "gpt-4.1-mini") {
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
