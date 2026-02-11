"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

const settingsTabs = [
  { label: "General", href: "/settings" },
  { label: "Subscriptions", href: "/settings/subscriptions" },
  { label: "Billing", href: "/settings/billing" },
  { label: "Devices", href: "/settings/devices" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <AppShell>
      <div className="min-h-full bg-background">
        <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-8 md:px-6 md:pt-10">
          <nav className="sticky top-0 z-10 mb-6 flex gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {settingsTabs.map((tab) => {
              const isActive =
                tab.href === "/settings"
                  ? pathname === "/settings"
                  : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  prefetch={false}
                  className={cn(
                    "border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          {children}
        </main>
      </div>
    </AppShell>
  );
}
