"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { client } from "@/orpc/client";
import { CheckCircle2, Loader2, Monitor, XCircle } from "lucide-react";

export default function ConnectDevicePage() {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim()) return;

    setStatus("submitting");
    setErrorMsg("");

    try {
      const result = await client.device.approve({
        userCode: code.trim().toUpperCase(),
        deviceName: deviceName.trim() || undefined,
      });

      if (result.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(result.error || "Failed to approve device");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg("An error occurred. Please try again.");
    }
  };

  return (
    <AppShell>
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md px-4">
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <Monitor className="h-7 w-7 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-semibold">Connect Device</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the code shown on your device to connect it as a compute
              backend.
            </p>
          </div>

          {status === "success" ? (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-6 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-green-600 dark:text-green-400" />
              <h2 className="mt-3 font-medium text-green-700 dark:text-green-300">
                Device connected
              </h2>
              <p className="mt-1 text-sm text-green-600 dark:text-green-400">
                Your device is now connected. You can start using it as a
                compute backend.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Device Code
                </label>
                <Input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCD-1234"
                  maxLength={9}
                  className="text-center text-lg font-mono tracking-widest"
                  autoFocus
                  disabled={status === "submitting"}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Device Name{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. MacBook Pro"
                  disabled={status === "submitting"}
                />
              </div>

              {status === "error" && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {errorMsg}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={!code.trim() || status === "submitting"}
              >
                {status === "submitting" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Connect Device"
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
