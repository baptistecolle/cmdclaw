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

const getAuthClientBaseURL = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return env.NEXT_PUBLIC_APP_URL;
};

export const authClient = createAuthClient({
  baseURL: getAuthClientBaseURL(),
  plugins: [
    inferAdditionalFields<typeof auth>(),
    magicLinkClient(),
    lastLoginMethodClient(),
    deviceAuthorizationClient(),
    adminClient(),
  ],
});
