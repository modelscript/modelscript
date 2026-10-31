// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClusterStatus } from "../../api";

export type { ClusterStatus };

export interface StudyParameterSlot {
  slotId: string;
  label: string;
  description: string;
  type: "Real" | "Integer" | "Boolean";
  variability: string;
  unit?: string | undefined;
  multiple: boolean;
}

export interface StudyObservableSlot {
  slotId: string;
  label: string;
  description: string;
  type: string;
  unit?: string | undefined;
  multiple: boolean;
}

export interface StudyInputField {
  key: string;
  label: string;
  type: "number" | "integer" | "select" | "boolean" | "text";
  unit?: string | undefined;
  defaultValue: number | string | boolean;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  options?: { value: string; label: string }[] | undefined;
  description?: string | undefined;
  group?: string | undefined;
}

export interface StudyPreset {
  id: string;
  label: string;
  description: string;
  targetHint?: "local-wasm" | "local-native" | "hpc-cluster" | undefined;
  values: Record<string, number | string | boolean>;
}

export interface StudyDefinitionClient {
  schemaVersion: string;
  standardFormat?: "sedml" | "ssp-ssv" | "dakota" | undefined;
  id: string;
  slug: string;
  name: string;
  version: string;
  kind: string;
  category: string;
  sourceType: "official" | "package" | "community" | string;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  artifactPath?: string | null | undefined;
  authorUsername: string;
  icon: string;
  description: string;
  tags: string[];
  featured?: boolean | undefined;
  starsCount?: number | undefined;
  runsCount?: number | undefined;
  modelContract: {
    domains: string[];
    minParameters: number;
    minObservables: number;
    parameterSlots: StudyParameterSlot[];
    observableSlots: StudyObservableSlot[];
  };
  inputs: StudyInputField[];
  presets: StudyPreset[];
  execution: {
    supportedTargets: string[];
    defaultTarget: string;
    recommendedSolver: string;
    recommendedProfile: string;
    estimatedCredits: number;
    pipelineSteps: string[];
  };
  outputs: {
    kpis: { id: string; label: string; unit?: string | undefined; expr: string }[];
    views: { kind: string; title: string; xLabel?: string | undefined; yLabel?: string | undefined }[];
  };
}

export interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
  studyDefinition?: StudyDefinitionClient | undefined;
}

export interface ScriptTemplateConfig {
  solver?: string | undefined;
  estimatedDuration?: string | undefined;
  steps?: unknown[] | undefined;
  computeProfile?: string | undefined;
  partitions?: string[] | undefined;
}

export interface UnifiedJobItem {
  id: string | number;
  name: string;
  status: "RUNNING" | "QUEUED" | "SUCCESS" | "FAILED" | "CANCELLED" | string;
  domain: string;
  solver: string;
  profile: string;
  progress: number;
  costCredits?: number | undefined;
  started_at: string;
  completed_at?: string | null | undefined;
  metadata?: string | null | undefined;
  studyKind?: string | undefined;
  standardFormat?: "sedml" | "ssp-ssv" | "dakota" | string | undefined;
  templateSlug?: string | undefined;
  modelName?: string | undefined;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  targetArtifact?: string | null | undefined;
  executionTarget?: string | undefined;
  sampleCount?: number | undefined;
  studyInstanceArtifact?:
    | {
        format: "sedml" | "ssp-ssv" | "dakota" | string;
        fileName: string;
        mimeType: string;
        content: string;
        sha256: string;
      }
    | null
    | undefined;
  kpis?:
    | { id: string; label: string; value: number | string; unit?: string | undefined; status?: string | undefined }[]
    | undefined;
}
