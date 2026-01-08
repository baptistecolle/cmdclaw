CREATE TYPE "public"."integration_type" AS ENUM('gmail', 'notion', 'linear', 'github', 'airtable');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"title" text DEFAULT 'New conversation',
	"claude_session_id" text,
	"model" text DEFAULT 'claude-sonnet-4-20250514',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "integration_type" NOT NULL,
	"provider_account_id" text,
	"display_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"scopes" text[],
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_token" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_type" text DEFAULT 'Bearer',
	"expires_at" timestamp,
	"id_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"parent_message_id" text,
	"claude_message_uuid" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_token" ADD CONSTRAINT "integration_token_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_user_id_idx" ON "conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_created_at_idx" ON "conversation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_user_id_idx" ON "integration" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "integration_type_idx" ON "integration" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_user_type_idx" ON "integration" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "integration_token_integration_id_idx" ON "integration_token" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "message_conversation_id_idx" ON "message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_created_at_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");