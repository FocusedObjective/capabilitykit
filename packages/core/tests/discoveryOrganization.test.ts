import { describe, expect, it } from "vitest";
import { organizeDiscoveredCapabilityMap } from "../src/discovery.js";

describe("organizeDiscoveredCapabilityMap", () => {
  it("groups candidates into stable area folders and readable capability IDs", () => {
    const organized = organizeDiscoveredCapabilityMap({
      inspected_files: ["src/auth/login.ts", "src/billing/invoices.ts"],
      inspected_areas: ["auth", "billing"],
      candidates: [
        {
          title: "Log in users",
          likely_area: "Accounts / Authentication",
          source_evidence: [{ path: "src/auth/login.ts", kind: "source" }],
          confidence: "high"
        },
        {
          title: "Send invoices",
          likely_area: "Billing",
          source_evidence: [{ path: "src/billing/invoices.ts", kind: "source" }],
          confidence: "medium"
        }
      ]
    });

    expect(organized.summary).toContain("2 discovered capabilities organized into 2 areas");
    expect(organized.areas.map((area) => area.area)).toEqual(["accounts/authentication", "billing"]);
    expect(organized.capabilities.map((capability) => capability.id)).toEqual([
      "accounts/authentication/log-in-users",
      "billing/send-invoices"
    ]);
    expect(organized.capabilities[0].filePath).toBe(".capabilities/accounts/authentication/log-in-users.capability.yaml");
  });

  it("suggests dependencies from explicit candidate relationships", () => {
    const organized = organizeDiscoveredCapabilityMap({
      inspected_files: ["src/auth/session.ts", "src/orders/checkout.ts"],
      inspected_areas: ["auth", "orders"],
      candidates: [
        {
          title: "Maintain sessions",
          likely_area: "accounts",
          source_evidence: [{ path: "src/auth/session.ts", kind: "source" }],
          confidence: "high"
        },
        {
          title: "Checkout orders",
          likely_area: "orders",
          source_evidence: [{ path: "src/orders/checkout.ts", kind: "source" }],
          confidence: "medium",
          depends_on: ["Maintain sessions"]
        }
      ]
    });

    expect(organized.dependency_suggestions).toEqual([
      {
        from: "orders/checkout-orders",
        to: "accounts/maintain-sessions",
        reason: 'Candidate explicitly listed "Maintain sessions" as a dependency.'
      }
    ]);
    expect(organized.capabilities.find((capability) => capability.id === "orders/checkout-orders")?.depends_on).toEqual([
      "accounts/maintain-sessions"
    ]);
  });

  it("flags ambiguous grouping and weak evidence for human review", () => {
    const organized = organizeDiscoveredCapabilityMap({
      inspected_files: ["README.md"],
      inspected_areas: ["docs"],
      candidates: [
        {
          title: "Describe roadmap",
          likely_area: "",
          source_evidence: [{ path: "README.md", kind: "doc" }],
          confidence: "low"
        }
      ]
    });

    expect(organized.capabilities[0]).toMatchObject({
      id: "general/describe-roadmap",
      area: "general"
    });
    expect(organized.review_gaps).toContain("general/describe-roadmap: Area was inferred as general and needs human review.");
    expect(organized.review_gaps).toContain("general/describe-roadmap: Candidate lacks concrete implementation evidence.");
  });
});
