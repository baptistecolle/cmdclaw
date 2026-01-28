'use client';

import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient, lastLoginMethodClient, magicLinkClient } from "better-auth/client/plugins";
import { env } from "@/env";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  plugins: [magicLinkClient(), lastLoginMethodClient(), deviceAuthorizationClient()],
});
