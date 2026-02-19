import { fal } from "@fal-ai/client";
import { z } from "zod";
import { env } from "@/env";
import { protectedProcedure } from "../middleware";

const transcribeInputSchema = z.object({
  audio: z.string(), // Base64 encoded audio data
  mimeType: z.string().default("audio/webm"),
});

const transcribeOutputSchema = z.object({
  text: z.string(),
});

interface WizperResult {
  text: string;
  chunks: Array<{ text: string }>;
}

interface DeepgramResult {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

type TranscriptionProvider = "nova-3" | "fal";

// Keep both providers available, default to Deepgram nova-3 for now.
const TRANSCRIPTION_PROVIDER: TranscriptionProvider = "nova-3";

function getFileExtension(mimeType: string): string {
  return mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("wav")
        ? "wav"
        : mimeType.includes("mp3")
          ? "mp3"
          : "webm";
}

async function transcribeWithFal(input: z.infer<typeof transcribeInputSchema>): Promise<string> {
  if (!env.FAL_KEY) {
    throw new Error("FAL_KEY is not configured");
  }

  fal.config({
    credentials: env.FAL_KEY,
  });

  const audioBuffer = Buffer.from(input.audio, "base64");
  const audioBlob = new Blob([audioBuffer], { type: input.mimeType });
  const extension = getFileExtension(input.mimeType);

  const audioFile = new File([audioBlob], `audio.${extension}`, {
    type: input.mimeType,
  });

  const audioUrl = await fal.storage.upload(audioFile);

  const response = await fetch("https://fal.run/fal-ai/wizper", {
    method: "POST",
    headers: {
      Authorization: `Key ${env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      task: "transcribe",
      language: null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Wizper request failed with status ${response.status}`);
  }

  const result = (await response.json()) as WizperResult;
  return result.text ?? "";
}

async function transcribeWithNova3(input: z.infer<typeof transcribeInputSchema>): Promise<string> {
  if (!env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const audioBuffer = Buffer.from(input.audio, "base64");
  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&detect_language=true&smart_format=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        "Content-Type": input.mimeType,
      },
      body: audioBuffer,
    },
  );

  if (!response.ok) {
    throw new Error(`Deepgram request failed with status ${response.status}`);
  }

  const result = (await response.json()) as DeepgramResult;
  return result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

const transcribe = protectedProcedure
  .input(transcribeInputSchema)
  .output(transcribeOutputSchema)
  .handler(async ({ input }) => {
    const text =
      TRANSCRIPTION_PROVIDER === "nova-3"
        ? await transcribeWithNova3(input)
        : await transcribeWithFal(input);

    return {
      text,
    };
  });

export const voiceRouter = {
  transcribe,
};
