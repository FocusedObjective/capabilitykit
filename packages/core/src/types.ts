export type CapabilityStatus = "planned" | "in-progress" | "implemented" | "verified" | "deprecated";

export interface VerificationCheck {
  id?: string;
  description: string;
  command?: string;
}

export interface VerificationGapIgnore {
  code: string;
  reason: string;
  message_contains?: string;
}

export interface AssessmentFindingIgnore {
  status: string;
  reason: string;
  criterion?: string;
  criterion_contains?: string;
}

export type AgentReviewCriterionStatus = "covered" | "partial" | "uncovered" | "uncertain";

export interface AgentReviewCriterion {
  criterion: string;
  status: AgentReviewCriterionStatus;
  evidence: string[];
  notes?: string;
}

export interface Capability {
  id: string;
  title: string;
  status: CapabilityStatus;
  area: string;
  summary: string;
  intent: string;
  acceptance: string[];
  guidance?: string[];
  agent?: {
    inputs?: string[];
    outputs?: string[];
    depends_on?: string[];
    implementation?: {
      references?: string[];
      inferred_from?: string[];
    };
    verification?: {
      automated?: VerificationCheck[];
      manual?: string[];
      gaps?: string[];
      ignore_gaps?: VerificationGapIgnore[];
    };
    review?: {
      depth?: "none" | "referenced" | "partial" | "behavioral" | "tested" | "verified" | "unknown";
      gaps?: string[];
      evidence?: string[];
      intent_summary?: string;
      criteria?: AgentReviewCriterion[];
      ignore_findings?: AssessmentFindingIgnore[];
      done?: boolean;
    };
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
  derivedId?: string;
  derivedArea?: string;
  hasExplicitId?: boolean;
  hasExplicitArea?: boolean;
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

export interface CapabilityImpactGraph {
  dependencies: Record<string, string[]>;
  dependents: Record<string, string[]>;
  transitive_dependents: Record<string, string[]>;
}

export interface CapabilityImpactReport {
  capability_id: string;
  dependencies: string[];
  direct_dependents: string[];
  transitive_dependents: string[];
  impacted_capabilities: string[];
  verification: {
    automated: VerificationCheck[];
    manual: string[];
    gaps: VerificationGap[];
  };
}

export interface CompiledCapabilities {
  project: ProjectConfig["project"];
  generated_at: string;
  capabilities: Array<Capability & { path: string; hierarchy: string[] }>;
  dependency_graph: Record<string, string[]>;
  impact_graph: CapabilityImpactGraph;
  verification_summary: {
    automated_checks: number;
    manual_checks: number;
    gaps: number;
  };
  validation: ValidationResult;
}
