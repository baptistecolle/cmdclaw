export const UNIPILE_MISSING_CREDENTIALS_MESSAGE =
  "unipile missing credentials please contact administrator";

function includesMissingCredentials(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("missing_credentials") || normalized.includes("missing credentials");
}

export function isUnipileMissingCredentialsError(error: unknown): boolean {
  if (typeof error === "string") {
    return error === UNIPILE_MISSING_CREDENTIALS_MESSAGE || includesMissingCredentials(error);
  }

  if (error instanceof Error) {
    return (
      error.message === UNIPILE_MISSING_CREDENTIALS_MESSAGE ||
      includesMissingCredentials(error.message)
    );
  }

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return (
        maybeMessage === UNIPILE_MISSING_CREDENTIALS_MESSAGE ||
        includesMissingCredentials(maybeMessage)
      );
    }
  }

  return false;
}
