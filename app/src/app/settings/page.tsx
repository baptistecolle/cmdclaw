"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

export default function SettingsPage() {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    authClient
      .getSession()
      .then((res) => {
        setSessionData(res?.data ?? null);
        if (res?.data?.user?.name) {
          const nameParts = res.data.user.name.split(" ");
          setFirstName(nameParts[0] || "");
          setLastName(nameParts.slice(1).join(" ") || "");
        }
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
      await authClient.updateUser({ name: fullName });
      setNotification({ type: "success", message: "Settings saved" });
    } catch (error) {
      console.error("Failed to update user:", error);
      setNotification({ type: "error", message: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const user = sessionData?.user;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error" || !user) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Unable to load your account. Please try again.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">General Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account information.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 flex items-center gap-2 rounded-lg border p-3 text-sm",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          <CheckCircle2 className="h-4 w-4" />
          {notification.message}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Email</label>
            <Input
              type="email"
              value={user.email}
              disabled
              className="bg-muted/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Email cannot be changed.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">First name</label>
              <Input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter your first name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Last name</label>
              <Input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter your last name"
              />
            </div>
          </div>
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </form>
    </div>
  );
}
