export function getWorkflowRunStatusLabel(status: string): string {
  switch (status) {
    case "awaiting_approval":
      return "Waiting for user approval";
    case "awaiting_auth":
      return "Waiting for authentication";
    default:
      return status.replaceAll("_", " ");
  }
}
