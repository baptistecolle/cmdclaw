"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { cn } from "@/lib/utils";

const adminTabs = [
  { label: "Settings", href: "/admin" },
  { label: "WhatsApp", href: "/admin/whatsapp" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, isLoading } = useIsAdmin();

  return (
    <AppShell>
      <div className="min-h-full bg-background">
        <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-8 md:px-6 md:pt-10">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !isAdmin ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              You do not have access to this section.
            </div>
          ) : (
            <>
              <nav className="sticky top-0 z-10 mb-6 flex gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                {adminTabs.map((tab) => {
                  const isActive =
                    tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      className={cn(
                        "border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
                        isActive
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </nav>
              {children}
            </>
          )}
        </main>
      </div>
    </AppShell>
  );
}
