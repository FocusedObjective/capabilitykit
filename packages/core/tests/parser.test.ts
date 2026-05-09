import { describe, expect, it } from "vitest";
import { parseCapability } from "../src/parseCapability.js";

describe("parseCapability", () => {
  it("parses a valid capability", () => {
    const result = parseCapability(
      `
id: core.example
title: Example
status: planned
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - It works.
verification:
  manual:
    - Review it.
`,
      "example.capability.yaml"
    );

    expect(result.errors).toEqual([]);
    expect(result.capability?.id).toBe("core.example");
  });

  it("returns schema errors for invalid capability data", () => {
    const result = parseCapability(
      `
id: core.invalid
title: Invalid
status: unknown
`,
      "invalid.capability.yaml"
    );

    expect(result.capability).toBeUndefined();
    expect(result.errors.some((error) => error.code === "schema-error")).toBe(true);
  });
});
