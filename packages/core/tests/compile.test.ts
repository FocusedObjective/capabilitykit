import { describe, expect, it } from "vitest";
import { compileCapabilities } from "../src/compileCapabilities.js";

describe("compileCapabilities", () => {
  it("compiles the repository capability map", async () => {
    const compiled = await compileCapabilities(process.cwd());

    expect(compiled.project.name).toBe("capabilitykit");
    expect(compiled.capabilities.length).toBeGreaterThan(0);
    expect(compiled.dependency_graph["core/validate-capability-files"]).toContain("core/define-capability-format");
    expect(compiled.verification_summary.automated_checks).toBeGreaterThan(0);
  });
});
