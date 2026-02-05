'use client';

import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  deviceAuthorizationClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  magicLinkClient,
} from "better-auth/client/plugins";
import { env } from "@/env";
import type { auth } from "@/lib/auth";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  plugins: [
    inferAdditionalFields<typeof auth>(),
    magicLinkClient(),
    lastLoginMethodClient(),
    deviceAuthorizationClient(),
    adminClient(),
  ],
});
