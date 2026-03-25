import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
}: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
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
        ...(systemMsg ? { systemInstruction: typeof systemMsg.content === "string" ? systemMsg.content : "" } : {}),
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: "application/json" as const } : {}),
      },
    });
    return resp.text || "";
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
  });
  const textBlock = resp.content.find((b: any) => b.type === "text");
  return (textBlock as any)?.text || "";
}

export async function* chatStream({
  model,
  messages,
  maxTokens = 8192,
}: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
}): AsyncGenerator<string> {
  const provider = getProvider(model);

  if (provider === "gemini") {
    const systemMsg = messages.find(m => m.role === "system");
    const chatMsgs = messages.filter(m => m.role !== "system");
    const contents = chatMsgs.map(m => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));

    const stream = await gemini.models.generateContentStream({
      model,
      contents,
      config: {
        ...(systemMsg ? { systemInstruction: typeof systemMsg.content === "string" ? systemMsg.content : "" } : {}),
        maxOutputTokens: maxTokens,
      },
    });
    for await (const chunk of stream) {
      const content = chunk.text || "";
      if (content) yield content;
    }
    return;
  }

  // Default: anthropic
  const systemMsg = messages.find(m => m.role === "system");
  const chatMsgs = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role as "user" | "assistant",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  const stream = anthropic.messages.stream({
    model,
    messages: chatMsgs,
    max_tokens: maxTokens,
    ...(systemMsg ? { system: typeof systemMsg.content === "string" ? systemMsg.content : "" } : {}),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && (event.delta as any).type === "text_delta") {
      yield (event.delta as any).text;
    }
  }
}
