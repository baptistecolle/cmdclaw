// @vitest-environment jsdom

import type { ComponentProps } from "react";
import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolApprovalCard } from "./tool-approval-card";

void jestDomVitest;

vi.mock("next/image", () => ({
  // oxlint-disable-next-line eslint-plugin-next/no-img-element
  default: (props: ComponentProps<"img">) => <img {...props} alt={props.alt} />,
}));

const QUESTION_TOOL_INPUT = {
  questions: [
    {
      header: "Pick",
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
      custom: true,
    },
  ],
};

describe("ToolApprovalCard", () => {
  it("submits a typed custom answer with the submit button", () => {
    const onApprove = vi.fn();

    render(
      <ToolApprovalCard
        toolUseId="question-1"
        toolName="question"
        toolInput={QUESTION_TOOL_INPUT}
        integration="cmdclaw"
        operation="question"
        onApprove={onApprove}
        onDeny={vi.fn()}
        status="pending"
      />,
    );

    fireEvent.click(screen.getByTestId("question-typed-toggle-0"));
    fireEvent.change(screen.getByTestId("question-typed-input-0"), {
      target: { value: "Gamma" },
    });
    fireEvent.click(screen.getByTestId("question-typed-submit-0"));

    expect(onApprove).toHaveBeenCalledWith([["Gamma"]]);
  });
});
