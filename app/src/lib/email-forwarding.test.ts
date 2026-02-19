import { describe, expect, it } from "vitest";
import {
  buildUserForwardingAddress,
  buildWorkflowForwardingAddress,
  extractEmailAddress,
  parseForwardingTargetFromEmail,
} from "./email-forwarding";

describe("email-forwarding", () => {
  it("builds workflow and user forwarding aliases", () => {
    expect(buildWorkflowForwardingAddress("wf-123", "Mail.HeyBap.com")).toBe(
      "bot+wf_wf-123@mail.heybap.com",
    );

    expect(buildUserForwardingAddress("user-123", "mail.heybap.com")).toBe(
      "bot+u_user-123@mail.heybap.com",
    );
  });

  it("extracts sender email from RFC-like display names", () => {
    expect(extractEmailAddress("Bap User <Test@Example.com>")).toBe("test@example.com");
    expect(extractEmailAddress("test@example.com")).toBe("test@example.com");
    expect(extractEmailAddress("")).toBeNull();
    expect(extractEmailAddress(undefined)).toBeNull();
  });

  it("parses workflow and user aliases from recipient emails", () => {
    expect(
      parseForwardingTargetFromEmail("bot+wf_wf-123@mail.heybap.com", "mail.heybap.com"),
    ).toEqual({
      kind: "workflow",
      id: "wf-123",
    });

    expect(
      parseForwardingTargetFromEmail("bot+u_user-123@mail.heybap.com", "mail.heybap.com"),
    ).toEqual({
      kind: "user",
      id: "user-123",
    });
  });

  it("rejects unknown domains and local parts", () => {
    expect(parseForwardingTargetFromEmail("bot+wf_wf-123@other.com", "mail.heybap.com")).toBeNull();
    expect(parseForwardingTargetFromEmail("bot@mail.heybap.com", "mail.heybap.com")).toBeNull();
  });
});
