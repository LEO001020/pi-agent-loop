import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import {
  encodeWav,
  loadSpeechPreferences,
} from "@/lib/localDictation";

export type DictationPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

export function useLocalDictation({
  onTranscript,
  onError,
}: {
  onTranscript: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const phaseRef = useRef<DictationPhase>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(44_100);
  const timeoutRef = useRef<number | null>(null);

  const release = useCallback(() => {
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    if (phaseRef.current !== "recording") return;
    const chunks = chunksRef.current;
    const sampleRate = sampleRateRef.current;
    release();
    if (!chunks.length) {
      phaseRef.current = "idle";
      setPhase("idle");
      onError(new Error("SPEECH_NO_SPEECH"));
      return;
    }
    phaseRef.current = "transcribing";
    setPhase("transcribing");
    try {
      const preferences = loadSpeechPreferences();
      const result = await api.speechTranscribe({
        audioBase64: encodeWav(chunks, sampleRate),
        engine: preferences.engine,
        language: preferences.language,
      });
      onTranscript(result.text);
    } catch (error) {
      onError(error);
    } finally {
      chunksRef.current = [];
      phaseRef.current = "idle";
      setPhase("idle");
    }
  }, [onError, onTranscript, release]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    phaseRef.current = "requesting";
    setPhase("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("SPEECH_MIC_UNAVAILABLE");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      sampleRateRef.current = context.sampleRate;
      processor.onaudioprocess = (event) => {
        chunksRef.current.push(
          new Float32Array(event.inputBuffer.getChannelData(0)),
        );
      };
      source.connect(processor);
      processor.connect(context.destination);
      streamRef.current = stream;
      contextRef.current = context;
      processorRef.current = processor;
      phaseRef.current = "recording";
      setPhase("recording");
      timeoutRef.current = window.setTimeout(() => {
        void stop();
      }, 60_000);
    } catch (error) {
      release();
      phaseRef.current = "idle";
      setPhase("idle");
      onError(error);
    }
  }, [onError, release, stop]);

  useEffect(() => release, [release]);

  return {
    phase,
    recording: phase === "recording",
    busy: phase !== "idle",
    start,
    stop,
  };
}
