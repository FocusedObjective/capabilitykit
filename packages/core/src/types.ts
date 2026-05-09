export type CapabilityStatus = "planned" | "in-progress" | "implemented" | "verified" | "deprecated";

export interface VerificationCheck {
  id?: string;
  description: string;
  command?: string;
}

export interface Capability {
  id: string;
  title: string;
  status: CapabilityStatus;
  area: string;
  summary: string;
  intent: string;
  inputs?: string[];
  outputs?: string[];
  depends_on?: string[];
  acceptance: string[];
  verification?: {
    automated?: VerificationCheck[];
    manual?: string[];
    gaps?: string[];
  };
  implementation?: {
    references?: string[];
  };
  agent_guidance?: {
    build_notes?: string[];
    avoid?: string[];
  };
  replacement?: string;
}

export interface ProjectConfig {
  schema_version: string | number;
  project: {
    name: string;
    description?: string;
    repository?: string;
  };
  source?: {
    include?: string[];
    exclude?: string[];
  };
  validation?: {
    require_acceptance?: boolean;
    require_verification?: boolean;
    allow_verification_gaps?: boolean;
    require_implementation_references_for_status?: CapabilityStatus[];
  };
  output?: {
    path?: string;
  };
}

export interface ParsedCapability {
  capability: Capability;
  filePath: string;
  relativePath: string;
}

export interface CapabilityIssue {
  code: string;
  message: string;
  filePath?: string;
  capabilityId?: string;
}

export interface VerificationGap {
  code: string;
  message: string;
  filePath?: string;
  capabilityId?: string;
}

export interface LoadCapabilitiesResult {
  rootDir: string;
  capabilitiesDir: string;
  config: ProjectConfig;
  capabilities: ParsedCapability[];
  errors: CapabilityIssue[];
}

export interface ValidationResult {
  valid: boolean;
  parsedCount: number;
  uniqueIdCount: number;
  errors: CapabilityIssue[];
  verificationGaps: VerificationGap[];
}

export interface CompiledCapabilities {
  project: ProjectConfig["project"];
  generated_at: string;
  capabilities: Array<Capability & { path: string; hierarchy: string[] }>;
  dependency_graph: Record<string, string[]>;
  verification_summary: {
    automated_checks: number;
    manual_checks: number;
    gaps: number;
  };
  validation: ValidationResult;
}
