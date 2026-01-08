import Link from "next/link";

import { TrpcStatus } from "@/components/trpc-status";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="text-sm text-muted-foreground">
          Use the sidebar to open Accounts, Upload, or Admin. The tRPC link
          below shows an example round trip to the API handler.
        </p>
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Try the login flow</Link>
          </Button>
        </div>
      </div>

      <TrpcStatus />
    </div>
  );
}
