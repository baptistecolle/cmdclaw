"use client";

import { Monitor, Cloud, Wifi } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
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
import { client } from "@/orpc/client";

interface Device {
  id: string;
  name: string;
  platform: string;
  isOnline: boolean;
}

type Props = {
  selectedDeviceId: string | undefined;
  onSelect: (deviceId: string | undefined) => void;
};

export function DeviceSelector({ selectedDeviceId, onSelect }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    let mounted = true;

    const fetchDevices = async () => {
      try {
        const result = await client.device.list();
        if (mounted) {
          setDevices(
            result
              .filter((d) => d.isOnline)
              .map((d) => ({
                id: d.id,
                name: d.name,
                platform: d.platform,
                isOnline: d.isOnline,
              })),
          );
        }
      } catch {
        // ignore
      }
    };

    fetchDevices();
    const interval = setInterval(fetchDevices, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const selected = selectedDeviceId ? devices.find((d) => d.id === selectedDeviceId) : null;
  const devicesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const device of devices) {
      map.set(device.id, device.id);
    }
    return map;
  }, [devices]);
  const handleSelectCloud = useCallback(() => {
    onSelect(undefined);
  }, [onSelect]);
  const handleSelectDevice = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const deviceId = event.currentTarget.dataset.deviceId;
      if (!deviceId) {
        return;
      }
      const resolvedDeviceId = devicesById.get(deviceId);
      if (resolvedDeviceId) {
        onSelect(resolvedDeviceId);
      }
    },
    [devicesById, onSelect],
  );

  // Don't render if no devices are available
  if (devices.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
              {selected ? (
                <>
                  <Monitor className="h-3 w-3" />
                  <span className="max-w-20 truncate">{selected.name}</span>
                </>
              ) : (
                <>
                  <Cloud className="h-3 w-3" />
                  <span>Cloud</span>
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Compute backend</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">Backend</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSelectCloud}>
          <Cloud className="mr-2 h-3.5 w-3.5" />
          <span>Cloud (E2B)</span>
        </DropdownMenuItem>

        {devices.map((device) => (
          <DropdownMenuItem key={device.id} data-device-id={device.id} onClick={handleSelectDevice}>
            <Monitor className="mr-2 h-3.5 w-3.5" />
            <span className="flex items-center gap-1.5">
              {device.name}
              <Wifi className="h-3 w-3 text-green-500" />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
