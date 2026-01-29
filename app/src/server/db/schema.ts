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
  unique,
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
  onboardedAt: timestamp("onboarded_at"),
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
  workflows: many(workflow),
  providerAuths: many(providerAuth),
  devices: many(device),
  customIntegrations: many(customIntegration),
  customIntegrationCredentials: many(customIntegrationCredential),
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
  "awaiting_auth",
  "paused",
  "complete",
  "error",
]);

export const generationRecordStatusEnum = pgEnum("generation_record_status", [
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "completed",
  "cancelled",
  "error",
]);

export const conversationTypeEnum = pgEnum("conversation_type", [
  "chat",
  "workflow",
]);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    type: conversationTypeEnum("type").default("chat").notNull(),
    title: text("title").default("New conversation"),
    // OpenCode session ID for resuming conversations
    opencodeSessionId: text("opencode_session_id"),
    model: text("model").default("claude-sonnet-4-20250514"),
    // Generation tracking
    generationStatus: generationStatusEnum("generation_status").default("idle").notNull(),
    currentGenerationId: text("current_generation_id"),
    // Auto-approve sensitive operations without user confirmation
    autoApprove: boolean("auto_approve").default(false).notNull(),
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
    // OpenCode message ID for checkpointing
    opencodeMessageId: text("opencode_message_id"),
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

// Auth state stored in generation
export type PendingAuth = {
  integrations: string[];  // Integration types needed
  connectedIntegrations: string[];  // Already connected during this request
  requestedAt: string;
  reason?: string;
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
    // Auth state
    pendingAuth: jsonb("pending_auth").$type<PendingAuth>(),
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

// ========== INTEGRATION TYPE ENUM ==========
// Defined early because workflow schema depends on it

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
  "salesforce",
  "reddit",
  "twitter",
]);

// ========== WORKFLOW SCHEMA ==========

export const workflowStatusEnum = pgEnum("workflow_status", ["on", "off"]);

export const workflowRunStatusEnum = pgEnum("workflow_run_status", [
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "completed",
  "error",
  "cancelled",
]);

export const workflow = pgTable(
  "workflow",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: workflowStatusEnum("status").default("off").notNull(),
    triggerType: text("trigger_type").notNull(),
    prompt: text("prompt").notNull(),
    promptDo: text("prompt_do"),
    promptDont: text("prompt_dont"),
    allowedIntegrations: integrationTypeEnum("allowed_integrations").array().notNull(),
    allowedCustomIntegrations: text("allowed_custom_integrations").array().notNull().default([]),
    // Schedule configuration for time-based triggers (JSON object)
    schedule: jsonb("schedule"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workflow_owner_id_idx").on(table.ownerId),
    index("workflow_status_idx").on(table.status),
  ]
);

export const workflowRun = pgTable(
  "workflow_run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    status: workflowRunStatusEnum("status").default("running").notNull(),
    triggerPayload: jsonb("trigger_payload").notNull(),
    generationId: text("generation_id").references(() => generation.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("workflow_run_workflow_id_idx").on(table.workflowId),
    index("workflow_run_status_idx").on(table.status),
    index("workflow_run_started_at_idx").on(table.startedAt),
  ]
);

export const workflowRunEvent = pgTable(
  "workflow_run_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRun.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_run_event_run_id_idx").on(table.workflowRunId),
  ]
);

// ========== INTEGRATION SCHEMA ==========

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

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  owner: one(user, { fields: [workflow.ownerId], references: [user.id] }),
  runs: many(workflowRun),
}));

export const workflowRunRelations = relations(workflowRun, ({ one, many }) => ({
  workflow: one(workflow, {
    fields: [workflowRun.workflowId],
    references: [workflow.id],
  }),
  generation: one(generation, {
    fields: [workflowRun.generationId],
    references: [generation.id],
  }),
  events: many(workflowRunEvent),
}));

export const workflowRunEventRelations = relations(workflowRunEvent, ({ one }) => ({
  run: one(workflowRun, {
    fields: [workflowRunEvent.workflowRunId],
    references: [workflowRun.id],
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

// ========== PROVIDER AUTH SCHEMA ==========
// Stores encrypted OAuth tokens for subscription providers (ChatGPT, Gemini)

export const providerAuth = pgTable(
  "provider_auth",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "openai" | "google"
    accessToken: text("access_token").notNull(), // encrypted
    refreshToken: text("refresh_token").notNull(), // encrypted
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("provider_auth_user_provider_idx").on(table.userId, table.provider),
    index("provider_auth_user_id_idx").on(table.userId),
  ]
);

export const providerAuthRelations = relations(providerAuth, ({ one }) => ({
  user: one(user, {
    fields: [providerAuth.userId],
    references: [user.id],
  }),
}));

// ========== DEVICE CODE (Better Auth plugin) ==========

export const deviceCode = pgTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id"),
    scope: text("scope"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastPolledAt: timestamp("last_polled_at"),
    pollingInterval: integer("polling_interval"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

// ========== DEVICE (BYOC) SCHEMA ==========

export const device = pgTable(
  "device",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    isOnline: boolean("is_online").default(false).notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    capabilities: jsonb("capabilities").$type<{
      sandbox: boolean;
      llmProxy: boolean;
      localModels?: string[];
      platform: string;
      arch: string;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("device_user_id_idx").on(table.userId),
  ]
);

export const deviceRelations = relations(device, ({ one }) => ({
  user: one(user, { fields: [device.userId], references: [user.id] }),
}));

// ─── Custom Integrations ─────────────────────────────────────

export const customIntegration = pgTable(
  "custom_integration",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    iconUrl: text("icon_url"),
    baseUrl: text("base_url").notNull(),
    authType: text("auth_type").notNull(), // oauth2, api_key, bearer_token
    oauthConfig: jsonb("oauth_config").$type<{
      authUrl: string;
      tokenUrl: string;
      scopes: string[];
      pkce?: boolean;
      authStyle?: "header" | "params";
      extraAuthParams?: Record<string, string>;
    }>(),
    apiKeyConfig: jsonb("api_key_config").$type<{
      method: "header" | "query";
      headerName?: string;
      queryParam?: string;
    }>(),
    cliCode: text("cli_code").notNull(),
    cliInstructions: text("cli_instructions").notNull(),
    permissions: jsonb("permissions").$type<{
      readOps: string[];
      writeOps: string[];
    }>().notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    communityPrUrl: text("community_pr_url"),
    communityStatus: text("community_status"), // pending, approved, rejected
    isBuiltIn: boolean("is_built_in").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_integration_slug_idx").on(table.slug),
    index("custom_integration_created_by_idx").on(table.createdByUserId),
  ]
);

export const customIntegrationCredential = pgTable(
  "custom_integration_credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customIntegrationId: text("custom_integration_id")
      .notNull()
      .references(() => customIntegration.id, { onDelete: "cascade" }),
    clientId: text("client_id"),
    clientSecret: text("client_secret"),
    apiKey: text("api_key"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    enabled: boolean("enabled").default(true).notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_cred_user_id_idx").on(table.userId),
    index("custom_cred_integration_id_idx").on(table.customIntegrationId),
    unique("custom_cred_user_integration_idx").on(table.userId, table.customIntegrationId),
  ]
);

export const customIntegrationRelations = relations(customIntegration, ({ one, many }) => ({
  createdBy: one(user, { fields: [customIntegration.createdByUserId], references: [user.id] }),
  credentials: many(customIntegrationCredential),
}));

export const customIntegrationCredentialRelations = relations(customIntegrationCredential, ({ one }) => ({
  user: one(user, { fields: [customIntegrationCredential.userId], references: [user.id] }),
  customIntegration: one(customIntegration, {
    fields: [customIntegrationCredential.customIntegrationId],
    references: [customIntegration.id],
  }),
}));

// ─── Slack Bot ───────────────────────────────────────────────

export const slackUserLink = pgTable(
  "slack_user_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slackTeamId: text("slack_team_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("slack_user_link_team_user_idx").on(
      table.slackTeamId,
      table.slackUserId
    ),
    index("slack_user_link_user_id_idx").on(table.userId),
  ]
);

export const slackUserLinkRelations = relations(slackUserLink, ({ one }) => ({
  user: one(user, {
    fields: [slackUserLink.userId],
    references: [user.id],
  }),
}));

export const slackConversation = pgTable(
  "slack_conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("slack_conversation_thread_idx").on(
      table.teamId,
      table.channelId,
      table.threadTs
    ),
    index("slack_conversation_conversation_id_idx").on(table.conversationId),
  ]
);

export const slackConversationRelations = relations(
  slackConversation,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [slackConversation.conversationId],
      references: [conversation.id],
    }),
    user: one(user, {
      fields: [slackConversation.userId],
      references: [user.id],
    }),
  })
);

// Aggregated schema used by better-auth's drizzle adapter.
export const authSchema = {
  user,
  session,
  account,
  verification,
  deviceCode,
};
