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
  appName: "Bap",
  baseURL: appUrl,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID as string,
      clientSecret: env.APPLE_CLIENT_SECRET as string,
      appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
    },
  },
  trustedOrigins: ["https://appleid.apple.com"],
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
