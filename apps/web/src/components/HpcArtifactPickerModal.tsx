// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, CpuIcon, FlameIcon, SearchIcon, ServerIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Dialog, TextInput } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  createArtifactViewFromHpcJob,
  getUserHpcJobs,
  type ArtifactViewFromJobResult,
  type HpcJobSummary,
} from "../api";
import Box from "./Box";

const FilterPills = styled.div`
  display: flex;
  gap: 8px;
  padding: 4px 24px 12px 24px;
  overflow-x: auto;
`;

const FilterPill = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "var(--gradient-cta)" : "rgba(255, 255, 255, 0.05)")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-primary)")};
  border: 1px solid ${(props) => (props.$active ? "transparent" : "var(--color-border)")};
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease-in-out;

  &:hover {
    border-color: var(--color-accent-cyan);
  }
`;

const JobListContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 24px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const JobCard = styled.div<{ $selected: boolean }>`
  background: ${(props) => (props.$selected ? "rgba(139, 92, 246, 0.12)" : "rgba(255, 255, 255, 0.02)")};
  border: 1.5px solid ${(props) => (props.$selected ? "var(--color-accent-purple)" : "var(--color-border)")};
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &:hover {
    border-color: var(--color-accent-purple);
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  }
`;

const SolverBadge = styled.span<{ $solver: string }>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: ${(props) =>
    props.$solver === "calculix"
      ? "rgba(6, 182, 212, 0.15)"
      : props.$solver === "su2"
        ? "rgba(139, 92, 246, 0.15)"
        : props.$solver === "openfoam"
          ? "rgba(46, 160, 67, 0.2)"
          : "rgba(210, 153, 34, 0.2)"};
  color: ${(props) =>
    props.$solver === "calculix"
      ? "var(--color-accent-cyan)"
      : props.$solver === "su2"
        ? "var(--color-accent-purple)"
        : props.$solver === "openfoam"
          ? "var(--ms-success)"
          : "#d29922"};
`;

const ProfileChip = styled.span`
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

interface HpcArtifactPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (result: ArtifactViewFromJobResult) => void;
}

export const HpcArtifactPickerModal: React.FC<HpcArtifactPickerModalProps> = ({ isOpen, onClose, onSelect }) => {
  const [jobs, setJobs] = useState<HpcJobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [solverFilter, setSolverFilter] = useState("all");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [colormap, setColormap] = useState<string>("turbo");
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    setAttachError(null);

    getUserHpcJobs(30)
      .then((data) => {
        if (!active) return;
        setJobs(data);
        if (data.length > 0) {
          setSelectedJobId((prev) => (prev === null ? data[0]!.id : prev));
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const axiosErr = err as {
          response?: { status?: number; data?: { error?: string; message?: string } };
          message?: string;
        };
        const status = axiosErr.response?.status;
        if (status === 401 || status === 403) {
          setLoadError("Please sign in to view your completed HPC simulation jobs.");
        } else {
          setLoadError(
            axiosErr.response?.data?.error ||
              axiosErr.response?.data?.message ||
              axiosErr.message ||
              "Failed to load HPC simulation jobs.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, reloadNonce]);

  const filteredJobs = useMemo(() => {
    const q = search.toLowerCase();
    return jobs.filter((j) => {
      const name = (j.name || "").toLowerCase();
      const solver = (j.solver || "").toLowerCase();
      const matchSearch = name.includes(q) || solver.includes(q);
      const matchSolver = solverFilter === "all" || solver === solverFilter.toLowerCase();
      return matchSearch && matchSolver;
    });
  }, [jobs, search, solverFilter]);

  const handleAttach = async () => {
    if (!selectedJobId) return;
    setAttaching(true);
    setAttachError(null);
    try {
      const selectedJob = jobs.find((j) => j.id === selectedJobId);
      const res = await createArtifactViewFromHpcJob(selectedJobId, {
        colormap,
        title: selectedJob?.name,
      });
      onSelect(res);
      onClose();
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
      };
      setAttachError(
        axiosErr.response?.data?.error ||
          axiosErr.response?.data?.message ||
          axiosErr.message ||
          "Failed to attach HPC artifact. Please try again.",
      );
    } finally {
      setAttaching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title={
        <Box display="flex" alignItems="center" gap={2}>
          <ServerIcon size={20} fill="var(--color-accent-emphasis)" />
          <span style={{ fontSize: "17px", fontWeight: "700", color: "var(--color-text-primary)" }}>
            Attach HPC Simulation Artifact
          </span>
        </Box>
      }
      width="large"
      onClose={onClose}
    >
      <Box display="flex" flexDirection="column" maxHeight="75vh" overflow="hidden">
        <Box mb={3}>
          <TextInput
            block
            leadingVisual={SearchIcon}
            placeholder="Search completed simulation runs by name or solver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </Box>

        <FilterPills>
          {["all", "calculix", "su2", "openfoam", "modelica"].map((filter) => (
            <FilterPill
              key={filter}
              type="button"
              $active={solverFilter === filter}
              onClick={() => setSolverFilter(filter)}
            >
              {filter === "all"
                ? "All Solvers"
                : filter === "calculix"
                  ? "CalculiX FEA"
                  : filter === "su2"
                    ? "SU2 CFD"
                    : filter === "openfoam"
                      ? "OpenFOAM"
                      : "Modelica DAE"}
            </FilterPill>
          ))}
        </FilterPills>

        {attachError && (
          <Box
            mx={4}
            mb={2}
            p={2}
            borderRadius="8px"
            bg="rgba(248, 81, 73, 0.1)"
            border="1px solid var(--color-danger-fg, #f85149)"
            color="var(--color-danger-fg, #f85149)"
            fontSize="12.5px"
            role="alert"
          >
            {attachError}
          </Box>
        )}

        <JobListContainer role="listbox" aria-label="Completed HPC simulation jobs">
          {loading ? (
            <Box p={4} display="flex" justifyContent="center" color="var(--color-text-muted)">
              Loading your completed cluster jobs...
            </Box>
          ) : loadError ? (
            <Box
              p={4}
              display="flex"
              flexDirection="column"
              alignItems="center"
              gap={3}
              borderRadius="10px"
              bg="rgba(248, 81, 73, 0.08)"
              border="1px solid var(--color-danger-fg, #f85149)"
              style={{ textAlign: "center" }}
              role="alert"
            >
              <span style={{ fontWeight: "600", fontSize: "14px", color: "var(--color-danger-fg, #f85149)" }}>
                {loadError}
              </span>
              <Button variant="default" size="small" onClick={() => setReloadNonce((n) => n + 1)}>
                Retry
              </Button>
            </Box>
          ) : filteredJobs.length === 0 ? (
            <Box
              p={4}
              display="flex"
              flexDirection="column"
              alignItems="center"
              gap={2}
              color="var(--color-text-muted)"
              style={{ textAlign: "center" }}
            >
              <CpuIcon size={32} />
              <span style={{ fontWeight: "600", fontSize: "14px" }}>No completed HPC simulation jobs found.</span>
              <span style={{ fontSize: "13px" }}>
                Execute a simulation via the CAE Workspace or POST /cae/jobs to produce 3D field artifacts.
              </span>
            </Box>
          ) : (
            filteredJobs.map((job) => {
              const isSelected = selectedJobId === job.id;
              const costCredits = typeof job.costCredits === "number" ? job.costCredits : 0;
              const cpuSeconds = typeof job.cpuSeconds === "number" ? job.cpuSeconds : 0;
              return (
                <JobCard
                  key={job.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  $selected={isSelected}
                  onClick={() => setSelectedJobId(job.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedJobId(job.id);
                    }
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box display="flex" flexDirection="column" gap={1}>
                      <span style={{ fontWeight: "700", fontSize: "14px", color: "var(--color-text-primary)" }}>
                        {job.name}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Job #{job.id} • Completed{" "}
                        {job.completedAt
                          ? new Date(job.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "recently"}
                      </span>
                    </Box>
                    <Box display="flex" gap={2} alignItems="center">
                      <SolverBadge $solver={job.solver || "modelica"}>{job.solver || "solver"}</SolverBadge>
                      {isSelected && <CheckCircleIcon size={18} fill="var(--ms-success)" />}
                    </Box>
                  </Box>

                  {/* Badges & Metrics Row */}
                  <Box display="flex" flexWrap="wrap" gap={2} alignItems="center">
                    <ProfileChip>
                      <CpuIcon size={12} /> {job.computeProfile || "standard"}
                    </ProfileChip>
                    <ProfileChip>
                      <ZapIcon size={12} /> {costCredits.toFixed(2)} credits
                    </ProfileChip>
                    {cpuSeconds > 0 && <ProfileChip>⏱ {cpuSeconds.toFixed(1)}s wall clock</ProfileChip>}
                    {job.hasVtu && (
                      <ProfileChip style={{ color: "var(--ms-success)", borderColor: "rgba(63, 185, 80, 0.3)" }}>
                        <FlameIcon size={12} /> 3D VTU Ready
                      </ProfileChip>
                    )}
                  </Box>

                  {/* Scalar KPIs if available */}
                  {job.scalars && Object.keys(job.scalars).length > 0 && (
                    <Box
                      p={2}
                      bg="rgba(255, 255, 255, 0.03)"
                      border="1px solid var(--color-border)"
                      borderRadius="6px"
                      fontSize="12px"
                      display="flex"
                      gap={3}
                      flexWrap="wrap"
                      color="var(--color-text-muted)"
                    >
                      {Object.entries(job.scalars)
                        .slice(0, 4)
                        .map(([k, v]) => (
                          <span key={k}>
                            <strong>{k}:</strong> {typeof v === "number" ? v.toFixed(3) : String(v)}
                          </span>
                        ))}
                    </Box>
                  )}
                </JobCard>
              );
            })
          )}
        </JobListContainer>

        {/* Modal Footer */}
        <Box
          pt={3}
          mt={2}
          borderTop="1px solid var(--ms-border-subtle, var(--color-border))"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: "600" }}>Colormap:</span>
            <select
              value={colormap}
              onChange={(e) => setColormap(e.target.value)}
              style={{
                background: "var(--ms-surface-subtle, rgba(255, 255, 255, 0.05))",
                color: "var(--color-text-primary)",
                border: "1px solid var(--ms-border-default, var(--color-border))",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "12px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="turbo">Turbo (Recommended)</option>
              <option value="viridis">Viridis</option>
              <option value="plasma">Plasma</option>
              <option value="coolwarm">Coolwarm (Thermal)</option>
              <option value="jet">Jet (Classic Rainbow)</option>
            </select>
          </Box>

          <Box display="flex" gap={2}>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              leadingVisual={ServerIcon}
              disabled={selectedJobId === null || attaching}
              onClick={handleAttach}
            >
              {attaching ? "Binding Artifact..." : "Attach Selected HPC Run"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
};

export default HpcArtifactPickerModal;
