// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CloudSimulationModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName?: string | undefined;
  fileContent?: string | undefined;
  libraryName?: string | undefined;
  libraryVersion?: string | undefined;
  artifactId?: number | string | undefined;
  artifactTitle?: string | undefined;
  dialect?: string | undefined;
  initialTemplateSlug?: string | undefined;
  initialStep?: "template" | "artifact" | "options" | "compute" | undefined;
}

export type WizardStepId = "template" | "artifact" | "options" | "compute";

export type SimPhase = "config" | "submitting" | "running" | "completed" | "failed";

export interface ParsedCsvData {
  headers: string[];
  rows: string[][];
  totalRows: number;
  trajectory?: {
    t: number[];
    y: number[][];
    states: string[];
  } | null;
}
