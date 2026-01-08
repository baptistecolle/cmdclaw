import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { env } from "@/env";
import { db } from "@/server/db/client";
import { authSchema } from "@/server/db/schema";

const appUrl =
  env.BETTER_AUTH_URL ??
  env.NEXT_PUBLIC_BETTER_AUTH_URL ??
  (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");

export const auth = betterAuth({
  appName: "ViralPilot",
  baseURL: appUrl,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  plugins: [
    nextCookies(),
    magicLink({
      async sendMagicLink({ email, url }) {
        // Print the link in logs for local development.
        console.info(`[better-auth] Magic link for ${email}: ${url}`);
      },
    }),
  ],
});
