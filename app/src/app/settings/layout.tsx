"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Plug, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";

const navItems = [
  { href: "/settings", label: "General", icon: Settings },
  { href: "/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/settings/skills", label: "Skills", icon: Wand2 },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <AppShell>
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container flex h-14 items-center gap-4 px-4">
            <h1 className="text-lg font-semibold">Settings</h1>
          </div>
        </header>

        {/* Mobile horizontal tabs */}
        <nav className="border-b md:hidden">
          <div className="container flex gap-1 overflow-x-auto px-4 py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/settings"
                  ? pathname === "/settings"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-muted font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="container px-4 py-6">
          <div className="flex gap-8">
            {/* Desktop sidebar - hidden on mobile */}
            <nav className="hidden w-48 shrink-0 md:block">
              <ul className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === "/settings"
                      ? pathname === "/settings"
                      : pathname.startsWith(item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-muted font-medium"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <main className="flex-1">{children}</main>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
