import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer, magicLink } from "better-auth/plugins";
import { Resend } from "resend";

import { env } from "@/env";
import { db } from "@/server/db/client";
import { authSchema } from "@/server/db/schema";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

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
  trustedOrigins: [
    "https://appleid.apple.com",
    "https://heybap.com",
    "https://www.heybap.com",
    "http://localhost:3000",
    "https://localcan.baptistecolle.com",
    "bap://",
  ],
  plugins: [
    nextCookies(),
    bearer(),
    magicLink({
      async sendMagicLink({ email, url }) {
        console.log(`[auth] Sending magic link to ${email}`);
        if (resend && env.EMAIL_FROM) {
          await resend.emails.send({
            from: `Bap <${env.EMAIL_FROM}>`,
            to: email,
            subject: `Sign in to Bap | ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
            html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 480px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 48px 40px; text-align: center;">
              <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600; color: #18181b;">Sign in to Bap</h1>
              <p style="margin: 0 0 32px 0; font-size: 15px; color: #71717a; line-height: 1.5;">Click the button below to securely sign in to your account.</p>
              <a href="${url}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 500; border-radius: 8px;">Sign in</a>
              <p style="margin: 32px 0 0 0; font-size: 13px; color: #a1a1aa; line-height: 1.5;">If you didn't request this email, you can safely ignore it.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #e4e4e7; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">This link will expire in 10 minutes.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
            `,
          });
        } else {
          console.info(`[better-auth] Magic link for ${email}: ${url}`);
        }
      },
    }),
  ],
});
