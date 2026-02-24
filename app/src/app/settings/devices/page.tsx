"use client";

import { Loader2, Monitor, Trash2, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { client } from "@/orpc/client";

interface Device {
  id: string;
  name: string;
  platform: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  capabilities: unknown;
  createdAt: string;
}

function RevokeDeviceButton({
  deviceId,
  isRevoking,
  onRevoke,
}: {
  deviceId: string;
  isRevoking: boolean;
  onRevoke: (deviceId: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onRevoke(deviceId);
  }, [deviceId, onRevoke]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={isRevoking}
      className="text-destructive hover:text-destructive"
    >
      {isRevoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </Button>
  );
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchDevices = async () => {
    try {
      const result = await client.device.list();
      setDevices(result);
    } catch (err) {
      console.error("Failed to load devices:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
    // Poll for online status changes
    const interval = setInterval(fetchDevices, 10_000);
    return () => clearInterval(interval);
  }, []);

  const handleRevoke = useCallback(async (deviceId: string) => {
    setRevoking(deviceId);
    try {
      await client.device.revoke({ deviceId });
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (err) {
      console.error("Failed to revoke device:", err);
    } finally {
      setRevoking(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Connected Devices</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage devices running the CmdClaw daemon. Devices can execute commands and proxy local
          LLM requests.
        </p>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Monitor className="text-muted-foreground/50 mx-auto h-10 w-10" />
          <h3 className="mt-3 text-sm font-medium">No devices connected</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Install the CmdClaw daemon on your machine to connect it as a compute backend.
          </p>
          <pre className="bg-muted mx-auto mt-4 w-fit rounded px-4 py-2 font-mono text-sm">
            curl -fsSL https://cmdclaw.com/i | sh
          </pre>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
                  <Monitor className="text-muted-foreground h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{device.name}</span>
                    {device.isOnline ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <Wifi className="h-3 w-3" />
                        Online
                      </span>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <WifiOff className="h-3 w-3" />
                        Offline
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {device.platform}
                    {device.lastSeenAt && !device.isOnline && (
                      <> &middot; Last seen {new Date(device.lastSeenAt).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              </div>

              <RevokeDeviceButton
                deviceId={device.id}
                isRevoking={revoking === device.id}
                onRevoke={handleRevoke}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
