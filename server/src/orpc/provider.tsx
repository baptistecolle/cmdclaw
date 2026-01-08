"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { type ReactNode, useState, createContext, useContext } from "react";
import { client } from "./client";

// Create the oRPC utils - use any to avoid complex type inference
const orpcUtils: any = createTanstackQueryUtils(client);

// Create a context for the oRPC utils
const ORPCUtilsContext = createContext<any>(orpcUtils);

export function useORPC() {
  return useContext(ORPCUtilsContext);
}

type ORPCProviderProps = {
  children: ReactNode;
};

export function ORPCProvider({ children }: ORPCProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ORPCUtilsContext.Provider value={orpcUtils}>
        {children}
      </ORPCUtilsContext.Provider>
    </QueryClientProvider>
  );
}

// Re-export the client for direct usage
export { client };
