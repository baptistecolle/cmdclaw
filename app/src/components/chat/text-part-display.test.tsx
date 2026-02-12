// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextPartDisplay } from "./text-part-display";

describe("TextPartDisplay", () => {
  it("renders content", () => {
    render(<TextPartDisplay content="Streaming output" />);

    expect(screen.getByText("Streaming output")).toBeInTheDocument();
  });

  it("shows the streaming cursor when isStreaming is true", () => {
    const { container } = render(
      <TextPartDisplay content="Streaming output" isStreaming />
    );

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });
});
