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
    // Store tool calls and results as JSONB
    toolCalls: jsonb("tool_calls").$type<
      {
        id: string;
        name: string;
        input: Record<string, unknown>;
        result?: unknown;
      }[]
    >(),
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

// ========== INTEGRATION SCHEMA ==========

export const integrationTypeEnum = pgEnum("integration_type", [
  "gmail",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
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

// Aggregated schema used by better-auth's drizzle adapter.
export const authSchema = {
  user,
  session,
  account,
  verification,
};
