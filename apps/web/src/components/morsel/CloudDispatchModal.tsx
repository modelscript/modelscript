// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { CloudSimulationModal, parseSimulationCsvTrajectory } from "../cloud-sim/CloudSimulationModal";
import { getLanguageExtension } from "./constants";

export { parseSimulationCsvTrajectory as parseCsvResults };

export interface CloudDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelName: string;
  dialect?: string | undefined;
  sourceCode?: string | undefined;
  modelCode?: string | undefined;
  parameterOverrides?: Record<string, number> | undefined;
  experimentConfig?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
        numberOfIntervals?: number | undefined;
        solver?: string | undefined;
        parameterOverrides?: Record<string, number> | undefined;
      }
    | undefined;
  onResultLoaded?: ((data: { t: number[]; y: number[][]; states: string[] }) => void) | undefined;
  onResultsLoaded?: ((data: { t: number[]; y: number[][]; states: string[] }) => void) | undefined;
}

export function CloudDispatchModal({
  isOpen,
  onClose,
  modelName,
  dialect = "modelica",
  sourceCode,
  modelCode,
  parameterOverrides,
  experimentConfig,
  onResultLoaded,
  onResultsLoaded,
}: CloudDispatchModalProps): React.ReactElement | null {
  const ext = getLanguageExtension(dialect);
  const mergedExperimentConfig = experimentConfig
    ? {
        ...experimentConfig,
        parameterOverrides: experimentConfig.parameterOverrides ?? parameterOverrides,
      }
    : parameterOverrides
      ? { parameterOverrides }
      : undefined;

  return (
    <CloudSimulationModal
      isOpen={isOpen}
      onClose={onClose}
      modelName={modelName}
      fileName={modelName ? `${modelName}.${ext}` : undefined}
      fileContent={sourceCode ?? modelCode ?? ""}
      experimentConfig={mergedExperimentConfig as any}
      onResultLoaded={onResultLoaded}
      onResultsLoaded={onResultsLoaded}
    />
  );
}

export default CloudDispatchModal;
