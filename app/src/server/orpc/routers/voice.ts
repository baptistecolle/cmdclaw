import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { env } from "@/env";
import { fal } from "@fal-ai/client";

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

const transcribe = protectedProcedure
  .input(transcribeInputSchema)
  .output(transcribeOutputSchema)
  .handler(async ({ input }) => {
    if (!env.FAL_KEY) {
      throw new Error("FAL_KEY is not configured");
    }

    fal.config({
      credentials: env.FAL_KEY,
    });

    // Convert base64 to Buffer then to Blob
    const audioBuffer = Buffer.from(input.audio, "base64");
    const audioBlob = new Blob([audioBuffer], { type: input.mimeType });

    // Determine file extension from mimeType
    const extension = input.mimeType.includes("webm")
      ? "webm"
      : input.mimeType.includes("mp4")
        ? "mp4"
        : input.mimeType.includes("wav")
          ? "wav"
          : input.mimeType.includes("mp3")
            ? "mp3"
            : "webm";

    // Create a File object for upload
    const audioFile = new File([audioBlob], `audio.${extension}`, {
      type: input.mimeType,
    });

    // Upload to fal.ai storage
    const audioUrl = await fal.storage.upload(audioFile);

    // Call Wizper API
    const result = await fal.subscribe("fal-ai/wizper", {
      input: {
        audio_url: audioUrl,
        task: "transcribe",
      },
    });

    return {
      text: (result.data as WizperResult).text,
    };
  });

export const voiceRouter = {
  transcribe,
};
