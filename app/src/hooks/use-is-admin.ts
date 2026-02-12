"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authClient.getSession().then((session) => {
      setIsAdmin(session?.data?.user?.role === "admin");
      setIsLoading(false);
    });
  }, []);

  return { isAdmin, isLoading };
}
