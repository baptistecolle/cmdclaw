import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/env";

export type WorkflowNameContext = {
  agentDescription: string;
  triggerType: string;
  allowedIntegrations: string[];
  allowedCustomIntegrations: string[];
  schedule: unknown;
  autoApprove: boolean;
  promptDo?: string | null;
  promptDont?: string | null;
};

function normalizeWorkflowName(text: string): string | null {
  const firstLine = text.split("\n")[0] ?? "";
  const cleaned = firstLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.:;!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  return cleaned.slice(0, 128);
}

export async function generateWorkflowName(context: WorkflowNameContext): Promise<string | null> {
  try {
    if (!env.GEMINI_API_KEY) {
      console.warn("[WorkflowName] No GEMINI_API_KEY, skipping workflow name generation");
      return null;
    }

    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const workflowContextJson = JSON.stringify(
      {
        triggerType: context.triggerType,
        allowedIntegrations: context.allowedIntegrations,
        allowedCustomIntegrations: context.allowedCustomIntegrations,
        schedule: context.schedule,
        autoApprove: context.autoApprove,
        promptDo: context.promptDo ?? null,
        promptDont: context.promptDont ?? null,
      },
      null,
      2,
    );

    const prompt = [
      "Generate a concise workflow name (3-7 words).",
      "Return ONLY the name text, no quotes, markdown, numbering, or explanation.",
      "",
      "Agent description:",
      context.agentDescription.slice(0, 4000),
      "",
      "Workflow context JSON:",
      workflowContextJson,
    ].join("\n");

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text) return null;
    return normalizeWorkflowName(text);
  } catch (error) {
    console.error("[WorkflowName] Error generating workflow name:", error);
    return null;
  }
}
