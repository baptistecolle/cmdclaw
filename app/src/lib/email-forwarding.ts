export const EMAIL_FORWARDED_TRIGGER_TYPE = "email.forwarded";

const USER_ALIAS_PREFIX = "u_";
const DEFAULT_LOCAL_PART = "bot";

const ANIMALS = [
  "beaver",
  "falcon",
  "otter",
  "lynx",
  "panda",
  "badger",
  "heron",
  "fox",
  "wolf",
  "tiger",
  "koala",
  "raven",
  "walrus",
  "bison",
  "yak",
  "zebra",
] as const;

const ADJECTIVES = [
  "brisk",
  "bold",
  "bright",
  "clever",
  "steady",
  "swift",
  "calm",
  "strong",
  "sturdy",
  "quiet",
  "sharp",
  "solar",
  "lunar",
  "crisp",
  "noble",
  "eager",
] as const;

const COLORS = [
  "orange",
  "blue",
  "green",
  "red",
  "gold",
  "teal",
  "amber",
  "gray",
  "black",
  "white",
  "silver",
  "navy",
  "coral",
  "indigo",
  "olive",
  "scarlet",
] as const;

export type ForwardingTarget =
  | { kind: "workflow_alias"; localPart: string }
  | { kind: "user"; id: string };

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
  aliasLocalPart: string,
  domain: string,
  localPart = DEFAULT_LOCAL_PART,
): string {
  const normalizedDomain = normalizeDomain(domain);
  return `${localPart}+${aliasLocalPart}@${normalizedDomain}`;
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
  const hasPlus = localPart.includes("+");
  const token = hasPlus ? (localPart.split("+").pop() ?? "") : localPart;
  const normalizedToken = token.trim().toLowerCase();

  if (!hasPlus && normalizedToken === DEFAULT_LOCAL_PART) {
    return null;
  }

  if (normalizedToken.startsWith(USER_ALIAS_PREFIX)) {
    const id = normalizedToken.slice(USER_ALIAS_PREFIX.length).trim();
    if (id.length > 0) {
      return { kind: "user", id };
    }
    return null;
  }

  if (normalizedToken.length > 0) {
    return { kind: "workflow_alias", localPart: normalizedToken };
  }

  return null;
}

function pickWord<T extends readonly string[]>(list: T): string {
  return list[Math.floor(Math.random() * list.length)] ?? "token";
}

export function generateWorkflowAliasLocalPart(): string {
  return `${pickWord(ANIMALS)}-${pickWord(ADJECTIVES)}-${pickWord(COLORS)}`;
}
