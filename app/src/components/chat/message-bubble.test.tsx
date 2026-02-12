// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SandboxFileData } from "./message-list";
import { MessageBubble } from "./message-bubble";

describe("MessageBubble", () => {
  it("renders user messages in the user bubble", () => {
    render(<MessageBubble role="user" content="Hello from user" />);

    expect(screen.getByTestId("chat-bubble-user")).toBeInTheDocument();
    expect(screen.getByText("Hello from user")).toBeInTheDocument();
  });

  it("renders assistant messages with clickable sandbox file paths", () => {
    const onFileClick = vi.fn();
    const file: SandboxFileData = {
      fileId: "file-1",
      path: "/app/report.pdf",
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };

    render(
      <MessageBubble
        role="assistant"
        content="Saved output to /app/report.pdf"
        sandboxFiles={[file]}
        onFileClick={onFileClick}
      />,
    );

    const fileButton = screen.getByRole("button", {
      name: /\/app\/report\.pdf/i,
    });
    fireEvent.click(fileButton);

    expect(onFileClick).toHaveBeenCalledTimes(1);
    expect(onFileClick).toHaveBeenCalledWith(file);
  });
});
