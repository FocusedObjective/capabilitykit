import { describe, expect, it } from "vitest";
import { summarizeSavedReviewHealth } from "../src/capabilityReviewHealth.js";
import type { Capability } from "../src/types.js";

function capability(review: NonNullable<NonNullable<Capability["agent"]>["review"]>): Capability {
  return {
    id: "core/example",
    title: "Example",
    status: "implemented",
    area: "core",
    summary: "Example summary.",
    intent: "Example intent.",
    acceptance: ["Example is covered."],
    agent: { review }
  };
}

describe("saved review health", () => {
  it("keeps fully completed covered review evidence healthy", () => {
    const health = summarizeSavedReviewHealth(
      capability({
        depth: "verified",
        done: true,
        criteria: [{ criterion: "Example is covered.", status: "covered", evidence: ["src/example.ts:1"] }]
      })
    );

    expect(health).toEqual({ health: "ok", findings: [] });
  });

  it("requires review when saved evidence is incomplete but has no concrete implementation gap", () => {
    const health = summarizeSavedReviewHealth(
      capability({
        depth: "partial",
        done: false,
        criteria: [{ criterion: "Example is covered.", status: "covered", evidence: ["src/example.ts:1"] }]
      })
    );

    expect(health.health).toBe("review");
    expect(health.findings).toContain("review is not done");
    expect(health.findings).toContain("review depth is partial");
  });

  it("requires action when saved review evidence contains unresolved findings", () => {
    const health = summarizeSavedReviewHealth(
      capability({
        depth: "partial",
        done: false,
        gaps: ["Second criterion still needs work."],
        criteria: [
          { criterion: "Example is covered.", status: "covered", evidence: ["src/example.ts:1"] },
          { criterion: "Second criterion is covered.", status: "uncovered", evidence: [], notes: "Not implemented." }
        ]
      })
    );

    expect(health.health).toBe("action");
    expect(health.findings).toContain("Second criterion still needs work.");
    expect(health.findings).toContain("uncovered: Second criterion is covered.");
  });
});
