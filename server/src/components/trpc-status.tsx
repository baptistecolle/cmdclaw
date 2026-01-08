'use client';

import { useState } from "react";

import { trpc } from "@/trpc/client";

export function TrpcStatus() {
  const ping = trpc.health.ping.useQuery();
  const echo = trpc.health.echo.useMutation();
  const [text, setText] = useState("ViralPilot + tRPC");

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">tRPC link</p>
          <p className="text-xs text-muted-foreground">
            Quick round trip to verify the API handler is wired up.
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
            ping.isSuccess
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {ping.isSuccess ? "Live" : ping.isLoading ? "Checking…" : "Offline"}
        </span>
      </div>

      <div className="rounded-md bg-muted p-3 text-sm">
        {ping.data ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Ping message</span>
            <span className="font-mono text-xs text-foreground">
              {ping.data.message} @ {ping.data.at}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">Waiting for response…</span>
        )}
      </div>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim() || echo.isPending) return;
          echo.mutate({ text });
        }}
      >
        <label className="text-xs font-medium text-muted-foreground">
          Echo helper
        </label>
        <div className="flex gap-2">
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Send a message through tRPC"
          />
          <button
            type="submit"
            disabled={echo.isPending || !text.trim()}
            className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:bg-foreground/60"
          >
            {echo.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {echo.data && (
        <div className="rounded-md border bg-background px-3 py-2 text-xs">
          <p className="text-muted-foreground">Echoed back</p>
          <p className="font-mono text-foreground">
            {echo.data.text} @ {echo.data.at}
          </p>
        </div>
      )}
    </div>
  );
}
