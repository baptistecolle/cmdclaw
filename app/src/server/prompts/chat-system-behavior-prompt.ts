const CHAT_SYSTEM_BEHAVIOR_PROMPT = "";

export function getChatSystemBehaviorPrompt(): string | null {
  if (!CHAT_SYSTEM_BEHAVIOR_PROMPT) {
    return null;
  }

  return CHAT_SYSTEM_BEHAVIOR_PROMPT;
}
