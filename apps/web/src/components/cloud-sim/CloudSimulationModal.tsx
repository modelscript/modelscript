// SPDX-License-Identifier: AGPL-3.0-or-later

import { CloudIcon, DownloadIcon, PlayIcon, SyncIcon, XCircleIcon, XIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import {
  getCloudSimulationResultCsv,
  getCloudSimulationStatus,
  getComputeProfiles,
  getUserWallet,
  submitCloudSimulation,
  type CloudSimulationStatus,
  type ComputeProfileInfo,
  type UserWalletInfo,
} from "../../api";
import { useAuth } from "../../AuthContext";
import Box from "../Box";
import { ProfileSelector } from "./ProfileSelector";
import { SimulationProgressSteps } from "./SimulationProgressSteps";
import { SimulationResultsView } from "./SimulationResultsView";
import { ModalBody, ModalCard, ModalHeader, ModalOverlay } from "./styles";
import type { CloudSimulationModalProps, ParsedCsvData, SimPhase } from "./types";

export interface ExtendedCloudSimulationModalProps extends CloudSimulationModalProps {
  modelName?: string | undefined;
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

export function parseSimulationCsvTrajectory(csvText: string): { t: number[]; y: number[][]; states: string[] } | null {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = (lines[0]?.split(",") || []).map((h) => h.replace(/^["']|["']$/g, "").trim());
  const timeIdx = header.findIndex((h) => h.toLowerCase() === "time");
  const validTimeIdx = timeIdx >= 0 ? timeIdx : 0;

  const t: number[] = [];
  const states = header.filter((_, idx) => idx !== validTimeIdx);
  const y: number[][] = states.map(() => []);

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]?.split(",").map((c) => Number(c.replace(/^["']|["']$/g, "").trim())) || [];
    if (parts.length === header.length) {
      t.push(parts[validTimeIdx] ?? 0);
      let varCounter = 0;
      for (let j = 0; j < parts.length; j++) {
        if (j !== validTimeIdx) {
          y[varCounter]?.push(parts[j] ?? 0);
          varCounter++;
        }
      }
    }
  }
  return { t, y, states };
}

export const CloudSimulationModal: React.FC<ExtendedCloudSimulationModalProps> = ({
  isOpen,
  onClose,
  fileName = "",
  fileContent = "",
  libraryName,
  libraryVersion,
  modelName: explicitModelName,
  experimentConfig,
  onResultLoaded,
  onResultsLoaded,
}) => {
  // Infer model name from explicit prop, content, or filename
  const initialModelName = useMemo(() => {
    if (explicitModelName && explicitModelName.trim().length > 0) {
      return explicitModelName.trim();
    }
    if (fileContent) {
      const modelMatch = fileContent.match(/^\s*(?:model|class|block|package)\s+([a-zA-Z0-9_]+)/m);
      if (modelMatch?.[1]) return modelMatch[1];
    }
    if (fileName) {
      return fileName.replace(/\.[^/.]+$/, "");
    }
    return "Model";
  }, [explicitModelName, fileContent, fileName]);

  const initialIntervals = useMemo(() => {
    if (experimentConfig?.interval && experimentConfig.interval > 0) {
      const startTime = experimentConfig.startTime ?? 0;
      const stopTime = experimentConfig.stopTime ?? 10;
      return Math.max(10, Math.round((stopTime - startTime) / experimentConfig.interval));
    }
    return 500;
  }, [experimentConfig]);

  const [modelName, setModelName] = useState(initialModelName);
  const [numberOfIntervals, setNumberOfIntervals] = useState<number>(initialIntervals);
  const [selectedProfile, setSelectedProfile] = useState<string>("standard");

  const { refreshWallet } = useAuth();
  const [profiles, setProfiles] = useState<ComputeProfileInfo[]>([]);
  const [wallet, setWallet] = useState<UserWalletInfo | null>(null);

  // Job lifecycle states
  const [phase, setPhase] = useState<SimPhase>("config");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CloudSimulationStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Result data
  const [csvContent, setCsvContent] = useState<string | null>(null);

  // Sync initial model name and intervals when props change
  useEffect(() => {
    setModelName(initialModelName);
  }, [initialModelName]);

  useEffect(() => {
    setNumberOfIntervals(initialIntervals);
  }, [initialIntervals]);

  // Load profiles and wallet on open
  useEffect(() => {
    if (!isOpen) return;
    getComputeProfiles().then(setProfiles).catch(console.error);
    getUserWallet().then(setWallet).catch(console.error);
  }, [isOpen]);

  // Elapsed time counter
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (phase === "running" || phase === "submitting") {
      timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [phase]);

  // Status poller
  useEffect(() => {
    if (!jobId || phase !== "running") return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const status = await getCloudSimulationStatus(jobId);
        if (!active) return;
        setJobStatus(status);

        const s = String(status.status || "").toLowerCase();
        if (s === "completed" || s === "success") {
          setPhase("completed");
          void refreshWallet();
          getUserWallet()
            .then(setWallet)
            .catch(() => {});
          // Fetch result CSV
          try {
            const csv = await getCloudSimulationResultCsv(jobId);
            setCsvContent(csv);
            const parsedTrajectory = parseSimulationCsvTrajectory(csv);
            if (parsedTrajectory) {
              onResultLoaded?.(parsedTrajectory);
              onResultsLoaded?.(parsedTrajectory);
            }
          } catch (e) {
            console.error("Failed to retrieve simulation CSV:", e);
          }
        } else if (s === "failed" || s === "cancelled") {
          setPhase("failed");
          setErrorMessage(status.error || "Simulation run failed on cluster.");
          void refreshWallet();
          getUserWallet()
            .then(setWallet)
            .catch(() => {});
        }
      } catch (err: unknown) {
        if (!active) return;
        setPhase("failed");
        setErrorMessage(err instanceof Error ? err.message : "Failed to poll job status.");
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId, phase, onResultLoaded, onResultsLoaded, refreshWallet]);

  // CSV parsing for preview
  const parsedCsv = useMemo<ParsedCsvData | null>(() => {
    if (!csvContent) return null;
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    const headers = lines[0]!.split(",").map((h) => h.replace(/^["']|["']$/g, "").trim());
    const rows = lines.slice(1, 11).map((row) => row.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim()));
    return {
      headers,
      rows,
      totalRows: lines.length - 1,
    };
  }, [csvContent]);

  if (!isOpen) return null;

  const currentProfile = profiles.find((p) => p.id === selectedProfile) || profiles[0];

  const handleLaunch = async () => {
    setPhase("submitting");
    setErrorMessage(null);
    setElapsedSeconds(0);
    setCsvContent(null);

    try {
      const res = await submitCloudSimulation({
        modelName: modelName.trim(),
        modelSource: fileContent || undefined,
        libraryName,
        libraryVersion,
        profile: selectedProfile,
        startTime: experimentConfig?.startTime,
        stopTime: experimentConfig?.stopTime,
        numberOfIntervals,
      });

      setJobId(res.jobId);
      setPhase("running");
      void refreshWallet();
      getUserWallet()
        .then(setWallet)
        .catch(() => {});
    } catch (err: unknown) {
      setPhase("failed");
      const axiosErr = err as {
        response?:
          | {
              status?: number | undefined;
              data?: { message?: string | undefined; error?: string | undefined } | undefined;
            }
          | undefined;
        message?: string | undefined;
      };
      const errData = axiosErr.response?.data;
      if (axiosErr.response?.status === 402) {
        setErrorMessage(
          `Insufficient Compute Credits: ${errData?.message || "Please top up your wallet to burst this workload."}`,
        );
      } else {
        setErrorMessage(errData?.error || axiosErr.message || "Cloud simulation submission failed.");
      }
    }
  };

  const handleDownloadCsv = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${modelName}_res.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <ModalHeader>
          <Box display="flex" alignItems="center" gap={2}>
            <CloudIcon size={20} fill="var(--color-accent-emphasis)" />
            <Text fontWeight="bold" fontSize="16px">
              Run on Cloud HPC
            </Text>
          </Box>
          <Box
            as="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-fg-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <XIcon size={18} />
          </Box>
        </ModalHeader>

        {/* Body */}
        <ModalBody>
          {phase === "config" && (
            <ProfileSelector
              modelName={modelName}
              setModelName={setModelName}
              numberOfIntervals={numberOfIntervals}
              setNumberOfIntervals={setNumberOfIntervals}
              profiles={profiles}
              selectedProfile={selectedProfile}
              setSelectedProfile={setSelectedProfile}
              wallet={wallet}
              currentProfile={currentProfile}
            />
          )}

          {/* Submitting or Running Telemetry */}
          {(phase === "submitting" || phase === "running") && (
            <SimulationProgressSteps
              phase={phase}
              elapsedSeconds={elapsedSeconds}
              selectedProfile={selectedProfile}
              numberOfIntervals={numberOfIntervals}
            />
          )}

          {/* Completed State */}
          {phase === "completed" && <SimulationResultsView jobStatus={jobStatus} parsedCsv={parsedCsv} />}

          {/* Failed State */}
          {phase === "failed" && (
            <Box display="flex" flexDirection="column" gap={3}>
              <Box
                p={3}
                borderRadius="8px"
                bg="rgba(248, 81, 73, 0.1)"
                border="1px solid var(--color-danger-fg)"
                display="flex"
                alignItems="flex-start"
                gap={2}
              >
                <XCircleIcon size={20} fill="var(--color-danger-fg)" style={{ flexShrink: 0, marginTop: "2px" }} />
                <Box>
                  <Text fontWeight="bold" fontSize="14px" color="var(--color-danger-fg)" display="block">
                    Simulation Failed
                  </Text>
                  <Text fontSize="13px" color="var(--color-fg-muted)" style={{ whiteSpace: "pre-wrap" }}>
                    {errorMessage || "An unknown error occurred during execution."}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </ModalBody>

        {/* Footer */}
        <Box
          p={3}
          px={4}
          borderTop="1px solid var(--color-border)"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          bg="var(--surface-overlay, rgba(14, 20, 36, 0.95))"
        >
          {phase === "config" && (
            <>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleLaunch}
                disabled={!modelName.trim()}
                style={{
                  background: "var(--gradient-cta)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "9999px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 0 14px rgba(139, 92, 246, 0.35)",
                  opacity: !modelName.trim() ? 0.6 : 1,
                }}
              >
                <PlayIcon size={16} />
                Launch Simulation
              </button>
            </>
          )}

          {(phase === "submitting" || phase === "running") && (
            <>
              <Text fontSize="12px" color="var(--color-fg-muted)">
                Cluster Job ID: {jobId || "Assigning..."}
              </Text>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                Run in Background
              </button>
            </>
          )}

          {phase === "completed" && (
            <>
              <button
                onClick={() => setPhase("config")}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <SyncIcon size={14} />
                Run Again
              </button>
              <Box display="flex" gap={2}>
                <button
                  onClick={handleDownloadCsv}
                  disabled={!csvContent}
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "9999px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                    color: "var(--color-text-primary)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <DownloadIcon size={14} />
                  Download CSV
                </button>
                <button
                  onClick={onClose}
                  style={{
                    background: "var(--color-accent-emphasis)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </Box>
            </>
          )}

          {phase === "failed" && (
            <>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                Close
              </button>
              <button
                onClick={() => setPhase("config")}
                style={{
                  background: "var(--color-accent-emphasis)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "9999px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Adjust Settings & Retry
              </button>
            </>
          )}
        </Box>
      </ModalCard>
    </ModalOverlay>
  );
};

export default CloudSimulationModal;
