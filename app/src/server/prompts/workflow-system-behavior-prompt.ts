const WORKFLOW_SYSTEM_BEHAVIOR_PROMPT = [
  "Act autonomously and complete the provided task end-to-end.",
  "Do not ask clarifying questions.",
  "If any detail is unclear, make the best informed decision and continue.",
  "Only ask for input when execution is truly impossible without missing information or permissions.",
].join("\n");

export function getWorkflowSystemBehaviorPrompt(): string {
  return WORKFLOW_SYSTEM_BEHAVIOR_PROMPT;
}
