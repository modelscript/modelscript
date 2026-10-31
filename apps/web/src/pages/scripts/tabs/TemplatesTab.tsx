// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  BeakerIcon,
  CheckCircleFillIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  StarFillIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useMemo, useState } from "react";
import { createStudyTemplate } from "../../../api";
import Box from "../../../components/Box";
import { BUILTIN_HPC_TEMPLATES } from "../../../components/cloud-sim/hpcTemplates";
import { safeJsonParse } from "../../../util/json";
import type { ScriptTemplate, StudyDefinitionClient } from "../types";
import { categoryIcon } from "../utils";

export interface TemplatesTabProps {
  groupedTemplates: Record<string, ScriptTemplate[]>;
  onSelectTemplate: (templateIdOrSlug: number | string) => void;
  onLaunchWizard?: (templateSlug: string) => void;
  onTemplateCreated?: () => void;
}

interface GalleryStudyItem {
  id: number | string;
  slug: string;
  name: string;
  version: string;
  standardFormat: "sedml" | "ssp-ssv" | "dakota";
  kind: string;
  category: string;
  sourceType: "official" | "package" | "community" | string;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  artifactPath?: string | null | undefined;
  authorUsername: string;
  description: string;
  icon: string;
  accentColor: string;
  domains: string[];
  supportedTargets: string[];
  recommendedSolver: string;
  recommendedProfile: string;
  estimatedCredits: number;
  steps: string[];
  kpis: string[];
  views: string[];
  tags: string[];
  featured: boolean;
  starsCount: number;
  runsCount: number;
}

const STANDARD_BADGES: Record<
  "sedml" | "ssp-ssv" | "dakota",
  { label: string; ext: string; color: string; bg: string }
> = {
  sedml: {
    label: "SED-ML L1V4 (.sedml)",
    ext: ".sedml",
    color: "#38bdf8",
    bg: "rgba(56, 189, 248, 0.14)",
  },
  "ssp-ssv": {
    label: "ASAM SSP 2.0 (.ssv)",
    ext: ".ssv",
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.14)",
  },
  dakota: {
    label: "Sandia Dakota (.dakota)",
    ext: ".dakota",
    color: "#fb923c",
    bg: "rgba(251, 146, 60, 0.14)",
  },
};

const POPULAR_LANGUAGE_GALLERY_TABS: {
  id: string;
  label: string;
  extHint: string;
  matchDomains: string[];
}[] = [
  { id: "all", label: "All Languages", extHint: "43 langs", matchDomains: [] },
  { id: "modelica", label: "Modelica", extHint: ".mo", matchDomains: ["modelica"] },
  {
    id: "spice",
    label: "SPICE & Verilog/VHDL-AMS",
    extHint: ".cir / .vams",
    matchDomains: ["spice", "verilog-ams", "vhdl-ams"],
  },
  { id: "sysmlv2", label: "SysML v2", extHint: ".sysml", matchDomains: ["sysmlv2", "ssp"] },
  { id: "pscad", label: "PSCAD EMT", extHint: ".pscx", matchDomains: ["pscad"] },
  { id: "gensys", label: "GENSYS & SIMPACK", extHint: ".gensys / .spck", matchDomains: ["gensys", "simpack"] },
  { id: "cfd", label: "OpenFOAM & SU2 CFD", extHint: ".su2 / .foam", matchDomains: ["cfd", "su2", "openfoam"] },
  { id: "fea", label: "CalculiX FEA", extHint: ".inp", matchDomains: ["fea", "calculix"] },
  { id: "cad", label: "OpenSCAD & STEP CAD", extHint: ".scad / .step", matchDomains: ["cad", "scad", "step"] },
  { id: "fmu", label: "FMI & SSP", extHint: ".fmu / .ssp", matchDomains: ["fmu", "ssp"] },
  { id: "sbml", label: "SBML & CellML", extHint: ".sbml / .cellml", matchDomains: ["sbml", "cellml"] },
  {
    id: "matlab",
    label: "MATLAB, Python & Julia",
    extHint: ".m / .py / .jl",
    matchDomains: ["matlab", "python", "julia"],
  },
  { id: "cpp", label: "C / C++ / Fortran", extHint: ".c / .cpp / .f90", matchDomains: ["c", "cpp", "rust", "fortran"] },
];

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  "time-course": { label: "Transient Time-Course", color: "#3b82f6" },
  "monte-carlo": { label: "Monte Carlo & Sobol UQ", color: "#a855f7" },
  "parameter-sweep": { label: "Parametric DoE Sweep", color: "#06b6d4" },
  optimization: { label: "Design Optimization (Pareto)", color: "#10b981" },
  "multi-objective": { label: "Design Optimization (Pareto)", color: "#10b981" },
  verification: { label: "Standards Verification Audit", color: "#eab308" },
  "steady-state": { label: "Steady-State FEA / CFD", color: "#f97316" },
  "eigen-frequency": { label: "Modal Eigenfrequency", color: "#ec4899" },
  surrogate: { label: "Surrogate / ROM Training", color: "#6366f1" },
  calibration: { label: "SSP Parameter Calibration", color: "#14b8a6" },
};

export const TemplatesTab: React.FC<TemplatesTabProps> = ({
  groupedTemplates,
  onSelectTemplate,
  onLaunchWizard,
  onTemplateCreated,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [selectedStandard, setSelectedStandard] = useState<string>("all");
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [selectedTarget, setSelectedTarget] = useState<string>("all");

  // Author / Publish Study Template modal state
  const [isAuthorModalOpen, setIsAuthorModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newStandard, setNewStandard] = useState<"sedml" | "ssp-ssv" | "dakota">("sedml");
  const [newRawStandardContent, setNewRawStandardContent] = useState("");
  const [newKind, setNewKind] = useState("parameter-sweep");
  const [newCategory, setNewCategory] = useState("sweep");
  const [newPkgName, setNewPkgName] = useState("");
  const [newDomains, setNewDomains] = useState<string[]>(["modelica", "fmu"]);
  const [newTags, setNewTags] = useState("sweep, doe, sed-ml");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const galleryItems = useMemo<GalleryStudyItem[]>(() => {
    const dbTemplatesFlat = Object.values(groupedTemplates).flat();
    const bySlug = new Map<string, GalleryStudyItem>();

    for (const dt of dbTemplatesFlat) {
      const sd = dt.studyDefinition || safeJsonParse<Partial<StudyDefinitionClient>>(dt.config, {});
      const kind =
        sd.kind ||
        (dt.slug.includes("monte-carlo")
          ? "monte-carlo"
          : dt.slug.includes("sweep")
            ? "parameter-sweep"
            : "time-course");
      const kindMeta = KIND_LABELS[kind] || { label: kind, color: "#3b82f6" };
      const stdFormat: "sedml" | "ssp-ssv" | "dakota" =
        sd.standardFormat ||
        (sd.artifactPath?.endsWith(".ssv") || kind === "calibration"
          ? "ssp-ssv"
          : sd.artifactPath?.endsWith(".dakota") ||
              kind === "monte-carlo" ||
              kind === "optimization" ||
              kind === "multi-objective"
            ? "dakota"
            : "sedml");
      const stdExt = STANDARD_BADGES[stdFormat].ext;

      bySlug.set(dt.slug, {
        id: dt.id || dt.slug,
        slug: dt.slug,
        name: dt.name,
        version: sd.version || "1.0.0",
        standardFormat: stdFormat,
        kind,
        category: sd.category || dt.category || "simulation",
        sourceType: sd.sourceType || "official",
        packageName: sd.packageName || null,
        packageVersion: sd.packageVersion || null,
        artifactPath: sd.artifactPath
          ? sd.artifactPath.replace(/\.study\.json$/i, stdExt)
          : `studies/${dt.slug}${stdExt}`,
        authorUsername: sd.authorUsername || "modelscript",
        description: dt.description,
        icon: dt.icon || "sliders",
        accentColor: kindMeta.color,
        domains: (sd.modelContract?.domains || ["modelica", "fmu"]).filter((d) => d !== "msx"),
        supportedTargets: sd.execution?.supportedTargets || ["local-wasm", "local-native", "hpc-cluster"],
        recommendedSolver: sd.execution?.recommendedSolver || "modelica",
        recommendedProfile: sd.execution?.recommendedProfile || "standard",
        estimatedCredits: sd.execution?.estimatedCredits ?? 0.35,
        steps: sd.execution?.pipelineSteps || ["Validate Model Contract", "Execute Study Tasks", "Compute KPIs"],
        kpis: (sd.outputs?.kpis || []).map((k) => k.label),
        views: (sd.outputs?.views || []).map((v) => v.title),
        tags: sd.tags || [kind, dt.category],
        featured: Boolean(sd.featured),
        starsCount: sd.starsCount ?? 120,
        runsCount: sd.runsCount ?? 850,
      });
    }

    // Fallback if DB hasn't loaded yet
    if (bySlug.size === 0) {
      for (const bt of BUILTIN_HPC_TEMPLATES) {
        const kind =
          bt.domain === "monte-carlo"
            ? "monte-carlo"
            : bt.domain === "fea" || bt.domain === "cfd"
              ? "steady-state"
              : "time-course";
        const stdFormat: "sedml" | "ssp-ssv" | "dakota" = kind === "monte-carlo" ? "dakota" : "sedml";
        bySlug.set(bt.slug, {
          id: bt.dbTemplateId ?? bt.slug,
          slug: bt.slug,
          name: bt.name,
          version: "1.2.0",
          standardFormat: stdFormat,
          kind,
          category: bt.category,
          sourceType: "official",
          packageName: "@modelscript/simulate",
          packageVersion: "1.4.0",
          artifactPath: `studies/${bt.slug}${STANDARD_BADGES[stdFormat].ext}`,
          authorUsername: "modelscript",
          description: bt.description,
          icon: bt.icon || "pulse",
          accentColor: bt.accentColor,
          domains: [bt.domain === "monte-carlo" ? "modelica" : bt.domain],
          supportedTargets: ["local-wasm", "local-native", "hpc-cluster"],
          recommendedSolver: bt.solver,
          recommendedProfile: bt.recommendedProfile,
          estimatedCredits: Number(bt.estimatedCredits) || 0.35,
          steps: bt.pipelineSteps.map((s) => s.title),
          kpis: ["Peak Response", "Steady-State Value"],
          views: ["Trajectory Plot"],
          tags: [bt.badge, bt.domain, ...bt.compatibleDialects],
          featured: true,
          starsCount: 180,
          runsCount: 1400,
        });
      }
    }

    return Array.from(bySlug.values());
  }, [groupedTemplates]);

  const counts = useMemo(() => {
    const bySource: Record<string, number> = { all: galleryItems.length, official: 0, package: 0, community: 0 };
    const byStandard: Record<string, number> = { all: galleryItems.length, sedml: 0, "ssp-ssv": 0, dakota: 0 };
    const byKind: Record<string, number> = { all: galleryItems.length };
    for (const item of galleryItems) {
      bySource[item.sourceType] = (bySource[item.sourceType] || 0) + 1;
      byStandard[item.standardFormat] = (byStandard[item.standardFormat] || 0) + 1;
      byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    }
    return { bySource, byStandard, byKind };
  }, [galleryItems]);

  const filteredItems = useMemo(() => {
    const langTab = POPULAR_LANGUAGE_GALLERY_TABS.find((lt) => lt.id === selectedDomain);
    return galleryItems.filter((item) => {
      if (selectedSource !== "all" && item.sourceType !== selectedSource) return false;
      if (selectedStandard !== "all" && item.standardFormat !== selectedStandard) return false;
      if (selectedKind !== "all" && item.kind !== selectedKind) return false;
      if (selectedDomain !== "all") {
        const candidateDomains = langTab && langTab.matchDomains.length > 0 ? langTab.matchDomains : [selectedDomain];
        if (!candidateDomains.some((cd) => item.domains.includes(cd))) return false;
      }
      if (selectedTarget !== "all" && !item.supportedTargets.includes(selectedTarget)) return false;

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const hay = [
          item.name,
          item.slug,
          item.description,
          item.kind,
          item.category,
          item.standardFormat,
          item.packageName || "",
          item.authorUsername,
          ...item.domains,
          ...item.tags,
          ...item.kpis,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [galleryItems, selectedSource, selectedStandard, selectedKind, selectedDomain, selectedTarget, searchQuery]);

  const handlePublishTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() && !newRawStandardContent.trim()) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createStudyTemplate({
        name: newTitle.trim() || "Imported Standard Study",
        description:
          newDesc.trim() ||
          `Reusable ${newKind} study template (${STANDARD_BADGES[newStandard].label}) for ${newDomains.join(", ")} models.`,
        kind: newKind,
        category: newCategory,
        standardFormat: newStandard,
        rawStandardContent: newRawStandardContent.trim() || undefined,
        packageName: newPkgName.trim() || undefined,
        packageVersion: "1.0.0",
        tags: newTags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        modelContract: {
          domains: newDomains,
          minParameters: 1,
          minObservables: 1,
          parameterSlots: [
            {
              slotId: "studyParams",
              label: "Tunable Model Parameters",
              description: "Parameters varied or audited by this study.",
              type: "Real",
              variability: "parameter",
              multiple: true,
            },
          ],
          observableSlots: [
            {
              slotId: "primaryQoI",
              label: "Tracked Quantities of Interest",
              description: "Observables tracked for KPIs and plots.",
              type: "Real",
              multiple: true,
            },
          ],
        },
      });
      setIsAuthorModalOpen(false);
      setNewTitle("");
      setNewDesc("");
      setNewPkgName("");
      setNewRawStandardContent("");
      onTemplateCreated?.();
      if (created?.slug) {
        onSelectTemplate(created.slug);
      }
    } catch (err: any) {
      setSubmitError(err?.response?.data?.error || err?.message || "Failed to publish study template");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={4}>
      {/* ── SharePoint-Style Study Template Hub Banner ─────────────────── */}
      <div
        style={{
          padding: "22px 26px",
          borderRadius: "14px",
          background:
            "linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(168, 85, 247, 0.1) 50%, rgba(16, 185, 129, 0.06) 100%)",
          border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.12))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div style={{ maxWidth: "780px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "2px 9px",
                borderRadius: "999px",
                background: "rgba(56, 189, 248, 0.16)",
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.35)",
              }}
            >
              SED-ML L1V4 (.sedml)
            </span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "2px 9px",
                borderRadius: "999px",
                background: "rgba(52, 211, 153, 0.16)",
                color: "#34d399",
                border: "1px solid rgba(52, 211, 153, 0.35)",
              }}
            >
              ASAM SSP 2.0 (.ssv)
            </span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "2px 9px",
                borderRadius: "999px",
                background: "rgba(251, 146, 60, 0.16)",
                color: "#fb923c",
                border: "1px solid rgba(251, 146, 60, 0.35)",
              }}
            >
              Sandia Dakota (.dakota)
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)" }}>
              {galleryItems.length} standards-native study templates across all engineering languages
            </span>
          </div>
          <Text fontSize="19px" fontWeight="700" color="var(--color-fg-default, #f0f6fc)" display="block">
            SharePoint-Style Study Template Gallery — Select by Language, Configure in Wizard &amp; Generate Study
            Instance
          </Text>
          <Text fontSize="13px" color="var(--color-fg-muted, #8b949e)" display="block" mt={1}>
            Browse popular baked-in and community study templates for every engineering language. Launching any template
            opens the context-aware Wizard (pre-populated with your active model &amp; parameters), synthesizes a
            concrete <code>.sedml</code>, <code>.ssv</code>, or <code>.dakota</code> Study Instance Artifact, stores it
            on the Job or inside a Package, and executes it locally in WebAssembly or on the Slurm HPC cluster.
          </Text>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setIsAuthorModalOpen(true)}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              color: "#f0f6fc",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              borderRadius: "10px",
              padding: "10px 16px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <PlusIcon size={14} /> Author / Import Study (.sedml · .ssv · .dakota)
          </button>

          {onLaunchWizard && (
            <button
              type="button"
              onClick={() => onSelectTemplate("monte-carlo-sweep")}
              style={{
                background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                padding: "10px 18px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 4px 14px rgba(37, 99, 235, 0.35)",
              }}
            >
              <BeakerIcon size={14} /> Open Interactive Study Wizard
            </button>
          )}
        </div>
      </div>

      {/* ── Popular Study Templates by Language Ribbon (SharePoint Selector) ── */}
      <div
        style={{
          padding: "12px 16px",
          borderRadius: "12px",
          background: "rgba(15, 23, 42, 0.45)",
          border: "1px solid rgba(255, 255, 255, 0.09)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#94a3b8",
            }}
          >
            Popular Study Templates by Language / Engineering Domain:
          </span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: `All Standards (${counts.byStandard["all"] || 0})` },
              { id: "sedml", label: `SED-ML .sedml (${counts.byStandard["sedml"] || 0})`, color: "#38bdf8" },
              { id: "ssp-ssv", label: `SSP 2.0 .ssv (${counts.byStandard["ssp-ssv"] || 0})`, color: "#34d399" },
              { id: "dakota", label: `Sandia Dakota .dakota (${counts.byStandard["dakota"] || 0})`, color: "#fb923c" },
            ].map((std) => {
              const active = selectedStandard === std.id;
              return (
                <button
                  key={std.id}
                  type="button"
                  onClick={() => setSelectedStandard(std.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    border: active ? `1px solid ${std.color || "#60a5fa"}` : "1px solid rgba(255, 255, 255, 0.1)",
                    background: active ? "rgba(59, 130, 246, 0.18)" : "rgba(255, 255, 255, 0.03)",
                    color: active ? std.color || "#93c5fd" : "#94a3b8",
                  }}
                >
                  {std.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {POPULAR_LANGUAGE_GALLERY_TABS.map((lang) => {
            const active = selectedDomain === lang.id;
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => setSelectedDomain(lang.id)}
                style={{
                  padding: "6px 11px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  border: active ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.08)",
                  background: active ? "rgba(56, 189, 248, 0.16)" : "rgba(255, 255, 255, 0.025)",
                  color: active ? "#e0f2fe" : "#cbd5e1",
                }}
              >
                <span>{lang.label}</span>
                <code
                  style={{
                    fontSize: "10px",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    background: "rgba(0, 0, 0, 0.3)",
                    color: active ? "#7dd3fc" : "#64748b",
                  }}
                >
                  {lang.extHint}
                </code>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── SharePoint-Style Multi-Facet Filter Bar ───────────────────── */}
      <div
        style={{
          padding: "14px 18px",
          borderRadius: "12px",
          background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.025))",
          border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.08))",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {/* Top Row: Source Provenance Tabs + Search Omnibox + Target Selector */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          {/* Provenance Pills */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: `All Sources (${counts.bySource["all"] || 0})` },
              { id: "official", label: `✓ Official Built-In (${counts.bySource["official"] || 0})` },
              { id: "package", label: `📦 Package Artifacts (${counts.bySource["package"] || 0})` },
              { id: "community", label: `🌐 Community (${counts.bySource["community"] || 0})` },
            ].map((src) => {
              const active = selectedSource === src.id;
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => setSelectedSource(src.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: active ? "1px solid #60a5fa" : "1px solid rgba(255, 255, 255, 0.1)",
                    background: active ? "rgba(59, 130, 246, 0.16)" : "rgba(255, 255, 255, 0.03)",
                    color: active ? "#93c5fd" : "var(--color-fg-muted, #8b949e)",
                  }}
                >
                  {src.label}
                </button>
              );
            })}
          </div>

          {/* Execution Target Dropdown + Search Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              flex: "1 1 380px",
              justifyContent: "flex-end",
            }}
          >
            <select
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
              aria-label="Filter by execution target"
              style={{
                padding: "7px 10px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                background: "rgba(0, 0, 0, 0.25)",
                color: "#e2e8f0",
                fontSize: "12px",
              }}
            >
              <option value="all">All Execution Targets</option>
              <option value="local-wasm">⚡ Runs Locally in Browser (WASM)</option>
              <option value="hpc-cluster">🖥️ HPC Slurm Cluster</option>
            </select>

            <div style={{ position: "relative", minWidth: "240px", flex: "0 1 320px" }}>
              <span
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-fg-muted, #8b949e)",
                  display: "flex",
                }}
              >
                <SearchIcon size={14} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search .sedml, .ssv, .dakota studies, packages, KPIs..."
                aria-label="Search study templates across packages"
                style={{
                  width: "100%",
                  padding: "7px 12px 7px 30px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "rgba(0, 0, 0, 0.25)",
                  color: "#f0f6fc",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        </div>

        {/* Second Row: Study Kind (Archetype) Filter Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <span
            style={{ fontSize: "11px", color: "var(--color-fg-muted, #8b949e)", fontWeight: 600, marginRight: "4px" }}
          >
            Study Archetype:
          </span>
          {[
            { id: "all", label: "All Archetypes" },
            { id: "time-course", label: "Transient Time-Course (.sedml)" },
            { id: "monte-carlo", label: "Monte Carlo & Sobol UQ (.dakota)" },
            { id: "parameter-sweep", label: "Parametric Sweep (.sedml / .dakota)" },
            { id: "calibration", label: "Parameter Set Calibration (.ssv)" },
            { id: "optimization", label: "Optimization Pareto (.dakota)" },
            { id: "verification", label: "Standards Verification (.sedml)" },
            { id: "steady-state", label: "Steady-State FEA/CFD (.sedml)" },
            { id: "eigen-frequency", label: "Modal / Eigenfrequency (.sedml)" },
            { id: "surrogate", label: "Surrogate / ROM (.dakota)" },
          ].map((k) => {
            const active = selectedKind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => setSelectedKind(k.id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "999px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: active ? "1px solid #c084fc" : "1px solid rgba(255, 255, 255, 0.08)",
                  background: active ? "rgba(168, 85, 247, 0.18)" : "rgba(255, 255, 255, 0.02)",
                  color: active ? "#e9d5ff" : "var(--color-fg-muted, #8b949e)",
                }}
              >
                {k.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Study Template Cards Grid ──────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "16px",
        }}
      >
        {filteredItems.map((t) => {
          const kindMeta = KIND_LABELS[t.kind] || { label: t.kind, color: t.accentColor };
          const stdBadge = STANDARD_BADGES[t.standardFormat] || STANDARD_BADGES.sedml;
          const supportsLocalWasm = t.supportedTargets.includes("local-wasm");
          return (
            <div
              key={t.slug}
              onClick={() => onSelectTemplate(t.slug)}
              style={{
                background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.028))",
                border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.1))",
                borderRadius: "14px",
                padding: "18px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "14px",
                transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = t.accentColor;
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 10px 26px rgba(0, 0, 0, 0.22)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--color-border-default, rgba(255, 255, 255, 0.1))";
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div>
                {/* Card Top Header: Icon + Source Provenance + Study Archetype Badge */}
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} mb={2}>
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "10px",
                      backgroundColor: `${t.accentColor}1a`,
                      border: `1px solid ${t.accentColor}45`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: t.accentColor,
                      fontSize: "18px",
                      flexShrink: 0,
                    }}
                  >
                    {categoryIcon(t.icon)}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    {t.sourceType === "package" ? (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(59, 130, 246, 0.15)",
                          color: "#93c5fd",
                          border: "1px solid rgba(59, 130, 246, 0.35)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <PackageIcon size={10} />
                        {t.packageName || "Package Study"}
                      </span>
                    ) : t.sourceType === "community" ? (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(234, 179, 8, 0.15)",
                          color: "#fde047",
                          border: "1px solid rgba(234, 179, 8, 0.35)",
                        }}
                      >
                        🌐 Community @{t.authorUsername}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(16, 185, 129, 0.14)",
                          color: "#34d399",
                          border: "1px solid rgba(16, 185, 129, 0.3)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <CheckCircleFillIcon size={10} /> Official
                      </span>
                    )}

                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: stdBadge.bg,
                        color: stdBadge.color,
                        border: `1px solid ${stdBadge.color}44`,
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {stdBadge.label}
                    </span>

                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: `${kindMeta.color}1f`,
                        color: kindMeta.color,
                        border: `1px solid ${kindMeta.color}44`,
                      }}
                    >
                      {kindMeta.label}
                    </span>
                  </div>
                </Box>

                {/* Title & Description */}
                <Text fontSize="15px" fontWeight="700" color="var(--color-fg-default, #ffffff)" display="block">
                  {t.name}
                </Text>

                {t.packageName && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-fg-muted, #8b949e)",
                      marginTop: "3px",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {t.packageName}@{t.packageVersion || "1.0.0"}
                    {t.artifactPath ? ` · ${t.artifactPath}` : ""}
                  </div>
                )}

                <Text
                  fontSize="12px"
                  color="var(--color-fg-muted, #8b949e)"
                  display="block"
                  style={{ marginTop: "6px", lineHeight: 1.5 }}
                >
                  {t.description.length > 155 ? t.description.slice(0, 155) + "…" : t.description}
                </Text>

                {/* Compatible Model Domains + Execution Parity Strip */}
                <div
                  style={{
                    marginTop: "10px",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "6px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: "10px", color: "var(--color-fg-muted, #8b949e)", fontWeight: 600 }}>
                      Compatible Models:
                    </span>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {t.domains.map((d) => (
                        <code
                          key={d}
                          style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "rgba(255, 255, 255, 0.06)",
                            color: "#e2e8f0",
                            textTransform: "uppercase",
                          }}
                        >
                          {d}
                        </code>
                      ))}
                    </div>
                  </div>

                  {t.kpis.length > 0 && (
                    <div style={{ fontSize: "11px", color: "#cbd5e1", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--color-fg-muted, #8b949e)" }}>Outputs:</span>
                      <span>{t.kpis.slice(0, 3).join(" · ")}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer: Execution Targets, Stars/Runs, and Primary Action */}
              <Box
                pt={2}
                borderTop="1px solid var(--color-border-default, rgba(255, 255, 255, 0.08))"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                fontSize="12px"
                style={{ gap: "8px", flexWrap: "wrap" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {supportsLocalWasm && (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "2px 7px",
                        borderRadius: "999px",
                        background: "rgba(16, 185, 129, 0.12)",
                        color: "#34d399",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                      }}
                    >
                      ⚡ Local WASM
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: "999px",
                      background: "rgba(6, 182, 212, 0.12)",
                      color: "#22d3ee",
                      border: "1px solid rgba(6, 182, 212, 0.3)",
                    }}
                  >
                    🖥️ Slurm HPC
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--color-fg-muted, #8b949e)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                    }}
                  >
                    <StarFillIcon size={11} fill="#eab308" /> {t.starsCount} · {t.runsCount} runs
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {onLaunchWizard && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLaunchWizard(t.slug);
                      }}
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        color: "var(--color-fg-muted, #8b949e)",
                        borderRadius: "6px",
                        padding: "5px 9px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                      title="Quick launch in modal overlay"
                    >
                      Quick Wizard
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTemplate(t.slug);
                    }}
                    style={{
                      background: `${t.accentColor}24`,
                      border: `1px solid ${t.accentColor}66`,
                      color: "#ffffff",
                      borderRadius: "6px",
                      padding: "5px 12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <ZapIcon size={11} />
                    <span>Configure &amp; Run</span>
                    <ArrowRightIcon size={11} />
                  </button>
                </div>
              </Box>
            </div>
          );
        })}
      </div>

      {/* ── Author / Import Open-Standard Study Template Modal (.sedml · .ssv · .dakota) ── */}
      {isAuthorModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Author & Publish Study Template"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.72)",
            backdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => setIsAuthorModalOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handlePublishTemplate}
            style={{
              width: "100%",
              maxWidth: "620px",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--color-canvas-overlay, #161b22)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "16px",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div>
              <Text fontSize="18px" fontWeight="700" color="#f0f6fc" display="block">
                Author or Import Reusable Study Template (<code>.sedml</code> · <code>.ssv</code> · <code>.dakota</code>
                )
              </Text>
              <Text fontSize="12px" color="#8b949e" display="block" mt={1}>
                Publish a standards-compliant SED-ML L1V4, ASAM SSP 2.0 Parameter Set, or Sandia Dakota study blueprint
                that anyone can apply to compatible models across the platform.
              </Text>
            </div>

            {submitError && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#fca5a5",
                  fontSize: "12px",
                }}
              >
                {submitError}
              </div>
            )}

            <div>
              <label
                style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
              >
                Open Standard Specification Format
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                {(["sedml", "ssp-ssv", "dakota"] as const).map((std) => {
                  const active = newStandard === std;
                  const meta = STANDARD_BADGES[std];
                  return (
                    <button
                      key={std}
                      type="button"
                      onClick={() => {
                        setNewStandard(std);
                        if (std === "ssp-ssv") {
                          setNewKind("calibration");
                          setNewCategory("verification");
                        } else if (std === "dakota") {
                          setNewKind("monte-carlo");
                          setNewCategory("uncertainty");
                        } else {
                          setNewKind("time-course");
                          setNewCategory("simulation");
                        }
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        border: active ? `1px solid ${meta.color}` : "1px solid rgba(255, 255, 255, 0.12)",
                        background: active ? meta.bg : "rgba(0, 0, 0, 0.25)",
                        color: active ? meta.color : "#94a3b8",
                      }}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
              >
                Study Template Name *
              </label>
              <input
                type="text"
                required={!newRawStandardContent.trim()}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g., DNV-OS-E301 Offshore Mooring Fatigue Monte Carlo Study"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "#f0f6fc",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label
                  style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
                >
                  Study Archetype
                </label>
                <select
                  value={newKind}
                  onChange={(e) => {
                    setNewKind(e.target.value);
                    if (e.target.value === "monte-carlo") setNewCategory("uncertainty");
                    else if (e.target.value === "parameter-sweep") setNewCategory("sweep");
                    else if (e.target.value === "optimization") setNewCategory("optimization");
                    else if (e.target.value === "verification" || e.target.value === "calibration")
                      setNewCategory("verification");
                    else setNewCategory("simulation");
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.16)",
                    background: "rgba(0, 0, 0, 0.3)",
                    color: "#f0f6fc",
                    fontSize: "13px",
                  }}
                >
                  <option value="time-course">Transient Time-Course (SED-ML)</option>
                  <option value="parameter-sweep">Parametric Sweep (SED-ML / Dakota)</option>
                  <option value="calibration">Parameter Set Calibration (SSP .ssv)</option>
                  <option value="monte-carlo">Monte Carlo UQ &amp; Sobol (Dakota)</option>
                  <option value="optimization">Multi-Objective Optimization (Dakota)</option>
                  <option value="verification">Standards Verification &amp; Compliance</option>
                  <option value="steady-state">Steady-State FEA / CFD</option>
                  <option value="eigen-frequency">Modal Eigenfrequency</option>
                  <option value="surrogate">Surrogate / ROM Training</option>
                </select>
              </div>

              <div>
                <label
                  style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
                >
                  Store in Package (Optional)
                </label>
                <input
                  type="text"
                  value={newPkgName}
                  onChange={(e) => setNewPkgName(e.target.value)}
                  placeholder="e.g., @dnv/offshore-hydrodynamics"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.16)",
                    background: "rgba(0, 0, 0, 0.3)",
                    color: "#f0f6fc",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
              >
                Compatible Languages / Model Domains
              </label>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {[
                  "modelica",
                  "spice",
                  "verilog-ams",
                  "sysmlv2",
                  "pscad",
                  "gensys",
                  "simpack",
                  "cfd",
                  "fea",
                  "cad",
                  "fmu",
                  "ssp",
                  "sbml",
                  "matlab",
                  "python",
                  "cpp",
                ].map((dom) => {
                  const checked = newDomains.includes(dom);
                  return (
                    <button
                      key={dom}
                      type="button"
                      onClick={() =>
                        setNewDomains((prev) => (prev.includes(dom) ? prev.filter((d) => d !== dom) : [...prev, dom]))
                      }
                      style={{
                        padding: "4px 9px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: checked ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.12)",
                        background: checked ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 255, 255, 0.03)",
                        color: checked ? "#93c5fd" : "#8b949e",
                        textTransform: "uppercase",
                      }}
                    >
                      {dom}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
              >
                Paste Existing <code>{STANDARD_BADGES[newStandard].ext}</code> Standard Document (Optional —
                Auto-Extracted)
              </label>
              <textarea
                rows={4}
                value={newRawStandardContent}
                onChange={(e) => setNewRawStandardContent(e.target.value)}
                placeholder={
                  newStandard === "sedml"
                    ? '<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">...</sedML>'
                    : newStandard === "ssp-ssv"
                      ? '<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues" version="2.0" name="...">...</ssv:ParameterSet>'
                      : "environment\n  tabular_data\nmethod\n  sampling\n    sample_type lhs\n    samples = 64"
                }
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  background: "rgba(0, 0, 0, 0.35)",
                  color: "#7dd3fc",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
              >
                Study Description &amp; Methodology
              </label>
              <textarea
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Describe what engineering question this study answers, how parameters are sampled, and what KPIs are extracted..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "#f0f6fc",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}
              >
                Discovery Tags (comma-separated)
              </label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "#f0f6fc",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
              <button
                type="button"
                onClick={() => setIsAuthorModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "transparent",
                  color: "#cbd5e1",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !newTitle.trim()}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: isSubmitting ? "wait" : "pointer",
                }}
              >
                {isSubmitting ? "Publishing..." : "Publish Study Template"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Box>
  );
};
