"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type WhatsAppStatus = {
  status: "disconnected" | "connecting" | "connected";
  lastQr: string | null;
  lastError: string | null;
};

export default function WhatsAppIntegrationPage() {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      setWaLoading(true);
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok) {
          if (res.status === 403 && active) {
            setForbidden(true);
            setWaStatus(null);
          }
          return;
        }
        const data = (await res.json()) as WhatsAppStatus;
        if (!active) return;
        setForbidden(false);
        setWaStatus(data);
      } catch (err) {
        console.error("Failed to load WhatsApp status:", err);
      } finally {
        if (active) setWaLoading(false);
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!waStatus?.lastQr) {
      setWaQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(waStatus.lastQr, { margin: 1, width: 240 })
      .then(setWaQrDataUrl)
      .catch((err) => {
        console.error("Failed to render WhatsApp QR:", err);
        setWaQrDataUrl(null);
      });
  }, [waStatus?.lastQr]);

  const handleReconnect = async () => {
    setWaLoading(true);
    try {
      const res = await fetch("/api/whatsapp/start", { method: "POST" });
      if (!res.ok) {
        if (res.status === 403) {
          setForbidden(true);
          setNotification({
            type: "error",
            message: "Only admins can pair the WhatsApp bridge.",
          });
          return;
        }
        throw new Error(await res.text());
      }
      const data = (await res.json()) as WhatsAppStatus;
      setWaStatus(data);
    } catch (err) {
      console.error("Failed to reconnect WhatsApp:", err);
      setNotification({
        type: "error",
        message: "Failed to start WhatsApp pairing.",
      });
    } finally {
      setWaLoading(false);
    }
  };

  const handleGenerateLinkCode = async () => {
    setLinkLoading(true);
    try {
      const res = await fetch("/api/whatsapp/link-code", { method: "POST" });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as { code: string; expiresAt: string };
      setLinkCode(data.code);
      setLinkExpiresAt(data.expiresAt);
      setNotification({
        type: "success",
        message: "WhatsApp link code generated.",
      });
    } catch (err) {
      console.error("Failed to generate link code:", err);
      setNotification({
        type: "error",
        message: "Failed to generate link code.",
      });
    } finally {
      setLinkLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">WhatsApp</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pair WhatsApp with a QR code, then link your own number with a code.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 rounded-lg border p-3 text-sm",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {notification.message}
        </div>
      )}

      <div className="space-y-6">
        <div className="rounded-lg border p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Bridge Pairing</h3>
              <p className="text-sm text-muted-foreground">
                Connect the app bridge to a WhatsApp account by scanning the QR code.
              </p>
            </div>
            <Button onClick={handleReconnect} disabled={waLoading || forbidden}>
              {waLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect WhatsApp"
              )}
            </Button>
          </div>

          <div className="mt-4 rounded-lg border bg-muted/20 p-4">
            <div className="text-sm text-muted-foreground">
              Status:{" "}
              <span className="font-medium text-foreground">{waStatus?.status ?? "unknown"}</span>
            </div>
            {forbidden && (
              <p className="mt-2 text-sm text-muted-foreground">
                Only admins can pair the shared WhatsApp bridge.
              </p>
            )}
            {waStatus?.lastError && (
              <div className="mt-1 text-sm text-destructive">{waStatus.lastError}</div>
            )}
            {waQrDataUrl ? (
              <div className="mt-4 flex flex-col items-start gap-2">
                <Image
                  src={waQrDataUrl}
                  alt="WhatsApp QR code"
                  width={240}
                  height={240}
                  unoptimized
                  className="h-60 w-60 rounded-md border bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">
                  Scan this in WhatsApp: Settings {"->"} Linked Devices {"->"} Link a Device.
                </p>
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                QR code will appear here when pairing is available.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border p-6">
          <h3 className="text-lg font-semibold">User Linking Code</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate your code and send it from your WhatsApp number to complete account linking.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={handleGenerateLinkCode} disabled={linkLoading}>
              {linkLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate link code"
              )}
            </Button>
            {linkCode && (
              <div className="rounded-md border bg-muted/40 px-4 py-2 text-sm">
                <div className="font-medium">Code: {linkCode}</div>
                {linkExpiresAt && (
                  <div className="text-xs text-muted-foreground">
                    Expires at {new Date(linkExpiresAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
