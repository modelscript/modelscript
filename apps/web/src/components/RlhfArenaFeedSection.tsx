// SPDX-License-Identifier: AGPL-3.0-or-later

import { BeakerIcon, PlusIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { RlhfArenaCard, type RlhfArenaCardCandidate, type RlhfArenaCardProps } from "./RlhfArenaCard";

type ChallengeType = RlhfArenaCardProps["challengeType"];

interface RlhfChallengeApiItem {
  id: number;
  postId?: number | null | undefined;
  createdBy?: number | undefined;
  challengeType: ChallengeType;
  dialect: string;
  title: string;
  prompt: string;
  deltaTTrigger?: number | null | undefined;
  status?: string | undefined;
  annotationCount: number;
  candidates: RlhfArenaCardCandidate[];
  createdAt?: string | undefined;
}

interface CandidateDraft {
  label: string;
  code: string;
}

const CHALLENGE_TYPE_FILTERS: { id: "all" | ChallengeType; label: string }[] = [
  { id: "all", label: "All Types" },
  { id: "pairwise_arena", label: "Pairwise Arena" },
  { id: "fix_it_bounty", label: "Fix-It Bounty" },
  { id: "tolerance_labeling", label: "Tolerance Labeling" },
];

const DIALECT_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All Dialects" },
  { id: "modelica", label: "Modelica" },
  { id: "sysml2", label: "SysML v2" },
  { id: "scad", label: "OpenSCAD" },
  { id: "spice", label: "SPICE" },
  { id: "psse", label: "PSS/E" },
  { id: "owl2", label: "OWL 2" },
  { id: "ampl", label: "AMPL" },
  { id: "urdf", label: "URDF" },
];

const MODAL_DIALECT_OPTIONS = [
  { id: "modelica", label: "Modelica (.mo)" },
  { id: "sysml2", label: "SysML v2 (.sysml)" },
  { id: "scad", label: "OpenSCAD (.scad)" },
  { id: "spice", label: "SPICE (.cir)" },
  { id: "psse", label: "PSS/E (.raw)" },
  { id: "owl2", label: "OWL 2 (.owl)" },
  { id: "ampl", label: "AMPL (.mod)" },
  { id: "urdf", label: "URDF (.urdf)" },
  { id: "epanet", label: "EPANET (.inp)" },
  { id: "verilog", label: "Verilog (.v)" },
  { id: "vhdl", label: "VHDL (.vhd)" },
  { id: "sbml", label: "SBML (.xml)" },
  { id: "cantera", label: "Cantera (.yaml)" },
];

const SectionRoot = styled.section`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
`;

const HeaderBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-border, rgba(56, 189, 248, 0.25));
  background: var(--surface-card, var(--color-bg-secondary, rgba(13, 17, 23, 0.72)));
`;

const HeaderTitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
`;

const HeaderTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-heading, var(--ms-text-1, #f8fafc));
`;

const HeaderSubtitle = styled.p`
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--color-text-muted, var(--ms-text-2, #94a3b8));
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const PrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.5);
  background: linear-gradient(135deg, #0284c7, #6366f1);
  color: #ffffff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s ease;

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const SubtleButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  border-radius: 999px;
  border: 1px solid var(--color-border, rgba(148, 163, 184, 0.28));
  background: transparent;
  color: var(--color-text-primary, var(--ms-text-1, #e2e8f0));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--surface-row-hover, rgba(148, 163, 184, 0.1));
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const FilterStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ChipRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const FilterLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, #94a3b8);
  margin-right: 4px;
  white-space: nowrap;
`;

const FilterChip = styled.button<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid
    ${(p) => (p.$active ? "rgba(56, 189, 248, 0.65)" : "var(--color-border, rgba(148, 163, 184, 0.25))")};
  background: ${(p) => (p.$active ? "rgba(56, 189, 248, 0.16)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--color-text-muted, #94a3b8)")};
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;

  &:hover {
    border-color: rgba(56, 189, 248, 0.55);
    color: var(--color-text-heading, #f8fafc);
  }
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const StatusBanner = styled.div<{ $tone?: "info" | "error" | "success" }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  border: 1px solid
    ${(p) =>
      p.$tone === "error"
        ? "rgba(248, 113, 113, 0.45)"
        : p.$tone === "success"
          ? "rgba(52, 211, 153, 0.45)"
          : "rgba(56, 189, 248, 0.35)"};
  background: ${(p) =>
    p.$tone === "error"
      ? "rgba(248, 113, 113, 0.1)"
      : p.$tone === "success"
        ? "rgba(52, 211, 153, 0.1)"
        : "rgba(56, 189, 248, 0.08)"};
  color: ${(p) => (p.$tone === "error" ? "#fca5a5" : p.$tone === "success" ? "#6ee7b7" : "var(--color-text-primary)")};
`;

const EmptyBox = styled.div`
  padding: 36px 20px;
  border-radius: 12px;
  border: 1px dashed var(--color-border, rgba(148, 163, 184, 0.3));
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--color-text-muted, #94a3b8);
  font-size: 13px;
`;

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

const ModalDialog = styled.div`
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 14px;
  border: 1px solid var(--color-border, rgba(56, 189, 248, 0.3));
  background: var(--color-bg-primary, #0d1117);
  color: var(--color-text-primary, #e6edf3);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border, #30363d);
`;

const ModalForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px 18px;
`;

const FieldGroup = styled.label`
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-heading, #e6edf3);
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
`;

const TextInput = styled.input`
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #30363d);
  background: var(--color-bg-secondary, #161b22);
  color: var(--color-text-primary, #e6edf3);
  font-size: 13px;
  font-family: inherit;
`;

const SelectInput = styled.select`
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #30363d);
  background: var(--color-bg-secondary, #161b22);
  color: var(--color-text-primary, #e6edf3);
  font-size: 13px;
  font-family: inherit;
`;

const TextArea = styled.textarea<{ $mono?: boolean | undefined }>`
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #30363d);
  background: var(--color-bg-secondary, #161b22);
  color: var(--color-text-primary, #e6edf3);
  font-size: ${(p) => (p.$mono ? "12px" : "13px")};
  font-family: ${(p) => (p.$mono ? "var(--font-mono, ui-monospace, monospace)" : "inherit")};
  resize: vertical;
  min-height: 76px;
`;

const ModalFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border, #30363d);
`;

const DEFAULT_CANDIDATES: CandidateDraft[] = [
  {
    label: "A",
    code: "model CandidateA\n  parameter Real R = 100;\n  Real v;\nequation\n  v = R * 0.5;\nend CandidateA;",
  },
  {
    label: "B",
    code: 'model CandidateB\n  parameter Real R(unit="Ohm") = 100.0;\n  Real v(unit="V");\nequation\n  v = R * 0.5;\nend CandidateB;',
  },
];

export const RlhfArenaFeedSection: React.FC = () => {
  const { user, token } = useAuth();
  const [challenges, setChallenges] = useState<RlhfChallengeApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<"all" | ChallengeType>("all");
  const [selectedDialect, setSelectedDialect] = useState<string>("all");
  const [recentlyCreated, setRecentlyCreated] = useState<{ id: number; title: string } | null>(null);

  // Create RLHF Challenge modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formType, setFormType] = useState<ChallengeType>("pairwise_arena");
  const [formDialect, setFormDialect] = useState<string>("modelica");
  const [formTitle, setFormTitle] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formSourceCode, setFormSourceCode] = useState("");
  const [formDeltaT, setFormDeltaT] = useState("");
  const [formCandidates, setFormCandidates] = useState<CandidateDraft[]>(DEFAULT_CANDIDATES);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const fetchChallenges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (selectedType !== "all") {
        params.set("challengeType", selectedType);
      }
      if (selectedDialect !== "all") {
        params.set("dialect", selectedDialect);
      }
      const res = await fetch(`/api/v1/rlhf/challenges?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: authHeaders,
      });
      const data = (await res.json()) as { challenges?: RlhfChallengeApiItem[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Failed to load RLHF challenges (HTTP ${res.status})`);
      }
      setChallenges(Array.isArray(data.challenges) ? data.challenges : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load RLHF Arena challenges.");
    } finally {
      setLoading(false);
    }
  }, [selectedType, selectedDialect, authHeaders]);

  useEffect(() => {
    void fetchChallenges();
  }, [fetchChallenges]);

  useEffect(() => {
    if (!isCreateOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsCreateOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCreateOpen]);

  const handleOpenCreateModal = () => {
    setFormError(null);
    setIsCreateOpen(true);
  };

  const handleAddCandidate = () => {
    setFormCandidates((prev) => {
      const nextLabel = String.fromCharCode(65 + prev.length);
      return [...prev, { label: nextLabel, code: "" }];
    });
  };

  const handleRemoveCandidate = (idx: number) => {
    setFormCandidates((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const handleUpdateCandidate = (idx: number, patch: Partial<CandidateDraft>) => {
    setFormCandidates((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const handleSubmitChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedTitle = formTitle.trim();
    const trimmedPrompt = formPrompt.trim();
    if (!trimmedTitle || !trimmedPrompt) {
      setFormError("Both title and prompt are required.");
      return;
    }

    if (formType === "pairwise_arena") {
      const validCands = formCandidates.filter((c) => c.code.trim().length > 0);
      if (validCands.length < 2) {
        setFormError("Pairwise Arena challenges require code for at least 2 candidates.");
        return;
      }
    }

    const parsedDeltaT = formDeltaT.trim() ? Number(formDeltaT.trim()) : undefined;
    if (formDeltaT.trim() && (parsedDeltaT === undefined || !Number.isFinite(parsedDeltaT))) {
      setFormError("Δ_t trigger must be a valid number.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        challengeType: formType,
        dialect: formDialect,
        title: trimmedTitle,
        prompt: trimmedPrompt,
      };
      if (parsedDeltaT !== undefined) {
        payload["deltaTTrigger"] = parsedDeltaT;
      }
      if (formType === "pairwise_arena") {
        payload["candidates"] = formCandidates
          .filter((c) => c.code.trim().length > 0)
          .map((c, idx) => ({
            label: c.label.trim() || String.fromCharCode(65 + idx),
            code: c.code,
            dialect: formDialect,
          }));
      } else if (formSourceCode.trim()) {
        payload["sourceCode"] = formSourceCode;
      }

      const res = await fetch("/api/v1/rlhf/challenges", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { id?: number; title?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Failed to create challenge (HTTP ${res.status})`);
      }

      setIsCreateOpen(false);
      setFormTitle("");
      setFormPrompt("");
      setFormSourceCode("");
      setFormDeltaT("");
      setFormCandidates(DEFAULT_CANDIDATES);
      if (typeof data.id === "number") {
        setRecentlyCreated({ id: data.id, title: data.title || trimmedTitle });
      }
      if (selectedType !== "all" && selectedType !== formType) {
        setSelectedType("all");
      }
      if (selectedDialect !== "all" && selectedDialect !== formDialect) {
        setSelectedDialect("all");
      }
      await fetchChallenges();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to publish RLHF challenge.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SectionRoot data-testid="rlhf-arena-feed-section">
      <HeaderBar>
        <HeaderTitleGroup>
          <HeaderTitle>
            <BeakerIcon size={17} />
            <span>Social RLHF Arena</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono, monospace)",
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(56, 189, 248, 0.14)",
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.35)",
              }}
            >
              {challenges.length} open
            </span>
          </HeaderTitle>
          <HeaderSubtitle>
            Verify pairwise model candidates, solve 4-gate Fix-It bounties, and lock invariant <code>group_id</code>{" "}
            zonotope tolerances across ModelScript dialects.
          </HeaderSubtitle>
        </HeaderTitleGroup>
        <HeaderActions>
          <SubtleButton type="button" onClick={() => void fetchChallenges()} disabled={loading}>
            <SyncIcon size={13} />
            <span>Refresh</span>
          </SubtleButton>
          <PrimaryButton type="button" data-testid="create-rlhf-challenge-btn" onClick={handleOpenCreateModal}>
            <PlusIcon size={14} />
            <span>Create RLHF Challenge</span>
          </PrimaryButton>
        </HeaderActions>
      </HeaderBar>

      <FilterStack>
        <ChipRow role="group" aria-label="Filter by challenge type">
          <FilterLabel>Type</FilterLabel>
          {CHALLENGE_TYPE_FILTERS.map((chip) => (
            <FilterChip
              key={chip.id}
              type="button"
              $active={selectedType === chip.id}
              aria-pressed={selectedType === chip.id}
              onClick={() => setSelectedType(chip.id)}
            >
              {chip.label}
            </FilterChip>
          ))}
        </ChipRow>

        <ChipRow role="group" aria-label="Filter by engineering dialect">
          <FilterLabel>Dialect</FilterLabel>
          {DIALECT_FILTERS.map((chip) => (
            <FilterChip
              key={chip.id}
              type="button"
              $active={selectedDialect === chip.id}
              aria-pressed={selectedDialect === chip.id}
              onClick={() => setSelectedDialect(chip.id)}
            >
              {chip.label}
            </FilterChip>
          ))}
        </ChipRow>
      </FilterStack>

      {recentlyCreated && (
        <StatusBanner $tone="success" role="status">
          <span>
            Published RLHF challenge <strong>{recentlyCreated.title}</strong> with 4-gate verification.
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link
              to={`/annotate/${recentlyCreated.id}`}
              style={{ color: "#34d399", fontWeight: 600, textDecoration: "underline" }}
            >
              Open Annotator →
            </Link>
            <button
              type="button"
              aria-label="Dismiss confirmation"
              onClick={() => setRecentlyCreated(null)}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 2 }}
            >
              <XIcon size={14} />
            </button>
          </div>
        </StatusBanner>
      )}

      {error && (
        <StatusBanner $tone="error" role="alert">
          <span>{error}</span>
          <SubtleButton type="button" onClick={() => void fetchChallenges()}>
            Retry
          </SubtleButton>
        </StatusBanner>
      )}

      {loading ? (
        <EmptyBox>Loading RLHF Arena challenges…</EmptyBox>
      ) : challenges.length === 0 ? (
        <EmptyBox>
          <div>
            No open RLHF challenges match <strong>{selectedType === "all" ? "all types" : selectedType}</strong> /{" "}
            <strong>{selectedDialect === "all" ? "all dialects" : selectedDialect}</strong>.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {(selectedType !== "all" || selectedDialect !== "all") && (
              <SubtleButton
                type="button"
                onClick={() => {
                  setSelectedType("all");
                  setSelectedDialect("all");
                }}
              >
                Clear filters
              </SubtleButton>
            )}
            <PrimaryButton type="button" onClick={handleOpenCreateModal}>
              <PlusIcon size={14} />
              <span>Create the first challenge</span>
            </PrimaryButton>
          </div>
        </EmptyBox>
      ) : (
        <CardList>
          {challenges.map((ch) => (
            <RlhfArenaCard
              key={ch.id}
              id={ch.id}
              challengeType={ch.challengeType}
              dialect={ch.dialect}
              title={ch.title}
              prompt={ch.prompt}
              deltaTTrigger={ch.deltaTTrigger}
              annotationCount={ch.annotationCount}
              candidates={ch.candidates}
            />
          ))}
        </CardList>
      )}

      {isCreateOpen && (
        <ModalBackdrop
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCreateOpen(false);
          }}
        >
          <ModalDialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-rlhf-modal-title"
            data-testid="create-rlhf-challenge-modal"
          >
            <ModalHeader>
              <div>
                <h3 id="create-rlhf-modal-title" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                  Create RLHF Challenge
                </h3>
                <div style={{ fontSize: 12, color: "var(--color-text-muted, #8b949e)", marginTop: 2 }}>
                  Automatically compiles 4-column hypergraph <code>m_init</code> &amp; 4-gate formal badges.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setIsCreateOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                }}
              >
                <XIcon size={16} />
              </button>
            </ModalHeader>

            <ModalForm onSubmit={(e) => void handleSubmitChallenge(e)}>
              {!user && (
                <StatusBanner $tone="info">
                  <span>Sign in to publish new RLHF challenges to the Arena.</span>
                  <Link to="/login" style={{ color: "#38bdf8", fontWeight: 600 }}>
                    Sign in →
                  </Link>
                </StatusBanner>
              )}

              {formError && <StatusBanner $tone="error">{formError}</StatusBanner>}

              <FieldRow>
                <FieldGroup>
                  <span>Challenge Type</span>
                  <SelectInput value={formType} onChange={(e) => setFormType(e.target.value as ChallengeType)}>
                    <option value="pairwise_arena">RLHF Pairwise Arena (A vs B)</option>
                    <option value="fix_it_bounty">Verified Fix-It Bounty</option>
                    <option value="tolerance_labeling">Zonotope Tolerance Labeling</option>
                  </SelectInput>
                </FieldGroup>

                <FieldGroup>
                  <span>Dialect</span>
                  <SelectInput value={formDialect} onChange={(e) => setFormDialect(e.target.value)}>
                    {MODAL_DIALECT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </SelectInput>
                </FieldGroup>

                <FieldGroup>
                  <span>Δ_t Trigger (optional)</span>
                  <TextInput
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 0.49"
                    value={formDeltaT}
                    onChange={(e) => setFormDeltaT(e.target.value)}
                  />
                </FieldGroup>
              </FieldRow>

              <FieldGroup>
                <span>Title</span>
                <TextInput
                  type="text"
                  required
                  placeholder="e.g. SI-consistent RC thermal damping filter"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </FieldGroup>

              <FieldGroup>
                <span>Prompt / Verification Criteria</span>
                <TextArea
                  required
                  placeholder="Describe the physical constraints, manufacturability goals, or tolerance invariants reviewers should verify…"
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                />
              </FieldGroup>

              {formType === "pairwise_arena" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Model Candidates ({formCandidates.length})</span>
                    <SubtleButton type="button" onClick={handleAddCandidate}>
                      <PlusIcon size={12} />
                      <span>Add Candidate</span>
                    </SubtleButton>
                  </div>

                  {formCandidates.map((cand, idx) => (
                    <div
                      key={idx}
                      style={{
                        border: "1px solid var(--color-border, #30363d)",
                        borderRadius: 10,
                        padding: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          Candidate {cand.label || String.fromCharCode(65 + idx)}
                        </span>
                        {formCandidates.length > 2 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCandidate(idx)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#f87171",
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <TextArea
                        $mono
                        rows={4}
                        placeholder={`Paste ${formDialect} code for Candidate ${cand.label}…`}
                        value={cand.code}
                        onChange={(e) => handleUpdateCandidate(idx, { code: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <FieldGroup>
                  <span>
                    {formType === "fix_it_bounty"
                      ? "Broken Source Code to Repair"
                      : "Source Code for Relational group_id / Tolerance Labeling"}
                  </span>
                  <TextArea
                    $mono
                    rows={6}
                    placeholder={`Paste ${formDialect} source code…`}
                    value={formSourceCode}
                    onChange={(e) => setFormSourceCode(e.target.value)}
                  />
                </FieldGroup>
              )}

              <ModalFooter>
                <SubtleButton type="button" onClick={() => setIsCreateOpen(false)} disabled={submitting}>
                  Cancel
                </SubtleButton>
                <PrimaryButton type="submit" disabled={submitting || !user}>
                  {submitting ? "Publishing…" : "Publish RLHF Challenge"}
                </PrimaryButton>
              </ModalFooter>
            </ModalForm>
          </ModalDialog>
        </ModalBackdrop>
      )}
    </SectionRoot>
  );
};

export default RlhfArenaFeedSection;
