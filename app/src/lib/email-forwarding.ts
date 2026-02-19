export const EMAIL_FORWARDED_TRIGGER_TYPE = "email.forwarded";

const WORKFLOW_ALIAS_PREFIX = "wf_";
const USER_ALIAS_PREFIX = "u_";
const DEFAULT_LOCAL_PART = "bot";

export type ForwardingTarget = { kind: "workflow"; id: string } | { kind: "user"; id: string };

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export function extractEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim().toLowerCase();
  }

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch?.[0]) {
    return null;
  }

  return emailMatch[0].trim().toLowerCase();
}

export function buildWorkflowForwardingAddress(
  workflowId: string,
  domain: string,
  localPart = DEFAULT_LOCAL_PART,
): string {
  const normalizedDomain = normalizeDomain(domain);
  return `${localPart}+${WORKFLOW_ALIAS_PREFIX}${workflowId}@${normalizedDomain}`;
}

export function buildUserForwardingAddress(
  userId: string,
  domain: string,
  localPart = DEFAULT_LOCAL_PART,
): string {
  const normalizedDomain = normalizeDomain(domain);
  return `${localPart}+${USER_ALIAS_PREFIX}${userId}@${normalizedDomain}`;
}

export function parseForwardingTargetFromEmail(
  email: string,
  domain: string,
): ForwardingTarget | null {
  const normalizedDomain = normalizeDomain(domain);
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0) {
    return null;
  }

  const emailDomain = email.slice(atIndex + 1).toLowerCase();
  if (emailDomain !== normalizedDomain) {
    return null;
  }

  const localPart = email.slice(0, atIndex);
  const token = localPart.includes("+") ? (localPart.split("+").pop() ?? "") : localPart;

  if (token.startsWith(WORKFLOW_ALIAS_PREFIX)) {
    const id = token.slice(WORKFLOW_ALIAS_PREFIX.length).trim();
    if (id.length > 0) {
      return { kind: "workflow", id };
    }
    return null;
  }

  if (token.startsWith(USER_ALIAS_PREFIX)) {
    const id = token.slice(USER_ALIAS_PREFIX.length).trim();
    if (id.length > 0) {
      return { kind: "user", id };
    }
  }

  return null;
}
