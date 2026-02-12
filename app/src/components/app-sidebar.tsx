"use client";

import {
  MessageSquare,
  Plug,
  Sparkles,
  Settings,
  Shield,
  LogOut,
  Workflow,
  Flag,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/animate-ui/components/radix/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionData>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportAttachment, setReportAttachment] = useState<File | null>(null);
  const [reportError, setReportError] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    authClient
      .getSession()
      .then((res) => {
        if (!mounted) {
          return;
        }
        const hasSession = res?.data?.session && res?.data?.user;
        setSession(hasSession ? res.data : null);
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    if (!error) {
      setSession(null);
      router.push("/login");
    }
  }, [router]);

  const userEmail = session?.user?.email ?? "";
  const avatarInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "";
  const isAdmin = session?.user?.role === "admin";
  const navItems = [
    { icon: MessageSquare, label: "Chat", href: "/chat" },
    { icon: Workflow, label: "Workflows", href: "/workflows" },
    { icon: Plug, label: "Integrations", href: "/integrations" },
    { icon: Sparkles, label: "Skills", href: "/skills" },
    { icon: Settings, label: "Settings", href: "/settings" },
  ];

  const isActive = (href: string) => {
    if (href === "/chat") {
      return pathname === "/chat" || pathname.startsWith("/chat/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  const handleSubmitReport = useCallback(async () => {
    const message = reportMessage.trim();
    if (!message) {
      setReportError("Please enter a message.");
      return;
    }

    setIsSubmittingReport(true);
    setReportError("");

    try {
      const formData = new FormData();
      formData.append("message", message);
      if (reportAttachment) {
        formData.append("attachment", reportAttachment);
      }

      const response = await fetch("/api/report", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setReportError(data?.error ?? "Failed to send report.");
        return;
      }

      setReportMessage("");
      setReportAttachment(null);
      setReportOpen(false);
    } catch {
      setReportError("Failed to send report.");
    } finally {
      setIsSubmittingReport(false);
    }
  }, [reportAttachment, reportMessage]);

  const handleReportMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setReportMessage(e.target.value);
      if (reportError) {
        setReportError("");
      }
    },
    [reportError],
  );

  const handleAttachmentChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setReportAttachment(file);
  }, []);

  const openAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const clearAttachment = useCallback(() => {
    setReportAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }, []);

  const closeReportSheet = useCallback(() => {
    setReportOpen(false);
  }, []);

  const openReportSheet = useCallback(() => {
    setReportOpen(true);
  }, []);

  return (
    <>
      <Sheet open={reportOpen} onOpenChange={setReportOpen}>
        <SheetContent
          side="right"
          title="Report an issue"
          description="Send a message to Slack"
          className="w-[420px] p-0"
        >
          <SheetHeader>
            <SheetTitle>Report an issue</SheetTitle>
            <SheetDescription>
              This sends your message to the Slack report channel.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 px-4 pb-2">
            <textarea
              value={reportMessage}
              onChange={handleReportMessageChange}
              placeholder="Describe the issue..."
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[160px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
            <input
              ref={attachmentInputRef}
              type="file"
              className="hidden"
              onChange={handleAttachmentChange}
            />
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="outline" onClick={openAttachmentPicker}>
                Add attachment
              </Button>
              {reportAttachment && (
                <>
                  <span className="max-w-[180px] truncate text-xs text-muted-foreground">
                    {reportAttachment.name}
                  </span>
                  <Button type="button" variant="ghost" onClick={clearAttachment}>
                    Remove
                  </Button>
                </>
              )}
            </div>
            {reportError && <p className="mt-2 text-xs text-destructive">{reportError}</p>}
          </div>
          <SheetFooter className="border-t">
            <Button variant="outline" onClick={closeReportSheet} disabled={isSubmittingReport}>
              Cancel
            </Button>
            <Button onClick={handleSubmitReport} disabled={isSubmittingReport}>
              {isSubmittingReport ? "Sending..." : "Send"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="flex h-screen w-14 flex-col items-center border-r bg-sidebar py-3 shrink-0">
        {/* Logo */}
        <Link
          href="/chat"
          prefetch={false}
          className="mb-4 flex h-9 w-9 items-center justify-center"
        >
          <Image src="/logo.png" alt="Bap" width={28} height={28} className="object-contain" />
        </Link>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    prefetch={false}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="sr-only">{item.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openReportSheet}
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-9 w-9 items-center justify-center rounded-md transition-colors"
              >
                <Flag className="h-4 w-4" />
                <span className="sr-only">Report</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Report</TooltipContent>
          </Tooltip>

          {isAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/admin"
                  prefetch={false}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    isActive("/admin")
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Shield className="h-4 w-4" />
                  <span className="sr-only">Admin</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Admin</TooltipContent>
            </Tooltip>
          )}
        </nav>

        {/* Footer: user avatar with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground hover:ring-2 hover:ring-sidebar-accent-foreground/20 transition-all"
              title={userEmail}
            >
              {avatarInitial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="min-w-48">
            {userEmail && (
              <>
                <DropdownMenuLabel className="font-normal">
                  <span className="text-xs text-muted-foreground">{userEmail}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href="/settings" prefetch={false} className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
            {session?.user ? (
              <DropdownMenuItem
                onClick={handleSignOut}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem asChild>
                <Link href="/login" prefetch={false} className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  <span>Log in</span>
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
