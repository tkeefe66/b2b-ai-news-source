import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type VoiceState = "idle" | "recording" | "transcribing";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

// Browser Web Speech API — no API key required.
// Supported in Chrome, Edge, and Safari. Falls back to an error toast in Firefox.
const SpeechRecognitionAPI =
  (typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
  null;

export function VoiceInputButton({ onTranscript, disabled, className }: VoiceInputButtonProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  const handleClick = useCallback(() => {
    if (voiceState === "recording") {
      recognitionRef.current?.stop();
      return;
    }

    if (!SpeechRecognitionAPI) {
      toast({
        title: "Voice input not supported",
        description: "Your browser does not support the Web Speech API. Try Chrome or Edge.",
        variant: "destructive",
      });
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => setVoiceState("recording");

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        onTranscript(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      const msg =
        event.error === "not-allowed"
          ? "Microphone access denied. Allow microphone access in browser settings."
          : event.error === "no-speech"
          ? "No speech detected. Please try again."
          : "Voice recognition error. Please try again.";
      toast({ title: "Voice input failed", description: msg, variant: "destructive" });
    };

    recognition.onend = () => setVoiceState("idle");

    try {
      recognition.start();
    } catch {
      toast({ title: "Could not start voice input", variant: "destructive" });
      setVoiceState("idle");
    }
  }, [voiceState, onTranscript, toast]);

  const isRecording = voiceState === "recording";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={(disabled && !isRecording) || voiceState === "transcribing"}
      className={`h-7 w-7 shrink-0 ${isRecording ? "text-red-500 hover:text-red-600 animate-pulse" : "text-muted-foreground hover:text-foreground"} ${className || ""}`}
      aria-label={isRecording ? "Stop recording" : "Start voice input"}
      data-testid="button-voice-input"
      title={voiceState === "idle" ? "Record voice input" : isRecording ? "Stop recording" : "Processing..."}
    >
      {voiceState === "idle" && <Mic className="h-3.5 w-3.5" />}
      {isRecording && <Square className="h-3.5 w-3.5 fill-current" />}
      {voiceState === "transcribing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    </Button>
  );
}
