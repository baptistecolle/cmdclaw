'use client';

import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { env } from "@/env";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  plugins: [magicLinkClient()],
});
