import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

/**
 * Generate a short title for a conversation using Claude Haiku.
 */
export async function generateConversationTitle(
  userMessage: string,
  assistantMessage: string
): Promise<string | null> {
  try {
    if (!env.ANTHROPIC_API_KEY) {
      console.warn("[Title] No ANTHROPIC_API_KEY, skipping title generation");
      return null;
    }

    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const prompt = [
      "Generate a short title (3-6 words) for this conversation. Return ONLY the title, no quotes or punctuation.",
      "",
      "User: " + userMessage.slice(0, 500),
      "",
      "Assistant: " + assistantMessage.slice(0, 500),
    ].join("\n");

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 30,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock && textBlock.type === "text") {
      return textBlock.text.trim();
    }

    return null;
  } catch (error) {
    console.error("[Title] Error generating title:", error);
    return null;
  }
}
