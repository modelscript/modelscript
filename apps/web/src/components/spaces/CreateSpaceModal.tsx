// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  BeakerIcon,
  CheckIcon,
  CommentDiscussionIcon,
  CpuIcon,
  FileCodeIcon,
  FlameIcon,
  GearIcon,
  GlobeIcon,
  LockIcon,
  OrganizationIcon,
  PersonIcon,
  PlusIcon,
  PulseIcon,
  RepoIcon,
  RocketIcon,
  ShieldCheckIcon,
  SparkleIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOrganization,
  createSpace,
  getMyOrganizations,
  getSpaceDomainPresets,
  type Organization,
  type SpaceDomainPreset,
  type SpaceOwnerType,
  type SpaceVisibility,
} from "../../api";
import { useAuth } from "../../AuthContext";
import { useToast } from "../ToastContext";

interface CreateSpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOwnerType?: SpaceOwnerType;
  defaultOrganizationSlug?: string;
  onCreated?: (namespace: string, slug: string) => void;
}

const FALLBACK_PRESETS: SpaceDomainPreset[] = [
  {
    id: "systems_general",
    name: "Core Systems Engineering & Multiphysics",
    shortLabel: "Systems & DAE",
    icon: "cpu",
    accentColor: "#3b82f6",
    description:
      "Unified MBSE, acausal Modelica DAE simulation, SysML v2 architecture, ReqIF requirements traceability, and FMI co-simulation.",
    replacesTools: ["Confluence", "MagicDraw / Cameo", "Teamcenter", "SharePoint", "Slack"],
    complianceStandards: ["ISO 15288", "OMG SysML v2", "FMI 2.0/3.0", "NIST OSCAL"],
    languages: ["modelica", "modelscript", "sysml2", "ssp", "reqif", "oscal", "owl2", "csv"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: {
      language: "modelica",
      title: "SystemBaseline",
      code: "model SystemBaseline ... end SystemBaseline;",
    },
  },
  {
    id: "automotive_robotics",
    name: "Automotive, Robotics & Multibody Systems",
    shortLabel: "Automotive & Robotics",
    icon: "gear",
    accentColor: "#ef4444",
    description:
      "ISO 26262 functional safety, AUTOSAR Classic/Adaptive architectures, URDF robotics, OpenDRIVE roads, and Simpack/Adams dynamics.",
    replacesTools: ["PTC Windchill", "Vector DaVinci", "CarSim / TruckSim", "ROS bags"],
    complianceStandards: ["ISO 26262 ASIL D", "AUTOSAR 4.4 / Adaptive", "ASAM OpenDRIVE", "OpenSCENARIO 2.0"],
    languages: ["autosar", "urdf", "opendrive", "openscenario", "adams", "simpack", "gtsuite", "gensys"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: { language: "urdf", title: "RobotArm", code: "" },
  },
  {
    id: "power_rf_grid",
    name: "Electric Power Grids, RF & Power Electronics",
    shortLabel: "Power Grids & RF",
    icon: "zap",
    accentColor: "#10b981",
    description:
      "Transmission & distribution EMT simulation, NERC CIP compliance, IEC 61970/61968 CIM/CGMES grid models, and SPICE power electronics.",
    replacesTools: ["PSCAD / EMTDC", "Siemens PSS/E", "ETAP", "Ansys HFSS", "Keysight ADS"],
    complianceStandards: ["NERC CIP-005/007/010", "IEEE 1547-2018", "IEC 61970 CIM / CGMES", "FERC CEII"],
    languages: ["pscad", "psse", "cgmes", "opendss", "spice", "verilog-a", "touchstone", "ibis"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: { language: "pscad", title: "InverterGridTie", code: "" },
  },
  {
    id: "aerospace_cad",
    name: "3D CAD, Continuum Physics & Aerospace",
    shortLabel: "3D CAD & Aerospace",
    icon: "rocket",
    accentColor: "#8b5cf6",
    description:
      "STEP AP242 MBE/MBD, OpenCASCADE solid modeling, NASTRAN/OpenFOAM physics, and MIL-STD-881E flight dynamics.",
    replacesTools: ["Dassault CATIA / 3DEXPERIENCE", "Siemens NX", "Ansys Mechanical", "Enovia"],
    complianceStandards: ["ISO 10303 STEP AP242", "MIL-STD-881E", "NASA-STD-7009A", "DO-178C DAL A"],
    languages: ["step", "qif", "scad", "usd", "fea", "cfd", "simulink", "easy5", "jsbsim"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: { language: "step", title: "RocketNozzle", code: "" },
  },
  {
    id: "oil_gas_process",
    name: "Oil, Gas & Process Engineering",
    shortLabel: "Oil, Gas & Process",
    icon: "flame",
    accentColor: "#f59e0b",
    description:
      "Multiphase flow dynamics, compositional reservoir simulation, petrochemical process flowsheets, and water distribution networks.",
    replacesTools: ["Schlumberger OLGA", "Aspen HYSYS / Plus", "Schlumberger ECLIPSE", "Honeywell UniSim"],
    complianceStandards: ["API RP 14E", "ASME B31.3", "OSHA 1910.119 PSM", "NORSOK P-002"],
    languages: ["olga", "lps", "aspen", "eclipse", "epanet", "swmm", "relap5", "energyplus"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: { language: "olga", title: "SubseaPipeline", code: "" },
  },
  {
    id: "pharma_chem_bio",
    name: "Chemistry, Systems Biology & Pharmacology",
    shortLabel: "Pharma & Bio",
    icon: "flask",
    accentColor: "#ec4899",
    description:
      "Systems pharmacology (QSP), enzyme kinetics, PBPK bioavailability, biochemical reaction networks, and molecular cheminformatics.",
    replacesTools: ["Certara Phoenix WinNonlin", "Simcyp", "NONMEM", "Schrodinger Suite"],
    complianceStandards: ["FDA 21 CFR Part 11", "ICH M12 / E6(R2)", "CDISC SEND", "MIAME / MIRIAM"],
    languages: ["sbml", "antimony", "cantera", "smiles", "nmtran", "sbol", "bngl", "genbank"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: { language: "antimony", title: "EnzymeKinetics", code: "" },
  },
  {
    id: "med_radiology",
    name: "Medical Imaging, Radiation Oncology & Biomechanics",
    shortLabel: "Medical & Biomech",
    icon: "pulse",
    accentColor: "#06b6d4",
    description:
      "DICOM-RT treatment planning, musculoskeletal biomechanics, Monte Carlo dosimetry, and finite-element tissue biomechanics.",
    replacesTools: ["Varian Eclipse", "Elekta Monaco", "AnyBody Modeling", "Mimics"],
    complianceStandards: ["FDA 510(k) / SaMD", "IEC 62304 Class C", "DICOM Part 3 / PS 3.3", "AAPM TG-51"],
    languages: ["opensim", "dicom-rt", "cellml", "febio", "nifti", "topas", "three-mf", "igtl"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    sampleCodeSnippet: { language: "opensim", title: "GaitModel", code: "" },
  },
];

const PRESET_ICONS: Record<string, React.ReactElement> = {
  systems_general: <CpuIcon size={18} />,
  automotive_robotics: <GearIcon size={18} />,
  power_rf_grid: <ZapIcon size={18} />,
  aerospace_cad: <RocketIcon size={18} />,
  oil_gas_process: <FlameIcon size={18} />,
  pharma_chem_bio: <BeakerIcon size={18} />,
  med_radiology: <PulseIcon size={18} />,
};

export const CreateSpaceModal: React.FC<CreateSpaceModalProps> = ({
  isOpen,
  onClose,
  defaultOwnerType = "user",
  defaultOrganizationSlug,
  onCreated,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const nameInputId = useId();

  const [presets, setPresets] = useState<SpaceDomainPreset[]>(FALLBACK_PRESETS);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [ownerType, setOwnerType] = useState<SpaceOwnerType>(defaultOwnerType);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState<string>(defaultOrganizationSlug || "");
  const [showNewOrgForm, setShowNewOrgForm] = useState(false);
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgName, setNewOrgName] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [tagline, setTagline] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("systems_general");
  const [visibility, setVisibility] = useState<SpaceVisibility>("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setOwnerType(defaultOwnerType);
    if (defaultOrganizationSlug) setSelectedOrgSlug(defaultOrganizationSlug);
    void getSpaceDomainPresets()
      .then((list) => {
        if (list && list.length > 0) setPresets(list);
      })
      .catch(() => {});
    void getMyOrganizations()
      .then((orgs) => {
        setOrganizations(orgs);
        if (!defaultOrganizationSlug && orgs.length > 0 && !selectedOrgSlug) {
          setSelectedOrgSlug(orgs[0]!.slug);
        }
      })
      .catch(() => {});
  }, [isOpen, defaultOwnerType, defaultOrganizationSlug, selectedOrgSlug]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        // Trigger submit
        const form = document.getElementById("create-space-form") as HTMLFormElement | null;
        if (form) form.requestSubmit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activePreset = presets.find((p) => p.id === selectedPreset) || presets[0] || FALLBACK_PRESETS[0];

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManuallyEdited) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48),
      );
    }
  };

  const handleCreateNewOrg = async () => {
    if (!newOrgSlug.trim() || !newOrgName.trim()) {
      setError("Organization slug and name are required");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const createdOrg = await createOrganization({
        slug: newOrgSlug.trim().toLowerCase(),
        name: newOrgName.trim(),
      });
      setOrganizations((prev) => [...prev, createdOrg]);
      setSelectedOrgSlug(createdOrg.slug);
      setOwnerType("organization");
      setShowNewOrgForm(false);
      setNewOrgSlug("");
      setNewOrgName("");
      toast.success(`Created organization @${createdOrg.slug}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to create organization");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setError("Space name and slug are required");
      return;
    }
    if (ownerType === "organization" && !selectedOrgSlug) {
      setError("Please select or create an Organization to own this Space");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const res = await createSpace({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        tagline: tagline.trim() || undefined,
        ownerType,
        organizationSlug: ownerType === "organization" ? selectedOrgSlug : undefined,
        domainPreset: selectedPreset,
        visibility,
      });

      const ns = res.space.owner_namespace;
      toast.success(`Created Space @${ns}/${res.space.slug}`);
      onClose();
      if (onCreated) {
        onCreated(ns, res.space.slug);
      } else {
        navigate(`/@${ns}/${res.space.slug}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to create Space");
    } finally {
      setSubmitting(false);
    }
  };

  const ownerNamespacePreview =
    ownerType === "organization" ? `@${selectedOrgSlug || "organization"}` : `@${user?.username || "personal"}`;

  const currentSlugDisplay = slug || "space-slug";

  // Symmetrical Domain Blueprints: 1 Featured Hero + 6 Domain Cards
  const heroPreset = presets.find((p) => p.id === "systems_general") || presets[0] || FALLBACK_PRESETS[0];
  const domainPresets = presets.filter((p) => p.id !== "systems_general");

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        backgroundColor: "rgba(3, 7, 18, 0.78)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1040px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(180deg, #0e1526 0%, #0a0f1d 100%)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "18px",
          color: "var(--color-text-primary, #f8fafc)",
          boxShadow:
            "0 32px 64px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div
          style={{
            padding: "20px 28px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            background: "rgba(15, 23, 42, 0.4)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "8px",
                  background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  boxShadow: "0 2px 8px rgba(59, 130, 246, 0.4)",
                }}
              >
                <SparkleIcon size={16} />
              </div>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em" }}>
                Create an Engineering Space
              </h2>
            </div>
            <p style={{ margin: "6px 0 0 36px", fontSize: "13px", color: "var(--color-text-muted, #94a3b8)" }}>
              A unified home for your living specifications, simulation models, Git vault, and team discussions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              color: "var(--color-text-muted, #94a3b8)",
              padding: "6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {error && (
          <div
            style={{
              margin: "16px 28px 0",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#fca5a5",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Modal Body: Split-Pane Studio (Form on Left, Live Manifest Preview on Right) */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 28px",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 1fr)",
            gap: "28px",
            alignItems: "start",
          }}
        >
          {/* Left Column: Form Controls */}
          <form
            id="create-space-form"
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "22px" }}
          >
            {/* 1. Space Owner & Namespace */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "8px",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  Space Owner & Namespace
                </label>
                <span style={{ fontSize: "11px", color: "#64748b" }}>Who owns this digital thread</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {/* Personal Profile Option */}
                <button
                  type="button"
                  onClick={() => setOwnerType("user")}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "12px",
                    border: ownerType === "user" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    background: ownerType === "user" ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.5)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "6px",
                        background: ownerType === "user" ? "#3b82f6" : "rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                      }}
                    >
                      <PersonIcon size={14} />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "13px" }}>Personal (@{user?.username || "you"})</span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-muted, #94a3b8)",
                      marginTop: "6px",
                      lineHeight: 1.4,
                    }}
                  >
                    Personal sandbox, lab notebook, and research repository
                  </div>
                </button>

                {/* Organization Option */}
                <button
                  type="button"
                  onClick={() => setOwnerType("organization")}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "12px",
                    border: ownerType === "organization" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    background: ownerType === "organization" ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.5)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "6px",
                        background: ownerType === "organization" ? "#3b82f6" : "rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                      }}
                    >
                      <OrganizationIcon size={14} />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "13px" }}>Organization</span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-muted, #94a3b8)",
                      marginTop: "6px",
                      lineHeight: 1.4,
                    }}
                  >
                    Enterprise program, vehicle platform, plant, or division
                  </div>
                </button>
              </div>

              {/* Organization Picker (if Organization selected) */}
              {ownerType === "organization" && (
                <div
                  style={{
                    marginTop: "10px",
                    padding: "12px 14px",
                    borderRadius: "12px",
                    background: "rgba(15, 23, 42, 0.7)",
                    border: "1px solid rgba(59, 130, 246, 0.25)",
                  }}
                >
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <select
                      value={selectedOrgSlug}
                      onChange={(e) => setSelectedOrgSlug(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        background: "#090d16",
                        color: "inherit",
                        fontSize: "13px",
                        outline: "none",
                      }}
                    >
                      {organizations.length === 0 && (
                        <option value="">No organizations found — create one below</option>
                      )}
                      {organizations.map((org) => (
                        <option key={org.id} value={org.slug}>
                          @{org.slug} — {org.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setShowNewOrgForm((prev) => !prev)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(59, 130, 246, 0.3)",
                        background: "rgba(59, 130, 246, 0.1)",
                        color: "#60a5fa",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <PlusIcon size={12} />
                      {showNewOrgForm ? "Cancel" : "New Org"}
                    </button>
                  </div>

                  {showNewOrgForm && (
                    <div
                      style={{
                        marginTop: "12px",
                        paddingTop: "12px",
                        borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <input
                        type="text"
                        placeholder="org-slug (e.g. acme-aero)"
                        value={newOrgSlug}
                        onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                        style={{
                          flex: "1 1 140px",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          background: "#060911",
                          color: "inherit",
                          fontSize: "12px",
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Organization Name"
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                        style={{
                          flex: "1 1 160px",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          background: "#060911",
                          color: "inherit",
                          fontSize: "12px",
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCreateNewOrg}
                        style={{
                          padding: "7px 14px",
                          borderRadius: "6px",
                          border: "none",
                          background: "#2563eb",
                          color: "#fff",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Create Organization
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Space Name & URL */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "8px",
                }}
              >
                <label
                  htmlFor={nameInputId}
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  Space Name & URL
                </label>
                <span style={{ fontSize: "11px", color: "#64748b" }}>Short, memorable identifier</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "10px" }}>
                <div>
                  <input
                    id={nameInputId}
                    type="text"
                    required
                    placeholder="e.g. F-150 Lightning BMS"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      background: "rgba(15, 23, 42, 0.6)",
                      color: "inherit",
                      fontSize: "14px",
                      boxSizing: "border-box",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      borderRadius: "10px",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      background: "rgba(15, 23, 42, 0.6)",
                      padding: "0 10px",
                      height: "40px",
                    }}
                  >
                    <span style={{ color: "#60a5fa", fontSize: "12px", fontWeight: 600, marginRight: "4px" }}>
                      {ownerNamespacePreview}/
                    </span>
                    <input
                      type="text"
                      required
                      placeholder="slug"
                      value={slug}
                      onChange={(e) => {
                        setSlugManuallyEdited(true);
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
                      }}
                      style={{
                        flex: 1,
                        border: "none",
                        background: "transparent",
                        color: "#f8fafc",
                        fontSize: "13px",
                        fontFamily: "monospace",
                        outline: "none",
                        padding: 0,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Tagline / Scope Summary */}
              <div style={{ marginTop: "10px" }}>
                <input
                  type="text"
                  placeholder="Engineering scope summary (e.g. High-voltage thermal management and ISO 26262 safety baselines)"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    background: "rgba(15, 23, 42, 0.4)",
                    color: "inherit",
                    fontSize: "12px",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            {/* 3. Domain Blueprint Selector (Symmetrical 1 + 6 Layout) */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "8px",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  Domain Blueprint
                </label>
                <span style={{ fontSize: "11px", color: "#64748b" }}>
                  Pre-configures compilers, channels & living docs
                </span>
              </div>

              {/* Hero / Baseline Card: Systems & Multiphysics */}
              {heroPreset && (
                <button
                  type="button"
                  onClick={() => setSelectedPreset(heroPreset.id)}
                  style={{
                    width: "100%",
                    marginBottom: "10px",
                    padding: "12px 14px",
                    borderRadius: "12px",
                    border:
                      selectedPreset === heroPreset.id
                        ? `2px solid ${heroPreset.accentColor}`
                        : "1px solid rgba(255, 255, 255, 0.08)",
                    background: selectedPreset === heroPreset.id ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.5)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: "rgba(59, 130, 246, 0.18)",
                      border: "1px solid rgba(59, 130, 246, 0.4)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: heroPreset.accentColor,
                      flexShrink: 0,
                    }}
                  >
                    <CpuIcon size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "13px",
                          color: selectedPreset === heroPreset.id ? heroPreset.accentColor : "#f8fafc",
                        }}
                      >
                        {heroPreset.name}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(59, 130, 246, 0.2)",
                          color: "#60a5fa",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                        }}
                      >
                        Universal Baseline
                      </span>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted, #94a3b8)", marginTop: "3px" }}>
                      Modelica, ModelScript, SysML v2, SSP, ReqIF, FMI 2.0/3.0
                    </div>
                  </div>
                  {selectedPreset === heroPreset.id && (
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        background: heroPreset.accentColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      <CheckIcon size={12} />
                    </div>
                  )}
                </button>
              )}

              {/* The 6 Domain Blueprints (Balanced 2x3 Grid) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {domainPresets.map((preset) => {
                  const isSelected = preset.id === selectedPreset;
                  const iconElement = PRESET_ICONS[preset.id] || <SparkleIcon size={16} />;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedPreset(preset.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: isSelected ? `2px solid ${preset.accentColor}` : "1px solid rgba(255, 255, 255, 0.08)",
                        background: isSelected
                          ? `rgba(${preset.accentColor === "#ef4444" ? "239, 68, 68" : preset.accentColor === "#10b981" ? "16, 185, 129" : preset.accentColor === "#8b5cf6" ? "139, 92, 246" : preset.accentColor === "#f59e0b" ? "245, 158, 11" : preset.accentColor === "#ec4899" ? "236, 72, 153" : "6, 182, 212"}, 0.12)`
                          : "rgba(15, 23, 42, 0.4)",
                        color: "inherit",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ color: preset.accentColor, display: "flex", alignItems: "center" }}>
                            {iconElement}
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: "12px",
                              color: isSelected ? preset.accentColor : "inherit",
                            }}
                          >
                            {preset.shortLabel}
                          </span>
                        </div>
                        {isSelected && (
                          <div
                            style={{
                              width: "16px",
                              height: "16px",
                              borderRadius: "50%",
                              background: preset.accentColor,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#fff",
                            }}
                          >
                            <CheckIcon size={10} />
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-muted, #94a3b8)",
                          lineHeight: 1.35,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {preset.languages.slice(0, 4).join(", ")}
                        {preset.languages.length > 4 ? ` +${preset.languages.length - 4}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Blueprint Feature Summary (Refined Glass Card) */}
              {activePreset && (
                <div
                  style={{
                    marginTop: "10px",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    border: `1px solid rgba(255, 255, 255, 0.08)`,
                    fontSize: "11px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ color: "#94a3b8", fontWeight: 600 }}>Replaces:</span>
                    {activePreset.replacesTools.map((tool) => (
                      <span
                        key={tool}
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(255, 255, 255, 0.06)",
                          color: "#cbd5e1",
                          fontSize: "10px",
                        }}
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span
                      style={{ color: "#94a3b8", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      <ShieldCheckIcon size={12} /> Compliance:
                    </span>
                    {activePreset.complianceStandards.map((std) => (
                      <span
                        key={std}
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(16, 185, 129, 0.12)",
                          color: "#34d399",
                          fontSize: "10px",
                          border: "1px solid rgba(16, 185, 129, 0.25)",
                        }}
                      >
                        {std}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 4. Visibility & Governance */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "8px",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  Visibility & Governance
                </label>
                <span style={{ fontSize: "11px", color: "#64748b" }}>Control intellectual property access</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                {/* Public */}
                <button
                  type="button"
                  onClick={() => setVisibility("public")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: visibility === "public" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    background: visibility === "public" ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.4)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "12px" }}>
                    <GlobeIcon size={14} />
                    <span>Public</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.3 }}>
                    Anyone on the web can inspect models & docs
                  </div>
                </button>

                {/* Internal */}
                <button
                  type="button"
                  onClick={() => setVisibility("internal")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: visibility === "internal" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    background: visibility === "internal" ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.4)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "12px" }}>
                    <OrganizationIcon size={14} />
                    <span>Internal</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.3 }}>
                    Restricted to verified organization members
                  </div>
                </button>

                {/* Private */}
                <button
                  type="button"
                  onClick={() => setVisibility("private")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: visibility === "private" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    background: visibility === "private" ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.4)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "12px" }}>
                    <LockIcon size={14} />
                    <span>Private</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.3 }}>
                    Only explicitly invited engineers can access
                  </div>
                </button>
              </div>
            </div>
          </form>

          {/* Right Column: Live Space Blueprint Reactive Manifest */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "18px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              position: "sticky",
              top: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#10b981",
                    boxShadow: "0 0 8px #10b981",
                  }}
                />
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  Live Space Blueprint
                </span>
              </div>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                }}
              >
                {activePreset.shortLabel}
              </span>
            </div>

            {/* Simulated Space Identity Banner */}
            <div
              style={{
                padding: "12px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    background: activePreset.accentColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontWeight: 800,
                    fontSize: "15px",
                    boxShadow: `0 4px 12px ${activePreset.accentColor}44`,
                  }}
                >
                  {(name.trim() || "Space")[0]?.toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "14px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {name.trim() || "Untitled Space"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#60a5fa", fontFamily: "monospace" }}>
                    {ownerNamespacePreview}/{currentSlugDisplay}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#94a3b8",
                  marginTop: "8px",
                  lineHeight: 1.35,
                  fontStyle: tagline ? "normal" : "italic",
                }}
              >
                {tagline.trim() ||
                  "Living multiphysics models, DAE simulation baselines, and engineering verification thread."}
              </div>
            </div>

            {/* Provisioned Git Vault Remote */}
            <div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <RepoIcon size={12} /> Provisioned Git Vault
              </div>
              <div
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "#060911",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  color: "#38bdf8",
                  wordBreak: "break-all",
                }}
              >
                git@ansatz.social:{ownerNamespacePreview.replace("@", "")}/{currentSlugDisplay}.git
              </div>
            </div>

            {/* Pre-Configured Channels */}
            <div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: "6px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <CommentDiscussionIcon size={12} /> Pre-Seeded Channels ({activePreset.defaultChannels?.length || 4})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {(
                  activePreset.defaultChannels || [
                    { name: "announcements", topic: "Releases & milestone baselines" },
                    { name: "general", topic: "Cross-disciplinary modeling discussion" },
                    { name: "architecture-reviews", topic: "SysML v2 & ECO sign-offs" },
                    { name: "ci-benchmarks", topic: "Continuous simulation regression results" },
                  ]
                )
                  .slice(0, 4)
                  .map((ch) => (
                    <div
                      key={ch.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "11px",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        background: "rgba(255, 255, 255, 0.03)",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#cbd5e1" }}>#{ch.name}</span>
                      <span
                        style={{
                          color: "#64748b",
                          fontSize: "10px",
                          maxWidth: "160px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ch.topic}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Starter Living Docs */}
            <div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: "6px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <FileCodeIcon size={12} /> Starter Living Docs ({activePreset.starterDocs?.length || 2})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {(
                  activePreset.starterDocs || [
                    { title: "System Architecture & Living Specification" },
                    { title: "Design Verification Plan & Report (DVP&R)" },
                  ]
                ).map((doc) => (
                  <div
                    key={doc.title}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "11px",
                      color: "#94a3b8",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      background: "rgba(255, 255, 255, 0.03)",
                    }}
                  >
                    <span style={{ color: "#38bdf8" }}>📄</span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {doc.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "16px 28px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: "11px", color: "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>Keyboard shortcut:</span>
            <kbd
              style={{
                padding: "2px 6px",
                borderRadius: "4px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                fontFamily: "monospace",
                fontSize: "10px",
                color: "#94a3b8",
              }}
            >
              ⌘/Ctrl + Enter
            </kbd>
            <span>to provision</span>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 16px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                background: "transparent",
                color: "inherit",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-space-form"
              disabled={submitting}
              style={{
                padding: "9px 20px",
                borderRadius: "8px",
                border: "none",
                background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 2px 10px rgba(37, 99, 235, 0.4)",
                transition: "all 0.15s ease",
              }}
            >
              <span>{submitting ? "Provisioning Git Vault & Channels..." : "Create Space"}</span>
              {!submitting && <ArrowRightIcon size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateSpaceModal;
