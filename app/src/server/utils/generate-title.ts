import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/env";

/**
 * Generate a short title for a conversation using Gemini Flash.
 */
export async function generateConversationTitle(
  userMessage: string,
  assistantMessage: string,
): Promise<string | null> {
  try {
    if (!env.GEMINI_API_KEY) {
      console.warn("[Title] No GEMINI_API_KEY, skipping title generation");
      return null;
    }

    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const prompt = [
      "Generate a short title (3-6 words) for this conversation. Return ONLY the title, no quotes or punctuation.",
      "",
      "User: " + userMessage.slice(0, 500),
      "",
      "Assistant: " + assistantMessage.slice(0, 500),
    ].join("\n");

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    if (text) {
      return text.trim();
    }

    return null;
  } catch (error) {
    console.error("[Title] Error generating title:", error);
    return null;
  }
}
