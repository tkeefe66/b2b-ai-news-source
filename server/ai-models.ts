import { assertCompletion } from "./model-output";
import { acquireAiPermit } from "./ai-budget";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { report } from "./usage.js";

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } },
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000, maxRetries: 0,
});

export const AVAILABLE_MODELS = [
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic", description: "Fast and efficient" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", description: "Nuanced creative writing" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", description: "Fast creative generation" },
];

export type ChatMessageContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
export type ChatMessage = { role: "system" | "user" | "assistant"; content: ChatMessageContent };

function getProvider(model: string): "gemini" | "anthropic" {
  if (model.startsWith("gemini-")) return "gemini";
  return "anthropic";
}

export function resolveModel(model?: string): string {
  if (!model) return "claude-haiku-4-5-20251001";
  const found = AVAILABLE_MODELS.find(m => m.id === model);
  return found ? found.id : "claude-haiku-4-5-20251001";
}

export async function chatCompletion({
  model,
  messages,
  maxTokens = 8192,
  jsonMode = false,
  timeoutMs = 120_000,
}: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error("AI request timeout must be between 1 and 300000 milliseconds.");
  }
  model = resolveModel(model);
  const release = await acquireAiPermit(messages, maxTokens);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
  const provider = getProvider(model);

  if (provider === "gemini") {
    const systemMsg = messages.find(m => m.role === "system");
    const chatMsgs = messages.filter(m => m.role !== "system");
    const contents = chatMsgs.map(m => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));

    const resp = await gemini.models.generateContent({
      model,
      contents,
      config: {
        abortSignal: controller.signal,
        httpOptions: { timeout: timeoutMs },
        ...(systemMsg ? { systemInstruction: typeof systemMsg.content === "string" ? systemMsg.content : "" } : {}),
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: "application/json" as const } : {}),
      },
    });
    assertCompletion(resp.candidates?.[0]?.finishReason);
    if (!resp.text?.trim()) throw new Error("AI returned no content. Please retry.");
    return resp.text;
  }

  // Default: anthropic
  const systemMsg = messages.find(m => m.role === "system");
  const chatMsgs = messages.filter(m => m.role !== "system").map(m => {
    if (typeof m.content === "string") {
      return { role: m.role as "user" | "assistant", content: m.content };
    }
    const parts: any[] = m.content.map((block: any) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "image_url") {
        const url: string = block.image_url.url;
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
        }
        return { type: "image", source: { type: "url", url } };
      }
      return block;
    });
    return { role: m.role as "user" | "assistant", content: parts };
  });

  const systemContent = systemMsg ? (typeof systemMsg.content === "string" ? systemMsg.content : "") : undefined;

  const resp = await anthropic.messages.create({
    model,
    messages: chatMsgs,
    max_tokens: maxTokens,
    ...(systemContent ? { system: systemContent } : {}),
  }, { signal: controller.signal, timeout: timeoutMs });
  assertCompletion(resp.stop_reason);
  report("b2b-ai-news", model, resp.usage);
  const textBlock = resp.content.find((b: any) => b.type === "text");
  if (!(textBlock as any)?.text?.trim()) throw new Error("AI returned no content. Please retry.");
  return (textBlock as any).text;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "APIConnectionTimeoutError")) {
      throw new Error(`AI request timed out after ${timeoutMs / 1000} seconds (${model}). Retry or use a smaller request.`, { cause: error });
    }
    throw error;
  } finally { clearTimeout(deadline); controller.abort(); release(); }
}

export async function createAnthropicMessage(input: Anthropic.MessageCreateParamsNonStreaming) {
  const release = await acquireAiPermit(input, input.max_tokens);
  try {
    const response = await anthropic.messages.create({ ...input, model: resolveModel(input.model) });
    assertCompletion(response.stop_reason);
    return response;
  } finally { release(); }
}
