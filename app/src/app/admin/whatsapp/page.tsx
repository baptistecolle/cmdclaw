"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type WhatsAppStatus = {
  status: "disconnected" | "connecting" | "connected";
  lastQr: string | null;
  lastError: string | null;
};

export default function AdminWhatsAppPage() {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      setWaLoading(true);
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as WhatsAppStatus;
        if (!active) return;
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
    QRCode.toDataURL(waStatus.lastQr, { margin: 1, width: 220 })
      .then(setWaQrDataUrl)
      .catch((err) => {
        console.error("Failed to render WhatsApp QR:", err);
        setWaQrDataUrl(null);
      });
  }, [waStatus?.lastQr]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">WhatsApp Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the shared WhatsApp number for the whole app.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Connection</h3>
            <p className="text-sm text-muted-foreground">
              Reconnect and monitor the WhatsApp bridge status.
            </p>
          </div>
          <Button
            onClick={async () => {
              setWaLoading(true);
              try {
                const res = await fetch("/api/whatsapp/start", { method: "POST" });
                if (res.ok) {
                  const data = (await res.json()) as WhatsAppStatus;
                  setWaStatus(data);
                }
              } finally {
                setWaLoading(false);
              }
            }}
            disabled={waLoading}
          >
            {waLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              "Reconnect WhatsApp"
            )}
          </Button>
        </div>

        <div className="mt-4 rounded-lg border bg-background p-4">
          <div className="text-sm text-muted-foreground">
            Status: <span className="font-medium text-foreground">{waStatus?.status ?? "unknown"}</span>
          </div>
          {waStatus?.lastError && (
            <div className="mt-1 text-sm text-destructive">{waStatus.lastError}</div>
          )}
          {waQrDataUrl ? (
            <div className="mt-4 flex flex-col items-start gap-2">
              <img src={waQrDataUrl} alt="WhatsApp QR code" className="h-56 w-56" />
              <p className="text-xs text-muted-foreground">
                Scan this QR code in WhatsApp {"->"} Linked devices.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              QR code will appear here when WhatsApp is ready to pair.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
