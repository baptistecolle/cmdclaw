// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewChatPage from "./page";

type ChatAreaProps = {
  conversationId?: string;
};

const { chatAreaSpy } = vi.hoisted(() => ({
  chatAreaSpy: vi.fn(),
}));

vi.mock("@/components/chat/chat-area", () => ({
  ChatArea: (props: ChatAreaProps) => {
    chatAreaSpy(props);
    return <div data-testid="chat-area" />;
  },
}));

describe("NewChatPage", () => {
  it("renders ChatArea for a new conversation", () => {
    render(<NewChatPage />);

    expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    expect(chatAreaSpy).toHaveBeenCalledTimes(1);
    expect(chatAreaSpy.mock.calls[0]?.[0]).toEqual({});
  });
});
