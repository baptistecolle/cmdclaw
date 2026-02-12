"use client";

import { ChevronDown, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useOpencodeFreeModels, useProviderAuthStatus } from "@/orpc/hooks";

type ModelOption = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
};

const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    providerLabel: "Anthropic",
  },
];

const OPENAI_MODELS: ModelOption[] = [
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    provider: "openai",
    providerLabel: "ChatGPT",
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    provider: "openai",
    providerLabel: "ChatGPT",
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    providerLabel: "ChatGPT",
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    provider: "openai",
    providerLabel: "ChatGPT",
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    provider: "openai",
    providerLabel: "ChatGPT",
  },
];

const GOOGLE_MODELS: ModelOption[] = [
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    providerLabel: "Gemini",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    providerLabel: "Gemini",
  },
];

const KIMI_MODELS: ModelOption[] = [
  {
    id: "k2p5",
    name: "Kimi K2.5",
    provider: "kimi-for-coding",
    providerLabel: "Kimi",
  },
  {
    id: "kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    provider: "kimi-for-coding",
    providerLabel: "Kimi",
  },
];

type Props = {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
};

export function ModelSelector({ selectedModel, onModelChange, disabled }: Props) {
  const { data: authStatus } = useProviderAuthStatus();
  const { data: freeModelsData } = useOpencodeFreeModels();
  const connected = authStatus?.connected ?? {};

  const isOpenAIConnected = "openai" in connected;
  const isGoogleConnected = "google" in connected;
  const isKimiConnected = "kimi" in connected;

  const zenModels: ModelOption[] = (freeModelsData?.models ?? []).map((model) => ({
    id: model.id,
    name: model.name,
    provider: "opencode",
    providerLabel: "OpenCode Zen",
  }));

  const allModels = [
    ...ANTHROPIC_MODELS,
    ...OPENAI_MODELS,
    ...GOOGLE_MODELS,
    ...KIMI_MODELS,
    ...zenModels,
  ];

  const currentModel = allModels.find((m) => m.id === selectedModel);
  const displayName = currentModel?.name ?? selectedModel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-testid="chat-model-selector"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {displayName}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Anthropic</DropdownMenuLabel>
        {ANTHROPIC_MODELS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            data-testid={`chat-model-option-${model.id}`}
            onClick={() => onModelChange(model.id)}
          >
            <span className="flex-1">{model.name}</span>
            {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-foreground" />}
          </DropdownMenuItem>
        ))}

        {zenModels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>OpenCode Zen</DropdownMenuLabel>
            {zenModels.map((model) => (
              <DropdownMenuItem
                key={model.id}
                data-testid={`chat-model-option-${model.id}`}
                onClick={() => onModelChange(model.id)}
              >
                <span className="flex-1">{model.name}</span>
                {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-foreground" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          ChatGPT
          {!isOpenAIConnected && <Lock className="h-3 w-3 text-muted-foreground" />}
        </DropdownMenuLabel>
        {isOpenAIConnected ? (
          OPENAI_MODELS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              data-testid={`chat-model-option-${model.id}`}
              onClick={() => onModelChange(model.id)}
            >
              <span className="flex-1">{model.name}</span>
              {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-foreground" />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem
            className="text-xs text-muted-foreground"
            onClick={() => {
              window.location.href = "/settings/subscriptions";
            }}
          >
            Connect in Settings to unlock
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          Gemini
          {!isGoogleConnected && <Lock className="h-3 w-3 text-muted-foreground" />}
        </DropdownMenuLabel>
        {isGoogleConnected ? (
          GOOGLE_MODELS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              data-testid={`chat-model-option-${model.id}`}
              onClick={() => onModelChange(model.id)}
            >
              <span className="flex-1">{model.name}</span>
              {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-foreground" />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem
            className="text-xs text-muted-foreground"
            onClick={() => {
              window.location.href = "/settings/subscriptions";
            }}
          >
            Connect in Settings to unlock
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          Kimi
          {!isKimiConnected && <Lock className="h-3 w-3 text-muted-foreground" />}
        </DropdownMenuLabel>
        {isKimiConnected ? (
          KIMI_MODELS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              data-testid={`chat-model-option-${model.id}`}
              onClick={() => onModelChange(model.id)}
            >
              <span className="flex-1">{model.name}</span>
              {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-foreground" />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem
            className="text-xs text-muted-foreground"
            onClick={() => {
              window.location.href = "/settings/subscriptions";
            }}
          >
            Connect in Settings to unlock
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
