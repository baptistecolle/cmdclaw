"use client";

import { Loader2 } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-is-admin";

type AdminComingSoonPageProps = {
  title: string;
  description: string;
};

export function AdminComingSoonPage({ title, description }: AdminComingSoonPageProps) {
  const { isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
        You do not have access to this section.
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2 text-sm">{description}</p>
      <div className="bg-muted/30 mt-4 rounded-md border p-4 text-sm">Coming soon</div>
    </div>
  );
}
