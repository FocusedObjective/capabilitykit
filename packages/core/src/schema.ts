import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

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

export const capabilitySchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  status: capabilityStatusSchema,
  area: nonEmptyString,
  summary: nonEmptyString,
  intent: nonEmptyString,
  inputs: z.array(nonEmptyString).optional().default([]),
  outputs: z.array(nonEmptyString).optional().default([]),
  depends_on: z.array(nonEmptyString).optional().default([]),
  acceptance: z.array(nonEmptyString).min(1),
  verification: z
    .object({
      automated: z.array(verificationCheckSchema).optional().default([]),
      manual: z.array(nonEmptyString).optional().default([]),
      gaps: z.array(nonEmptyString).optional().default([])
    })
    .optional(),
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
