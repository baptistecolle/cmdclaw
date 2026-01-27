"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Plug, Sparkles, Settings, LogOut } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

const navItems = [
  { icon: MessageSquare, label: "Chat", href: "/chat" },
  { icon: Plug, label: "Integrations", href: "/settings/integrations" },
  { icon: Sparkles, label: "Skills", href: "/settings/skills" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionData>(null);

  useEffect(() => {
    let mounted = true;
    authClient
      .getSession()
      .then((res) => {
        if (!mounted) return;
        const hasSession = res?.data?.session && res?.data?.user;
        setSession(hasSession ? res.data : null);
      })
      .catch(() => {
        if (mounted) setSession(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    const { error } = await authClient.signOut();
    if (!error) {
      setSession(null);
      router.push("/login");
    }
  };

  const userEmail = session?.user?.email ?? "";
  const avatarInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "";

  const isActive = (href: string) => {
    if (href === "/chat") {
      return pathname === "/chat" || pathname.startsWith("/chat/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <div className="flex h-screen w-14 flex-col items-center border-r bg-sidebar py-3 shrink-0">
      {/* Logo */}
      <Link
        href="/chat"
        className="mb-4 flex h-9 w-9 items-center justify-center"
      >
        <Image
          src="/logo.png"
          alt="Bap"
          width={28}
          height={28}
          className="object-contain"
        />
      </Link>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer: user avatar + sign out */}
      <div className="flex flex-col items-center gap-1">
        {session?.user && (
          <button
            onClick={handleSignOut}
            title="Log out"
            className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Log out</span>
          </button>
        )}
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
          title={userEmail}
        >
          {avatarInitial}
        </div>
      </div>
    </div>
  );
}
