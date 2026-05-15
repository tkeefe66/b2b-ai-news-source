import express, { type Express, type Request, type Response } from "express";
import { chatStorage } from "../chat/storage";
import { speechToText, ensureCompatibleFormat } from "./client";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Body parser with 50MB limit for audio payloads
const audioBodyParser = express.json({ limit: "50mb" });

export function registerAudioRoutes(app: Express): void {
  // Get all conversations
  app.get("/api/conversations", async (req: Request, res: Response) => {
    try {
      const conversations = await chatStorage.getAllConversations();
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const conversation = await chatStorage.getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation
  app.post("/api/conversations", async (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(title || "New Chat");
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await chatStorage.deleteConversation(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  /**
   * Send voice message and get streaming text response.
   * Audio is transcribed via ensureCompatibleFormat + speechToText (browser STT fallback).
   * Text response is streamed via Claude Haiku.
   *
   * TODO: Wire up a dedicated STT provider (Google Cloud Speech-to-Text, AssemblyAI, etc.)
   * to replace browser-side transcription for server-initiated voice conversations.
   */
  app.post("/api/conversations/:id/messages", audioBodyParser, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { audio, transcript: providedTranscript } = req.body;

      let userTranscript = providedTranscript;

      // If audio is provided but no transcript, attempt server-side transcription
      if (audio && !userTranscript) {
        try {
          const rawBuffer = Buffer.from(audio, "base64");
          const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);
          userTranscript = await speechToText(audioBuffer, inputFormat);
        } catch (sttErr: any) {
          return res.status(501).json({
            error: "Server-side transcription is not configured.",
            message: "Send a 'transcript' field instead, or use the browser Web Speech API.",
          });
        }
      }

      if (!userTranscript) {
        return res.status(400).json({ error: "Either 'audio' or 'transcript' is required" });
      }

      // Save user message
      await chatStorage.createMessage(conversationId, "user", userTranscript);

      // Get conversation history
      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory = existingMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Stream text response from Claude
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(`data: ${JSON.stringify({ type: "user_transcript", data: userTranscript })}\n\n`);

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        messages: chatHistory,
        max_tokens: 4096,
      });

      let assistantTranscript = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          assistantTranscript += text;
          res.write(`data: ${JSON.stringify({ type: "transcript", data: text })}\n\n`);
        }
      }

      // Save assistant message
      await chatStorage.createMessage(conversationId, "assistant", assistantTranscript);

      res.write(`data: ${JSON.stringify({ type: "done", transcript: assistantTranscript })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error processing voice message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process voice message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process voice message" });
      }
    }
  });
}
