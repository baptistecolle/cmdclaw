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
    EMAIL_SERVER_HOST:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    EMAIL_SERVER_PORT:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    EMAIL_SERVER_USER:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    EMAIL_SERVER_PASSWORD:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    EMAIL_FROM:
      process.env.NODE_ENV === "production"
        ? z.string().email()
        : z.string().email().optional(),
    MINIO_ENDPOINT: z.string(),
    MINIO_ROOT_USER: z.string(),
    MINIO_ROOT_PASSWORD: z.string(),
    MINIO_USE_SSL: z.string().transform((val) => val === "true"),
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
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_BETTER_AUTH_URL: z.string().url().optional(),
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
    EMAIL_SERVER_HOST: process.env.EMAIL_SERVER_HOST,
    EMAIL_SERVER_PORT: process.env.EMAIL_SERVER_PORT,
    EMAIL_SERVER_USER: process.env.EMAIL_SERVER_USER,
    EMAIL_SERVER_PASSWORD: process.env.EMAIL_SERVER_PASSWORD,
    EMAIL_FROM: process.env.EMAIL_FROM,
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
    MINIO_ROOT_USER: process.env.MINIO_ROOT_USER,
    MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD,
    MINIO_USE_SSL: process.env.MINIO_USE_SSL,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    VERCEL_URL: process.env.VERCEL_URL,
    APP_URL: process.env.APP_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
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
