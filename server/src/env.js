import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    RESEND_API_KEY:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    EMAIL_FROM:
      process.env.NODE_ENV === "production"
        ? z.string().email()
        : z.string().email().optional(),
    REDIS_URL: z.string().url().optional(),
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.string().default("6379"),
    OPENAI_API_KEY:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    POSTHOG_API_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().optional(),
    VERCEL_URL: z.string().optional(),
    // App URL for OAuth redirects
    APP_URL: z.string().url().optional(),
    // Anthropic
    ANTHROPIC_API_KEY: z.string().optional(),
    // E2B Sandbox
    E2B_API_KEY: z.string().optional(),
    E2B_TEMPLATE: z.string().optional(),
    // OAuth credentials
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    NOTION_CLIENT_ID: z.string().optional(),
    NOTION_CLIENT_SECRET: z.string().optional(),
    LINEAR_CLIENT_ID: z.string().optional(),
    LINEAR_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    AIRTABLE_CLIENT_ID: z.string().optional(),
    AIRTABLE_CLIENT_SECRET: z.string().optional(),
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
    HUBSPOT_CLIENT_ID: z.string().optional(),
    HUBSPOT_CLIENT_SECRET: z.string().optional(),
    // Apple Sign In
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_CLIENT_SECRET: z.string().optional(),
    APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional(),
    // Fal.ai
    FAL_KEY: z.string().optional(),
    // S3/MinIO Configuration
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_NAME: z.string().default("bap-documents"),
    S3_FORCE_PATH_STYLE: z.string().transform(v => v === "true").default("true"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_BETTER_AUTH_URL: z.string().url(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
    NEXT_PUBLIC_NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    VERCEL_URL: process.env.VERCEL_URL,
    APP_URL: process.env.APP_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    E2B_API_KEY: process.env.E2B_API_KEY,
    E2B_TEMPLATE: process.env.E2B_TEMPLATE,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
    NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET,
    LINEAR_CLIENT_ID: process.env.LINEAR_CLIENT_ID,
    LINEAR_CLIENT_SECRET: process.env.LINEAR_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    AIRTABLE_CLIENT_ID: process.env.AIRTABLE_CLIENT_ID,
    AIRTABLE_CLIENT_SECRET: process.env.AIRTABLE_CLIENT_SECRET,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    HUBSPOT_CLIENT_ID: process.env.HUBSPOT_CLIENT_ID,
    HUBSPOT_CLIENT_SECRET: process.env.HUBSPOT_CLIENT_SECRET,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,
    APPLE_APP_BUNDLE_IDENTIFIER: process.env.APPLE_APP_BUNDLE_IDENTIFIER,
    FAL_KEY: process.env.FAL_KEY,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_NODE_ENV:
      process.env.NEXT_PUBLIC_NODE_ENV ?? process.env.NODE_ENV,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
