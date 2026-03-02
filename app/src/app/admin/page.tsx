"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAddGoogleAccessAllowlistEntry,
  useGoogleAccessAllowlist,
  useRemoveGoogleAccessAllowlistEntry,
} from "@/orpc/hooks";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export default function AdminPage() {
  const { data, isLoading, error } = useGoogleAccessAllowlist();
  const addEntry = useAddGoogleAccessAllowlistEntry();
  const removeEntry = useRemoveGoogleAccessAllowlistEntry();

  const [email, setEmail] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const entries = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const handleEmailChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  }, []);

  const handleAdd = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setActionMessage(null);
      setActionError(null);

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        setActionError("Email is required.");
        return;
      }

      try {
        await addEntry.mutateAsync({ email: normalizedEmail });
        setActionMessage("Google access granted.");
        setEmail("");
      } catch (err) {
        setActionError(toErrorMessage(err, "Failed to grant Google access."));
      }
    },
    [addEntry, email],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setActionMessage(null);
      setActionError(null);
      try {
        await removeEntry.mutateAsync({ id });
        setActionMessage("Google access removed.");
      } catch (err) {
        setActionError(toErrorMessage(err, "Failed to remove Google access."));
      }
    },
    [removeEntry],
  );

  const handleRemoveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.allowlistId;
      if (!id) {
        return;
      }
      void handleRemove(id);
    },
    [handleRemove],
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Admin Settings</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage which users can connect Google integrations.
        </p>
      </div>

      {(actionError || actionMessage) && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            actionError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
          }`}
        >
          {actionError ?? actionMessage}
        </div>
      )}

      <div className="bg-card rounded-lg border p-6">
        <h3 className="text-base font-semibold">Google Access Allowlist</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Users not on this list cannot connect Gmail, Google Calendar, Docs, Sheets, or Drive.
        </p>

        <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="user@company.com"
            value={email}
            onChange={handleEmailChange}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={addEntry.isPending}>
            {addEntry.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              "Add user"
            )}
          </Button>
        </form>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-destructive mt-4 text-sm">Failed to load allowlist.</p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">No users have Google access yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Added At</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-3 py-2">{entry.email}</td>
                    <td className="text-muted-foreground px-3 py-2">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        data-allowlist-id={entry.id}
                        onClick={handleRemoveClick}
                        disabled={removeEntry.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
