// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CloudSimulationModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName?: string | undefined;
  fileContent?: string | undefined;
  libraryName?: string | undefined;
  libraryVersion?: string | undefined;
}

export type SimPhase = "config" | "submitting" | "running" | "completed" | "failed";

export interface ParsedCsvData {
  headers: string[];
  rows: string[][];
  totalRows: number;
}
