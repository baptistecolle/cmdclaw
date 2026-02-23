"use client";

import { Loader2, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

type AdminListUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
};

function readImpersonatedBy(sessionData: SessionData | null): string | null {
  if (!sessionData) {
    return null;
  }

  const maybeSession = (sessionData as { session?: { impersonatedBy?: unknown } }).session;
  if (!maybeSession) {
    return null;
  }

  return typeof maybeSession.impersonatedBy === "string" && maybeSession.impersonatedBy.length > 0
    ? maybeSession.impersonatedBy
    : null;
}

export default function AdminImpersonationPage() {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminListUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null);
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);

  const impersonatedBy = useMemo(() => readImpersonatedBy(sessionData), [sessionData]);
  const isCurrentlyImpersonating = Boolean(impersonatedBy);
  const currentUserId = sessionData?.user?.id ?? "";

  const loadSession = useCallback(async () => {
    const sessionResult = await authClient.getSession();
    setSessionData(sessionResult?.data ?? null);
  }, []);

  const loadUsers = useCallback(async (searchValue: string) => {
    setLoadingUsers(true);
    setListError("");

    try {
      const trimmed = searchValue.trim();
      const result = await authClient.admin.listUsers({
        query: {
          searchValue: trimmed.length > 0 ? trimmed : undefined,
          searchField: "email",
          searchOperator: "contains",
          sortBy: "createdAt",
          sortDirection: "desc",
          limit: 20,
        },
      });

      if (result.error) {
        setListError(result.error.message ?? "Failed to load users.");
        setUsers([]);
        return;
      }

      const loaded = (result.data?.users ?? []) as AdminListUser[];
      setUsers(loaded);
    } catch (error) {
      console.error("Failed to load admin users:", error);
      setListError("Failed to load users.");
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
    void loadUsers("");
  }, [loadSession, loadUsers]);

  const handleSearch = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await loadUsers(search);
    },
    [loadUsers, search],
  );

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  }, []);

  const handleImpersonate = useCallback(async (targetUser: AdminListUser) => {
    setActionError("");
    setActionMessage("");
    setImpersonatingUserId(targetUser.id);

    try {
      const result = await authClient.admin.impersonateUser({
        userId: targetUser.id,
      });

      if (result.error) {
        setActionError(result.error.message ?? "Unable to impersonate this user.");
        return;
      }

      setActionMessage(`Now impersonating ${targetUser.email}. Reloading workspace...`);
      window.location.assign("/chat");
    } catch (error) {
      console.error("Failed to impersonate user:", error);
      setActionError("Unable to impersonate this user.");
    } finally {
      setImpersonatingUserId(null);
    }
  }, []);

  const handleImpersonateClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const targetUserId = event.currentTarget.dataset.userId;
      if (!targetUserId) {
        return;
      }
      const targetUser = users.find((candidate) => candidate.id === targetUserId);
      if (!targetUser) {
        setActionError("Selected user was not found.");
        return;
      }
      await handleImpersonate(targetUser);
    },
    [handleImpersonate, users],
  );

  const handleStopImpersonating = useCallback(async () => {
    setActionError("");
    setActionMessage("");
    setStoppingImpersonation(true);

    try {
      const result = await authClient.admin.stopImpersonating();
      if (result.error) {
        setActionError(result.error.message ?? "Failed to stop impersonation.");
        return;
      }

      setActionMessage("Impersonation stopped. You are back on your admin account.");
      window.location.assign("/admin/impersonation");
    } catch (error) {
      console.error("Failed to stop impersonation:", error);
      setActionError("Failed to stop impersonation.");
    } finally {
      setStoppingImpersonation(false);
    }
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">User Impersonation</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Temporarily sign in as a user to reproduce and debug what they are seeing.
        </p>
      </div>

      {isCurrentlyImpersonating && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-amber-900 dark:text-amber-200">
              You are currently impersonating another account.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStopImpersonating}
              disabled={stoppingImpersonation}
            >
              {stoppingImpersonation ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Stopping...
                </>
              ) : (
                "Stop impersonating"
              )}
            </Button>
          </div>
        </div>
      )}

      {(actionError || actionMessage) && (
        <div
          className={cn(
            "mb-4 rounded-lg border p-3 text-sm",
            actionError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
          )}
        >
          {actionError || actionMessage}
        </div>
      )}

      <div className="border-border/60 bg-muted/20 rounded-lg border p-6">
        <form onSubmit={handleSearch} className="mb-4 flex flex-col gap-3 sm:flex-row">
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search users by email"
            className="sm:max-w-sm"
          />
          <Button type="submit" variant="outline" disabled={loadingUsers}>
            {loadingUsers ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              "Search"
            )}
          </Button>
        </form>

        {listError ? <p className="text-destructive mb-3 text-sm">{listError}</p> : null}

        {loadingUsers ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground text-sm">No users found.</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const isWorking = impersonatingUserId === user.id;
              return (
                <div
                  key={user.id}
                  className="bg-background flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{user.name || "Unnamed user"}</p>
                    <p className="text-muted-foreground text-xs">{user.email}</p>
                    {user.role ? (
                      <p className="text-muted-foreground text-xs">Role: {user.role}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    data-user-id={user.id}
                    onClick={handleImpersonateClick}
                    disabled={isSelf || isWorking || isCurrentlyImpersonating}
                    className="sm:min-w-40"
                  >
                    {isWorking ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : isSelf ? (
                      "Current account"
                    ) : (
                      <>
                        <UserRoundCog className="h-4 w-4" />
                        Impersonate
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
