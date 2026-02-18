"use client";

import { ChevronDown, Check, Lock } from "lucide-react";
import { useCallback } from "react";
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

type SortToken = { type: "text"; value: string } | { type: "number"; value: number };

function tokenizeModelName(name: string): SortToken[] {
  return name
    .split(/(\d+(?:\.\d+)?)/)
    .filter((token) => token.length > 0)
    .map((token) =>
      /^\d+(?:\.\d+)?$/.test(token)
        ? { type: "number", value: Number(token) }
        : { type: "text", value: token.toLowerCase() },
    );
}

function compareModelNames(a: string, b: string): number {
  const aTokens = tokenizeModelName(a);
  const bTokens = tokenizeModelName(b);
  const maxLength = Math.max(aTokens.length, bTokens.length);

  for (let index = 0; index < maxLength; index += 1) {
    const aToken = aTokens[index];
    const bToken = bTokens[index];

    if (!aToken || !bToken) {
      break;
    }

    if (aToken.type === "number" && bToken.type === "number" && aToken.value !== bToken.value) {
      return bToken.value - aToken.value;
    }

    if (aToken.type === "text" && bToken.type === "text" && aToken.value !== bToken.value) {
      return aToken.value.localeCompare(bToken.value);
    }

    if (aToken.type !== bToken.type) {
      return aToken.type === "text" ? -1 : 1;
    }
  }

  if (aTokens.length !== bTokens.length) {
    return aTokens.length - bTokens.length;
  }

  return a.localeCompare(b);
}

function sortModels(models: ModelOption[]): ModelOption[] {
  return models.toSorted((a, b) => compareModelNames(a.name, b.name));
}

const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
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

const SORTED_ANTHROPIC_MODELS = sortModels(ANTHROPIC_MODELS);
const SORTED_OPENAI_MODELS = sortModels(OPENAI_MODELS);
const SORTED_GOOGLE_MODELS = sortModels(GOOGLE_MODELS);
const SORTED_KIMI_MODELS = sortModels(KIMI_MODELS);

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

  const zenModels: ModelOption[] = sortModels(
    (freeModelsData?.models ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      provider: "opencode",
      providerLabel: "OpenCode Zen",
    })),
  );

  const allModels = [
    ...ANTHROPIC_MODELS,
    ...OPENAI_MODELS,
    ...GOOGLE_MODELS,
    ...KIMI_MODELS,
    ...zenModels,
  ];

  const currentModel = allModels.find((m) => m.id === selectedModel);
  const displayName = currentModel?.name ?? selectedModel;
  const handleModelSelect = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const modelId = event.currentTarget.dataset.modelId;
      if (modelId) {
        onModelChange(modelId);
      }
    },
    [onModelChange],
  );
  const openSubscriptions = useCallback(() => {
    window.location.href = "/settings/subscriptions";
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-testid="chat-model-selector"
          className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
        >
          {displayName}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Anthropic</DropdownMenuLabel>
        {SORTED_ANTHROPIC_MODELS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            data-testid={`chat-model-option-${model.id}`}
            data-model-id={model.id}
            onClick={handleModelSelect}
          >
            <span className="flex-1">{model.name}</span>
            {selectedModel === model.id && <Check className="text-foreground h-3.5 w-3.5" />}
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
                data-model-id={model.id}
                onClick={handleModelSelect}
              >
                <span className="flex-1">{model.name}</span>
                {selectedModel === model.id && <Check className="text-foreground h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          ChatGPT
          {!isOpenAIConnected && <Lock className="text-muted-foreground h-3 w-3" />}
        </DropdownMenuLabel>
        {isOpenAIConnected ? (
          SORTED_OPENAI_MODELS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              data-testid={`chat-model-option-${model.id}`}
              data-model-id={model.id}
              onClick={handleModelSelect}
            >
              <span className="flex-1">{model.name}</span>
              {selectedModel === model.id && <Check className="text-foreground h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem className="text-muted-foreground text-xs" onClick={openSubscriptions}>
            Connect in Settings to unlock
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          Gemini
          {!isGoogleConnected && <Lock className="text-muted-foreground h-3 w-3" />}
        </DropdownMenuLabel>
        {isGoogleConnected ? (
          SORTED_GOOGLE_MODELS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              data-testid={`chat-model-option-${model.id}`}
              data-model-id={model.id}
              onClick={handleModelSelect}
            >
              <span className="flex-1">{model.name}</span>
              {selectedModel === model.id && <Check className="text-foreground h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem className="text-muted-foreground text-xs" onClick={openSubscriptions}>
            Connect in Settings to unlock
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          Kimi
          {!isKimiConnected && <Lock className="text-muted-foreground h-3 w-3" />}
        </DropdownMenuLabel>
        {isKimiConnected ? (
          SORTED_KIMI_MODELS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              data-testid={`chat-model-option-${model.id}`}
              data-model-id={model.id}
              onClick={handleModelSelect}
            >
              <span className="flex-1">{model.name}</span>
              {selectedModel === model.id && <Check className="text-foreground h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem className="text-muted-foreground text-xs" onClick={openSubscriptions}>
            Connect in Settings to unlock
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
