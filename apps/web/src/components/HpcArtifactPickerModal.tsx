// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, CpuIcon, FlameIcon, SearchIcon, ServerIcon, XIcon, ZapIcon } from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  createArtifactViewFromHpcJob,
  getUserHpcJobs,
  type ArtifactViewFromJobResult,
  type HpcJobSummary,
} from "../api";
import Box from "./Box";

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

const ModalContent = styled.div`
  background: var(--color-canvas-default);
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  width: 100%;
  max-width: 680px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const SearchInputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 9999px;
  margin: 16px 24px 8px 24px;
`;

const StyledInput = styled.input`
  background: transparent;
  border: none;
  outline: none;
  width: 100%;
  color: var(--color-text-primary);
  font-size: 14px;
`;

const FilterPills = styled.div`
  display: flex;
  gap: 8px;
  padding: 4px 24px 12px 24px;
  overflow-x: auto;
`;

const FilterPill = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "var(--color-accent-emphasis)" : "var(--color-canvas-subtle)")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-primary)")};
  border: 1px solid ${(props) => (props.$active ? "var(--color-accent-emphasis)" : "var(--color-border-default)")};
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease-in-out;

  &:hover {
    border-color: var(--color-accent-emphasis);
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
  background: ${(props) => (props.$selected ? "var(--color-canvas-subtle)" : "var(--color-canvas-default)")};
  border: 1.5px solid ${(props) => (props.$selected ? "var(--color-accent-emphasis)" : "var(--color-border-subtle)")};
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &:hover {
    border-color: var(--color-accent-emphasis);
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
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
      ? "rgba(31, 111, 235, 0.2)"
      : props.$solver === "su2"
        ? "rgba(137, 87, 229, 0.2)"
        : props.$solver === "openfoam"
          ? "rgba(46, 160, 67, 0.2)"
          : "rgba(210, 153, 34, 0.2)"};
  color: ${(props) =>
    props.$solver === "calculix"
      ? "#58a6ff"
      : props.$solver === "su2"
        ? "#bc8cff"
        : props.$solver === "openfoam"
          ? "#3fb950"
          : "#d29922"};
`;

const ProfileChip = styled.span`
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--color-canvas-subtle);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const AttachButton = styled.button`
  background: var(--color-accent-emphasis);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background-color 0.15s ease-in-out;

  &:hover:not(:disabled) {
    background: var(--color-accent-fg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface HpcArtifactPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (result: ArtifactViewFromJobResult) => void;
}

export const HpcArtifactPickerModal: React.FC<HpcArtifactPickerModalProps> = ({ isOpen, onClose, onSelect }) => {
  const [jobs, setJobs] = useState<HpcJobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [solverFilter, setSolverFilter] = useState("all");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [colormap, setColormap] = useState<string>("turbo");
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getUserHpcJobs(30)
        .then((data) => {
          setJobs(data);
          if (data.length > 0) {
            setSelectedJobId((prev) => (prev === null ? data[0].id : prev));
          }
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const matchSearch =
        j.name.toLowerCase().includes(search.toLowerCase()) || j.solver.toLowerCase().includes(search.toLowerCase());
      const matchSolver = solverFilter === "all" || j.solver.toLowerCase() === solverFilter.toLowerCase();
      return matchSearch && matchSolver;
    });
  }, [jobs, search, solverFilter]);

  const handleAttach = async () => {
    if (!selectedJobId) return;
    setAttaching(true);
    try {
      const selectedJob = jobs.find((j) => j.id === selectedJobId);
      const res = await createArtifactViewFromHpcJob(selectedJobId, {
        colormap,
        title: selectedJob?.name,
      });
      onSelect(res);
      onClose();
    } catch (err) {
      console.error("Failed to attach HPC artifact:", err);
    } finally {
      setAttaching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Box display="flex" alignItems="center" gap={2}>
            <ServerIcon size={20} fill="var(--color-accent-emphasis)" />
            <span style={{ fontSize: "17px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              Attach HPC Simulation Artifact
            </span>
          </Box>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <XIcon size={18} />
          </button>
        </ModalHeader>

        <SearchInputWrapper>
          <SearchIcon size={16} fill="var(--color-text-muted)" />
          <StyledInput
            placeholder="Search completed simulation runs by name or solver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </SearchInputWrapper>

        <FilterPills>
          {["all", "calculix", "su2", "openfoam", "modelica"].map((filter) => (
            <FilterPill key={filter} $active={solverFilter === filter} onClick={() => setSolverFilter(filter)}>
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

        <JobListContainer>
          {loading ? (
            <Box p={4} display="flex" justifyContent="center" color="var(--color-text-muted)">
              Loading your completed cluster jobs...
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
              return (
                <JobCard key={job.id} $selected={isSelected} onClick={() => setSelectedJobId(job.id)}>
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
                      <SolverBadge $solver={job.solver}>{job.solver}</SolverBadge>
                      {isSelected && <CheckCircleIcon size={18} fill="#3fb950" />}
                    </Box>
                  </Box>

                  {/* Badges & Metrics Row */}
                  <Box display="flex" flexWrap="wrap" gap={2} alignItems="center">
                    <ProfileChip>
                      <CpuIcon size={12} /> {job.computeProfile}
                    </ProfileChip>
                    <ProfileChip>
                      <ZapIcon size={12} /> {job.costCredits.toFixed(2)} credits
                    </ProfileChip>
                    {job.cpuSeconds > 0 && <ProfileChip>⏱ {job.cpuSeconds.toFixed(1)}s wall clock</ProfileChip>}
                    {job.hasVtu && (
                      <ProfileChip style={{ color: "#3fb950", borderColor: "rgba(63, 185, 80, 0.3)" }}>
                        <FlameIcon size={12} /> 3D VTU Ready
                      </ProfileChip>
                    )}
                  </Box>

                  {/* Scalar KPIs if available */}
                  {job.scalars && Object.keys(job.scalars).length > 0 && (
                    <Box
                      p={2}
                      bg="var(--color-canvas-subtle)"
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
          p={3}
          px={4}
          borderTop="1px solid var(--color-border-default)"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          bg="var(--color-canvas-subtle)"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: "600" }}>Colormap:</span>
            <select
              value={colormap}
              onChange={(e) => setColormap(e.target.value)}
              style={{
                background: "var(--color-canvas-default)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border-default)",
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
              Cancel
            </button>
            <AttachButton disabled={selectedJobId === null || attaching} onClick={handleAttach}>
              <ServerIcon size={16} />
              {attaching ? "Binding Artifact..." : "Attach Selected HPC Run"}
            </AttachButton>
          </Box>
        </Box>
      </ModalContent>
    </ModalOverlay>
  );
};

export default HpcArtifactPickerModal;
