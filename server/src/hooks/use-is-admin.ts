"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

const ADMIN_EMAILS = [
  "collebaptiste@gmail.com",
  // Any email ending with @heybap.com
];

function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  if (ADMIN_EMAILS.includes(email)) return true;
  if (email.endsWith("@heybap.com")) return true;
  return false;
}

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authClient.getSession().then((session) => {
      setIsAdmin(isAdminEmail(session?.data?.user?.email));
      setIsLoading(false);
    });
  }, []);

  return { isAdmin, isLoading };
}
