import { ORPCError } from "@orpc/server";

// Allowed MIME types for skill documents
export const ALLOWED_MIME_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Maximum file size: 10MB
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Maximum files per skill
export const MAX_DOCUMENTS_PER_SKILL = 20;

export function validateFileUpload(
  filename: string,
  mimeType: string,
  sizeBytes: number,
  currentDocumentCount: number,
): void {
  // Check file size
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File size exceeds maximum of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
    });
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File type "${mimeType}" is not allowed. Supported types: PDF, Word, Excel, images, and text files.`,
    });
  }

  // Check document count limit
  if (currentDocumentCount >= MAX_DOCUMENTS_PER_SKILL) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Maximum of ${MAX_DOCUMENTS_PER_SKILL} documents per skill`,
    });
  }

  // Validate filename
  if (!filename || filename.length > 256) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Filename is required and must be under 256 characters",
    });
  }
}
