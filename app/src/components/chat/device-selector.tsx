"use client";

import { useState, useEffect } from "react";
import { Monitor, Cloud, Wifi } from "lucide-react";
import { client } from "@/orpc/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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

  // Don't render if no devices are available
  if (devices.length === 0) return null;

  const selected = selectedDeviceId
    ? devices.find((d) => d.id === selectedDeviceId)
    : null;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
            >
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

        <DropdownMenuItem onClick={() => onSelect(undefined)}>
          <Cloud className="mr-2 h-3.5 w-3.5" />
          <span>Cloud (E2B)</span>
        </DropdownMenuItem>

        {devices.map((device) => (
          <DropdownMenuItem key={device.id} onClick={() => onSelect(device.id)}>
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
