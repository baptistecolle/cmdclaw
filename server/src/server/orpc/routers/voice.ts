import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { env } from "@/env";
import OpenAI from "openai";

const transcribeInputSchema = z.object({
  audio: z.string(), // Base64 encoded audio data
  mimeType: z.string().default("audio/webm"),
});

const transcribeOutputSchema = z.object({
  text: z.string(),
});

const transcribe = protectedProcedure
  .input(transcribeInputSchema)
  .output(transcribeOutputSchema)
  .handler(async ({ input }) => {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(input.audio, "base64");

    // Determine file extension from mimeType
    const extension = input.mimeType.includes("webm")
      ? "webm"
      : input.mimeType.includes("mp4")
        ? "mp4"
        : input.mimeType.includes("wav")
          ? "wav"
          : "webm";

    // Create a File object for the OpenAI API
    const file = new File([audioBuffer], `audio.${extension}`, {
      type: input.mimeType,
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "json",
    });

    return {
      text: transcription.text,
    };
  });

export const voiceRouter = {
  transcribe,
};
