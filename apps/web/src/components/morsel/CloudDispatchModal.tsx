// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { CloudSimulationModal, parseSimulationCsvTrajectory } from "../cloud-sim/CloudSimulationModal";

export { parseSimulationCsvTrajectory as parseCsvResults };

export interface CloudDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelName: string;
  sourceCode?: string | undefined;
  modelCode?: string | undefined;
  experimentConfig?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
      }
    | undefined;
  onResultLoaded?: ((data: { t: number[]; y: number[][]; states: string[] }) => void) | undefined;
  onResultsLoaded?: ((data: { t: number[]; y: number[][]; states: string[] }) => void) | undefined;
}

export function CloudDispatchModal({
  isOpen,
  onClose,
  modelName,
  sourceCode,
  modelCode,
  experimentConfig,
  onResultLoaded,
  onResultsLoaded,
}: CloudDispatchModalProps): React.ReactElement | null {
  return (
    <CloudSimulationModal
      isOpen={isOpen}
      onClose={onClose}
      modelName={modelName}
      fileName={modelName ? `${modelName}.mo` : undefined}
      fileContent={sourceCode ?? modelCode ?? ""}
      experimentConfig={experimentConfig}
      onResultLoaded={onResultLoaded}
      onResultsLoaded={onResultsLoaded}
    />
  );
}

export default CloudDispatchModal;
