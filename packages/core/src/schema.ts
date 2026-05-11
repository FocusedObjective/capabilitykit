import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const capabilityStatusSchema = z.enum([
  "planned",
  "in-progress",
  "implemented",
  "verified",
  "deprecated"
]);

export const verificationCheckSchema = z.object({
  id: nonEmptyString.optional(),
  description: nonEmptyString,
  command: nonEmptyString.optional()
});

type AgentSection = {
  inputs?: string[];
  outputs?: string[];
  depends_on?: string[];
  implementation?: {
    references?: string[];
    inferred_from?: string[];
  };
  verification?: {
    automated?: Array<z.infer<typeof verificationCheckSchema>>;
    manual?: string[];
    gaps?: string[];
  };
  review?: {
    depth?: "none" | "referenced" | "partial" | "behavioral" | "tested" | "verified" | "unknown";
    gaps?: string[];
    evidence?: string[];
  };
  guidance?: {
    notes?: string[];
    avoid?: string[];
  };
};

const agentSectionSchema = z
  .object({
    inputs: z.array(nonEmptyString).optional().default([]),
    outputs: z.array(nonEmptyString).optional().default([]),
    depends_on: z.array(nonEmptyString).optional().default([]),
    implementation: z
      .object({
        references: z.array(nonEmptyString).optional().default([]),
        inferred_from: z.array(nonEmptyString).optional().default([])
      })
      .optional(),
    verification: z
      .object({
        automated: z.array(verificationCheckSchema).optional().default([]),
        manual: z.array(nonEmptyString).optional().default([]),
        gaps: z.array(nonEmptyString).optional().default([])
      })
      .optional(),
    review: z
      .object({
        depth: z.enum(["none", "referenced", "partial", "behavioral", "tested", "verified", "unknown"]).optional(),
        gaps: z.array(nonEmptyString).optional().default([]),
        evidence: z.array(nonEmptyString).optional().default([])
      })
      .optional(),
    guidance: z
      .object({
        notes: z.array(nonEmptyString).optional().default([]),
        avoid: z.array(nonEmptyString).optional().default([])
      })
      .optional()
  })
  .optional();

const rawCapabilitySchema = z.object({
  id: nonEmptyString.optional(),
  title: nonEmptyString,
  status: capabilityStatusSchema,
  area: nonEmptyString,
  summary: nonEmptyString,
  intent: nonEmptyString,
  inputs: z.array(nonEmptyString).optional().default([]),
  outputs: z.array(nonEmptyString).optional().default([]),
  depends_on: z.array(nonEmptyString).optional().default([]),
  acceptance: z.array(nonEmptyString).min(1),
  guidance: z.array(nonEmptyString).optional().default([]),
  verification: z
    .object({
      automated: z.array(verificationCheckSchema).optional().default([]),
      manual: z.array(nonEmptyString).optional().default([]),
      gaps: z.array(nonEmptyString).optional().default([])
    })
    .optional(),
  agent: agentSectionSchema,
  implementation: z
    .object({
      references: z.array(nonEmptyString).optional().default([])
    })
    .optional(),
  agent_guidance: z
    .object({
      build_notes: z.array(nonEmptyString).optional().default([]),
      avoid: z.array(nonEmptyString).optional().default([])
    })
    .optional(),
  replacement: nonEmptyString.optional()
});

export const capabilitySchema = rawCapabilitySchema.transform((capability) => {
  const legacyImplementation = capability.implementation;
  const legacyGuidance = capability.agent_guidance;
  const agent: AgentSection = { ...capability.agent };

  if (capability.inputs.length > 0 || capability.agent?.inputs) {
    agent.inputs = capability.agent?.inputs ?? capability.inputs;
  }

  if (capability.outputs.length > 0 || capability.agent?.outputs) {
    agent.outputs = capability.agent?.outputs ?? capability.outputs;
  }

  if (capability.depends_on.length > 0 || capability.agent?.depends_on) {
    agent.depends_on = capability.agent?.depends_on ?? capability.depends_on;
  }

  if (capability.verification || capability.agent?.verification) {
    agent.verification = {
      ...(capability.agent?.verification ?? {}),
      automated: capability.agent?.verification?.automated ?? capability.verification?.automated ?? [],
      manual: capability.agent?.verification?.manual ?? capability.verification?.manual ?? [],
      gaps: capability.agent?.verification?.gaps ?? capability.verification?.gaps ?? []
    };
  }

  if (legacyImplementation || capability.agent?.implementation) {
    agent.implementation = {
      ...(legacyImplementation ?? {}),
      ...(capability.agent?.implementation ?? {}),
      references: capability.agent?.implementation?.references ?? legacyImplementation?.references ?? [],
      inferred_from: capability.agent?.implementation?.inferred_from ?? []
    };
  }

  const guidance = [
    ...capability.guidance,
    ...(legacyGuidance?.build_notes ?? []),
    ...(legacyGuidance?.avoid ?? []),
    ...(capability.agent?.guidance?.notes ?? []),
    ...(capability.agent?.guidance?.avoid ?? [])
  ];
  delete agent.guidance;

  for (const key of ["inputs", "outputs", "depends_on"] as const) {
    if (agent[key]?.length === 0) {
      delete agent[key];
    }
  }

  return {
    id: capability.id ?? `${slugify(capability.area)}/${slugify(capability.title)}`,
    title: capability.title,
    status: capability.status,
    area: capability.area,
    summary: capability.summary,
    intent: capability.intent,
    acceptance: capability.acceptance,
    guidance: guidance.length > 0 ? guidance : undefined,
    agent: Object.keys(agent).length > 0 ? agent : undefined,
    replacement: capability.replacement
  };
});

export const projectConfigSchema = z.object({
  schema_version: z.union([z.string(), z.number()]),
  project: z.object({
    name: nonEmptyString,
    description: nonEmptyString.optional(),
    repository: nonEmptyString.optional()
  }),
  source: z
    .object({
      include: z.array(nonEmptyString).optional().default(["**/*.capability.yaml"]),
      exclude: z.array(nonEmptyString).optional().default(["dist/**"])
    })
    .optional()
    .default({ include: ["**/*.capability.yaml"], exclude: ["dist/**"] }),
  validation: z
    .object({
      require_acceptance: z.boolean().optional().default(true),
      require_verification: z.boolean().optional().default(true),
      allow_verification_gaps: z.boolean().optional().default(true),
      require_implementation_references_for_status: z
        .array(capabilityStatusSchema)
        .optional()
        .default(["implemented", "verified"])
    })
    .optional()
    .default({
      require_acceptance: true,
      require_verification: true,
      allow_verification_gaps: true,
      require_implementation_references_for_status: ["implemented", "verified"]
    }),
  output: z
    .object({
      path: nonEmptyString.optional().default(".capabilities/dist/capabilities.json")
    })
    .optional()
    .default({ path: ".capabilities/dist/capabilities.json" })
});
