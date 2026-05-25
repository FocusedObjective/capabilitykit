import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCapability } from "../src/parseCapability.js";

describe("parseCapability", () => {
  it("parses a valid capability", () => {
    const result = parseCapability(
      `
title: Example
status: planned
area: core
summary: Example summary.
intent: Example intent.
acceptance:
  - It works.
agent:
  verification:
    manual:
      - Review it.
`,
      "core/example.capability.yaml"
    );

    expect(result.errors).toEqual([]);
    expect(result.capability?.id).toBe("core/example");
  });

  it("derives omitted identity fields from the file path", () => {
    const result = parseCapability(
      `
title: Derived
status: planned
summary: Derived summary.
intent: Derived intent.
acceptance:
  - It derives identity from the path.
`,
      ".capabilities/core/model/derived.capability.yaml"
    );

    expect(result.errors).toEqual([]);
    expect(result.capability?.id).toBe("core/model/derived");
    expect(result.capability?.area).toBe("core");
    expect(result.hasExplicitId).toBe(false);
    expect(result.hasExplicitArea).toBe(false);
  });

  it("normalizes legacy implementation fields into the agent section", () => {
    const result = parseCapability(
      `
id: core.legacy
title: Legacy
status: implemented
area: core
summary: Legacy summary.
intent: Legacy intent.
acceptance:
  - It works.
verification:
  manual:
    - Review it.
implementation:
  references:
    - packages/core/src/parseCapability.ts
agent_guidance:
  build_notes:
    - Keep behavior stable.
  avoid:
    - Do not guess.
`,
      "legacy.capability.yaml"
    );

    expect(result.errors).toEqual([]);
    expect(result.capability?.agent?.implementation?.references).toEqual(["packages/core/src/parseCapability.ts"]);
    expect(result.capability?.guidance).toEqual(["Keep behavior stable.", "Do not guess."]);
  });

  it("returns schema errors for invalid capability data", () => {
    const result = parseCapability(
      `
title: Invalid
status: unknown
area: core
summary: Invalid summary.
intent: Invalid intent.
acceptance:
  - It fails schema validation.
`,
      "invalid.capability.yaml"
    );

    expect(result.capability).toBeUndefined();
    expect(result.errors.some((error) => error.code === "schema-error")).toBe(true);
  });

  it("parses example project capability files as valid MVP schema", async () => {
    const files = [
      "examples/basic-app/.capabilities/account/login.capability.yaml",
      "examples/basic-app/.capabilities/account/profile.capability.yaml",
      "examples/basic-app/.capabilities/checkout/cart.capability.yaml",
      "examples/basic-app/.capabilities/checkout/payment.capability.yaml"
    ];

    for (const file of files) {
      const source = await readFile(path.resolve(process.cwd(), file), "utf8");
      const result = parseCapability(source, file);
      expect(result.errors, file).toEqual([]);
      expect(result.capability?.agent?.verification, file).toBeDefined();
    }
  });

  it("parses planning story map metadata", () => {
    const result = parseCapability(`
title: Story
status: planned
summary: Story summary.
intent: Story intent.
acceptance:
  - Works.
planning:
  story_map:
    backbone: Browse
    step: View details
    release: mvp
    order: 1
`, "core/story.capability.yaml");

    expect(result.errors).toEqual([]);
    expect(result.capability?.planning?.story_map?.release).toBe("mvp");
  });

});
