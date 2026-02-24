// @vitest-environment jsdom

import type { ComponentProps } from "react";
import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthRequestCard } from "./auth-request-card";

void jestDomVitest;

vi.mock("next/image", () => ({
  // oxlint-disable-next-line eslint-plugin-next/no-img-element
  default: (props: ComponentProps<"img">) => <img {...props} alt={props.alt} />,
}));

const INTEGRATIONS = ["google_sheets"];
const CONNECTED_INTEGRATIONS: string[] = [];

describe("AuthRequestCard", () => {
  it("shows connection actions for pending integrations", () => {
    const onConnect = vi.fn();
    const onCancel = vi.fn();

    render(
      <AuthRequestCard
        integrations={INTEGRATIONS}
        connectedIntegrations={CONNECTED_INTEGRATIONS}
        reason="Google Sheets authentication required"
        onConnect={onConnect}
        onCancel={onCancel}
        status="pending"
      />,
    );

    expect(screen.getByText("Connection Required")).toBeInTheDocument();
    expect(screen.getByText("Google Sheets authentication required")).toBeInTheDocument();
    expect(screen.getByText(/cmdclaw/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    expect(onConnect).toHaveBeenCalledWith("google_sheets");

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
