import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  jsonb,
  integer,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  conversations: many(conversation),
  integrations: many(integration),
  skills: many(skill),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// ========== CHAT SCHEMA ==========

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

export const generationStatusEnum = pgEnum("generation_status", [
  "idle",
  "generating",
  "awaiting_approval",
  "paused",
  "complete",
  "error",
]);

export const generationRecordStatusEnum = pgEnum("generation_record_status", [
  "running",
  "awaiting_approval",
  "paused",
  "completed",
  "cancelled",
  "error",
]);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    title: text("title").default("New conversation"),
    // Claude SDK session ID for resuming conversations
    claudeSessionId: text("claude_session_id"),
    model: text("model").default("claude-sonnet-4-20250514"),
    // Generation tracking
    generationStatus: generationStatusEnum("generation_status").default("idle").notNull(),
    currentGenerationId: text("current_generation_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("conversation_user_id_idx").on(table.userId),
    index("conversation_created_at_idx").on(table.createdAt),
  ]
);

// Content part types for interleaved message structure
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; integration?: string; operation?: string }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | { type: "thinking"; id: string; content: string };

export const message = pgTable(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    // Interleaved content parts (text/tool_use/tool_result)
    contentParts: jsonb("content_parts").$type<ContentPart[]>(),
    // Token usage for cost tracking
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Parent message for threading tool responses
    parentMessageId: text("parent_message_id"),
    // Claude SDK message UUID for checkpointing
    claudeMessageUuid: text("claude_message_uuid"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("message_conversation_id_idx").on(table.conversationId),
    index("message_created_at_idx").on(table.createdAt),
  ]
);

// Approval state stored in generation
export type PendingApproval = {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestedAt: string;
};

export const generation = pgTable(
  "generation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    // Set when message is saved on completion
    messageId: text("message_id").references(() => message.id, { onDelete: "set null" }),
    status: generationRecordStatusEnum("status").default("running").notNull(),
    // Partial content (updated periodically during generation)
    contentParts: jsonb("content_parts").$type<ContentPart[]>(),
    // Approval state
    pendingApproval: jsonb("pending_approval").$type<PendingApproval>(),
    // E2B state
    sandboxId: text("sandbox_id"),
    isPaused: boolean("is_paused").default(false).notNull(),
    // Metadata
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("generation_conversation_id_idx").on(table.conversationId),
    index("generation_status_idx").on(table.status),
  ]
);

// ========== INTEGRATION SCHEMA ==========

export const integrationTypeEnum = pgEnum("integration_type", [
  "gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
]);

export const integration = pgTable(
  "integration",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: integrationTypeEnum("type").notNull(),
    // OAuth account identifier from the provider
    providerAccountId: text("provider_account_id"),
    // Display name (e.g., email address, workspace name)
    displayName: text("display_name"),
    enabled: boolean("enabled").default(true).notNull(),
    // Scopes granted by user
    scopes: text("scopes").array(),
    // Provider-specific metadata (e.g., workspace ID for Notion)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("integration_user_id_idx").on(table.userId),
    index("integration_type_idx").on(table.type),
    uniqueIndex("integration_user_type_idx").on(table.userId, table.type),
  ]
);

export const integrationToken = pgTable(
  "integration_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integration.id, { onDelete: "cascade" }),
    // Tokens (should encrypt in production)
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenType: text("token_type").default("Bearer"),
    expiresAt: timestamp("expires_at"),
    // ID token for OIDC providers
    idToken: text("id_token"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("integration_token_integration_id_idx").on(table.integrationId)]
);

// ========== RELATIONS ==========

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  user: one(user, { fields: [conversation.userId], references: [user.id] }),
  messages: many(message),
  generations: many(generation),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  parentMessage: one(message, {
    fields: [message.parentMessageId],
    references: [message.id],
    relationName: "parentMessage",
  }),
}));

export const generationRelations = relations(generation, ({ one }) => ({
  conversation: one(conversation, {
    fields: [generation.conversationId],
    references: [conversation.id],
  }),
  message: one(message, {
    fields: [generation.messageId],
    references: [message.id],
  }),
}));

export const integrationRelations = relations(integration, ({ one, many }) => ({
  user: one(user, { fields: [integration.userId], references: [user.id] }),
  tokens: many(integrationToken),
}));

export const integrationTokenRelations = relations(integrationToken, ({ one }) => ({
  integration: one(integration, {
    fields: [integrationToken.integrationId],
    references: [integration.id],
  }),
}));

// ========== SKILL SCHEMA ==========

export const skill = pgTable(
  "skill",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Skill slug (lowercase, numbers, hyphens only)
    name: text("name").notNull(),
    // Human-readable display name
    displayName: text("display_name").notNull(),
    // Description from SKILL.md frontmatter
    description: text("description").notNull(),
    // Icon: emoji (e.g., "🚀") or Lucide icon name (e.g., "lucide:rocket")
    icon: text("icon"),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("skill_user_id_idx").on(table.userId),
  ]
);

export const skillFile = pgTable(
  "skill_file",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    // File path within skill directory (e.g., "SKILL.md", "reference.md", "scripts/helper.py")
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("skill_file_skill_id_idx").on(table.skillId),
  ]
);

export const skillDocument = pgTable(
  "skill_document",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    // Original filename uploaded by user
    filename: text("filename").notNull(),
    // MIME type (e.g., "application/pdf", "image/png")
    mimeType: text("mime_type").notNull(),
    // File size in bytes
    sizeBytes: integer("size_bytes").notNull(),
    // S3/MinIO object key (path in bucket)
    storageKey: text("storage_key").notNull(),
    // Optional description/notes about the document
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("skill_document_skill_id_idx").on(table.skillId)]
);

export const skillRelations = relations(skill, ({ one, many }) => ({
  user: one(user, { fields: [skill.userId], references: [user.id] }),
  files: many(skillFile),
  documents: many(skillDocument),
}));

export const skillFileRelations = relations(skillFile, ({ one }) => ({
  skill: one(skill, {
    fields: [skillFile.skillId],
    references: [skill.id],
  }),
}));

export const skillDocumentRelations = relations(skillDocument, ({ one }) => ({
  skill: one(skill, {
    fields: [skillDocument.skillId],
    references: [skill.id],
  }),
}));

// Aggregated schema used by better-auth's drizzle adapter.
export const authSchema = {
  user,
  session,
  account,
  verification,
};
