import { describe, expect, it } from "vitest";
import { getDirectModeTools } from "@/server/ai/tools";

describe("direct mode tools", () => {
  it("includes send_file and no expose_file alias", () => {
    const names = getDirectModeTools().map((tool) => tool.name);

    expect(names).toContain("send_file");
    expect(names).not.toContain("expose_file");
  });
});
