// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatDraftStore } from "./chat-draft-store";
import { ChatInput } from "./chat-input";

void jestDomVitest;

const APPEND_PREFILL_REQUEST = {
  id: "voice-1",
  text: "hello from voice",
  mode: "append" as const,
};

describe("ChatInput", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    useChatDraftStore.setState({ drafts: {}, hasHydrated: true });
  });

  it("queues a message while streaming", () => {
    const onSend = vi.fn();

    render(<ChatInput onSend={onSend} isStreaming />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "Next prompt" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(screen.getByLabelText(/queue message/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop generation/i)).toBeInTheDocument();
    expect(onSend).toHaveBeenCalledWith("Next prompt", undefined);
  });

  it("keeps textarea editable while streaming", () => {
    render(<ChatInput onSend={vi.fn()} isStreaming disabled={false} />);

    const [input] = screen.getAllByTestId("chat-input") as HTMLTextAreaElement[];
    fireEvent.change(input, { target: { value: "Draft while generating" } });

    expect(input.value).toBe("Draft while generating");
    expect(input).not.toBeDisabled();
  });

  it("restores a saved draft for a conversation", () => {
    useChatDraftStore.getState().upsertDraft("conv-1", "Saved draft");

    render(<ChatInput onSend={vi.fn()} conversationId="conv-1" />);

    const inputs = screen.getAllByTestId("chat-input") as HTMLTextAreaElement[];
    const input = inputs[inputs.length - 1];
    expect(input.value).toBe("Saved draft");
  });

  it("keeps drafts isolated when switching conversation", () => {
    const store = useChatDraftStore.getState();
    store.upsertDraft("__new_chat__", "New draft");
    store.upsertDraft("conv-1", "Conv 1 draft");

    const view = render(<ChatInput onSend={vi.fn()} />);
    let inputs = screen.getAllByTestId("chat-input") as HTMLTextAreaElement[];
    expect(inputs[inputs.length - 1]?.value).toBe("New draft");

    view.rerender(<ChatInput onSend={vi.fn()} conversationId="conv-1" />);
    inputs = screen.getAllByTestId("chat-input") as HTMLTextAreaElement[];
    expect(inputs[inputs.length - 1]?.value).toBe("Conv 1 draft");
  });

  it("appends prefilled text when append mode is requested", async () => {
    const onSend = vi.fn();
    const view = render(<ChatInput onSend={onSend} />);
    const input = view.container.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Draft" } });

    view.rerender(<ChatInput onSend={onSend} prefillRequest={APPEND_PREFILL_REQUEST} />);

    const updatedInput = view.container.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(updatedInput.value).toBe("Draft hello from voice");
    });
  });
});
