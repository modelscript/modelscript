// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, PlusIcon, RepoIcon, SearchIcon, ShareAndroidIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { getArtifactView, getPopularRepos, getRepos } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { ComposeContext } from "../components/ComposeContext";
import { VsCodeIcon } from "../components/icons/VsCodeIcon";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { useTheme } from "../theme";
import type { RepositoryDTO } from "../types/api";
import {
  buildEditorUrlForArtifact,
  getExtensionForDialect,
  inferDialectFromArtifact,
  inferDialectFromFilename,
  isMultiFileArtifact,
  openArtifactInVsCodeWindow,
} from "../util/editor-routing";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";
import { TEMPLATE_NAMES, type IdeArtifactMetadata } from "./ide";

interface WorkspaceTemplateItem {
  id: string;
  name: string;
  category: "featured" | "cad-cae" | "cosim" | "sysml-owl" | "simulation";
  badge: string;
  description: string;
}

const WORKSPACE_CATALOG: WorkspaceTemplateItem[] = [
  {
    id: "drone-chassis",
    name: TEMPLATE_NAMES["drone-chassis"] || "Drone Chassis Thread",
    category: "featured",
    badge: "CAD · FEA · CFD",
    description:
      "End-to-end digital thread linking SysML v2 requirements, STEP geometry, CalculiX FEA, and SU2 aerodynamics.",
  },
  {
    id: "bouncing-ball",
    name: TEMPLATE_NAMES["bouncing-ball"] || "Bouncing Ball",
    category: "simulation",
    badge: "Modelica",
    description: "Hybrid continuous-discrete contact dynamics simulation with event detection and trajectory plots.",
  },
  {
    id: "rlc",
    name: TEMPLATE_NAMES["rlc"] || "RLC Circuit",
    category: "simulation",
    badge: "Modelica",
    description: "Analogue electrical circuit schematic and transient frequency response workspace.",
  },
  {
    id: "sysml2",
    name: TEMPLATE_NAMES["sysml2"] || "SysML v2 Vehicle Architecture",
    category: "sysml-owl",
    badge: "SysML v2",
    description: "Systems engineering architecture decomposition, port definitions, and constraint verification.",
  },
  {
    id: "cad",
    name: TEMPLATE_NAMES["cad"] || "3D CAD Polyglot Modeler",
    category: "cad-cae",
    badge: "STEP / OpenSCAD",
    description: "Parametric 3D solid modeling, CSG boolean operations, and ISO 10303 STEP assembly inspection.",
  },
  {
    id: "drone-fea",
    name: TEMPLATE_NAMES["drone-fea"] || "Drone Finite Element Analysis",
    category: "cad-cae",
    badge: "CalculiX FEA",
    description: "Structural stress and displacement solver deck (.inp) with 3D VTU Von Mises contour visualization.",
  },
  {
    id: "drone-cfd",
    name: TEMPLATE_NAMES["drone-cfd"] || "Drone Computational Fluid Dynamics",
    category: "cad-cae",
    badge: "SU2 CFD",
    description: "External aerodynamics config (.cfg) and surface pressure coefficient / streamline field analysis.",
  },
  {
    id: "injection-molding-cosim",
    name: TEMPLATE_NAMES["injection-molding-cosim"] || "Injection Molding Co-Simulation",
    category: "cosim",
    badge: "SSP / FMI 2.0",
    description:
      "Multi-domain thermal-hydraulic FMI co-simulation orchestrated via System Structure & Parameterization.",
  },
  {
    id: "cosim",
    name: TEMPLATE_NAMES["cosim"] || "Multi-FMU Co-Simulation Master",
    category: "cosim",
    badge: "FMI 2.0 / 3.0",
    description: "Coupled Functional Mock-up Unit master topology with adaptive step-size control.",
  },
  {
    id: "surrogate",
    name: TEMPLATE_NAMES["surrogate"] || "AI Surrogate ROMs",
    category: "featured",
    badge: "WASM Neural",
    description: "Reduced-order neural surrogate training and real-time inference calibrated against physics solvers.",
  },
  {
    id: "calibration",
    name: TEMPLATE_NAMES["calibration"] || "Parameter Calibration & Fitting",
    category: "simulation",
    badge: "Optimization",
    description: "Automated parameter estimation against experimental CSV telemetry traces.",
  },
  {
    id: "uncertainty",
    name: TEMPLATE_NAMES["uncertainty"] || "Monte Carlo Uncertainty Analysis",
    category: "simulation",
    badge: "Stochastic",
    description: "Batched sensitivity dispersion and confidence band quantification across parameter distributions.",
  },
  {
    id: "owl2-fmea",
    name: TEMPLATE_NAMES["owl2-fmea"] || "OWL2 FMEA Fault Propagation",
    category: "sysml-owl",
    badge: "OWL2 Ontology",
    description: "Formal ontological reasoning for Failure Modes and Effects Analysis across hardware hierarchies.",
  },
  {
    id: "notebook",
    name: TEMPLATE_NAMES["notebook"] || "Interactive Engineering Notebook",
    category: "featured",
    badge: "Notebook",
    description: "Literate engineering document combining executable simulations, equations, and live 3D views.",
  },
];

const HeaderSection = styled.div`
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const SearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 8px 12px;

  &:focus-within {
    border-color: var(--color-accent-cyan, #38bdf8);
  }

  input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 14px;
    outline: none;
  }
`;

const CategoryPills = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
`;

const CategoryPill = styled.button<{ $active: boolean }>`
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid ${(props) => (props.$active ? "rgba(56, 189, 248, 0.5)" : "var(--color-border)")};
  background: ${(props) =>
    props.$active
      ? "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(59, 130, 246, 0.15))"
      : "var(--color-canvas-subtle)"};
  color: ${(props) => (props.$active ? "#38bdf8" : "var(--color-text-secondary)")};
  transition: all 0.15s ease;

  &:hover {
    border-color: rgba(56, 189, 248, 0.4);
    color: var(--color-text-primary);
  }
`;

const WorkspaceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px;
  padding: 16px 20px;
`;

const WorkspaceCard = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-canvas-subtle);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: rgba(56, 189, 248, 0.45);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  }
`;

const HeroHandoffCard = styled.div`
  margin: 16px 20px 4px;
  padding: 18px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(139, 92, 246, 0.1));
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const LaunchButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(59, 130, 246, 0.2));
  color: #38bdf8;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: linear-gradient(135deg, rgba(14, 165, 233, 0.32), rgba(59, 130, 246, 0.3));
    border-color: rgba(56, 189, 248, 0.7);
  }
`;

const RepoRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--surface-row-hover, rgba(255, 255, 255, 0.02));
  }
`;

export const IdeWorkspacePage: React.FC = () => {
  const {
    provider: _provider,
    namespace,
    project,
    templateId,
  } = useParams<{
    provider?: string | undefined;
    namespace?: string | undefined;
    project?: string | undefined;
    templateId?: string | undefined;
  }>();

  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { theme } = useTheme();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const { openCompose } = useContext(ComposeContext);

  const sourceParam = searchParams.get("source");
  const titleParam = searchParams.get("title");
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");

  const editPostId = editPostIdParam ? Number(editPostIdParam) : undefined;
  const replyToPostId = replyToPostIdParam ? Number(replyToPostIdParam) : undefined;

  const [artifactMetadata, setArtifactMetadata] = useState<IdeArtifactMetadata | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [repos, setRepos] = useState<RepositoryDTO[]>([]);
  const [reposLoading, setReposLoading] = useState<boolean>(true);

  const artifactIdFromHash = useMemo(() => {
    if (location.hash && location.hash.startsWith("#memfs:artifact-")) {
      return location.hash.slice("#memfs:artifact-".length).split("&")[0] || null;
    }
    return null;
  }, [location.hash]);

  const effectiveArtifactId = artifactIdFromHash || fromArtifactParam;

  const packageNameFromHash = useMemo(() => {
    if (location.hash && location.hash.startsWith("#memfs:package-")) {
      return location.hash.slice("#memfs:package-".length);
    }
    return null;
  }, [location.hash]);

  useEffect(() => {
    let active = true;
    if (effectiveArtifactId && !sourceParam) {
      getArtifactView(effectiveArtifactId)
        .then((data) => {
          if (!active) return;
          const av = data?.artifactView || data;
          if (av) {
            const config =
              typeof av.view_config === "string" ? safeJsonParse(av.view_config, {}) : av.view_config || {};
            setArtifactMetadata({
              id: av.id ?? effectiveArtifactId,
              title: titleParam || av.title || av.name || `Artifact #${av.id ?? effectiveArtifactId}`,
              viewType: av.view_type || "modelica-code",
              viewConfig: config,
            });
          }
        })
        .catch((err) => {
          console.warn("[IdeWorkspacePage] Failed to fetch artifact metadata:", err);
        });
    } else if (sourceParam) {
      const dialect = langParam || inferDialectFromFilename(titleParam) || "modelica";
      const ext = getExtensionForDialect(dialect);
      const rawTitle = titleParam || `ScratchModel${ext}`;
      const fileName = rawTitle.includes(".") ? rawTitle : `${rawTitle.replace(/\s+/g, "_")}${ext}`;
      const modelName = rawTitle.replace(/\.[^/.]+$/, "");
      const meta: IdeArtifactMetadata = {
        id: fromArtifactParam || "scratch",
        title: fileName,
        viewType: dialect === "sysml2" ? "sysml" : "modelica-code",
        viewConfig: {
          code: sourceParam,
          model: modelName,
          dialect,
          primaryFile: fileName,
        },
      };
      setArtifactMetadata(meta);
      try {
        sessionStorage.setItem("modelscript.artifact_scratch", JSON.stringify(meta));
      } catch {
        // ignore
      }
    } else {
      setArtifactMetadata(null);
    }
    return () => {
      active = false;
    };
  }, [effectiveArtifactId, fromArtifactParam, langParam, sourceParam, titleParam]);

  useEffect(() => {
    let active = true;
    setReposLoading(true);
    const loadRepos = async () => {
      try {
        const res = token ? await getRepos() : await getPopularRepos(8);
        if (!active) return;
        const list = res?.repos || [];
        if (list.length === 0 && token) {
          const fallback = await getPopularRepos(8);
          if (active) setRepos(fallback?.repos || []);
        } else {
          setRepos(list.slice(0, 8));
        }
      } catch {
        if (active) setRepos([]);
      } finally {
        if (active) setReposLoading(false);
      }
    };
    loadRepos();
    return () => {
      active = false;
    };
  }, [token]);

  const hasSpecificHandoff = Boolean(
    (namespace && project) ||
    templateId ||
    searchParams.get("template") ||
    sourceParam ||
    effectiveArtifactId ||
    packageNameFromHash,
  );

  // Compute folder hash and title for handoff workspace
  const { folderHash, displayTitle, branchName } = useMemo(() => {
    if (namespace && project) {
      const ref = searchParams.get("ref") || "main";
      const fullRepo = `${namespace}/${project}`;
      return {
        folderHash: `#${fullRepo}@${ref}`,
        displayTitle: fullRepo,
        branchName: ref,
      };
    }

    const tId = templateId || searchParams.get("template");
    if (tId) {
      const friendlyName = TEMPLATE_NAMES[tId] || tId;
      return {
        folderHash: `#memfs:${tId}`,
        displayTitle: friendlyName,
        branchName: undefined,
      };
    }

    if (sourceParam) {
      const title = titleParam || "ScratchModel.mo";
      return {
        folderHash: "#memfs:scratch",
        displayTitle: title,
        branchName: undefined,
      };
    }

    const customHash =
      location.hash || (effectiveArtifactId ? `#memfs:artifact-${effectiveArtifactId}` : "#memfs:empty");
    let title = "Blank Workspace";

    if (effectiveArtifactId) {
      title = artifactMetadata?.title || titleParam || `Artifact #${effectiveArtifactId}`;
    } else if (packageNameFromHash) {
      title = `Package: ${packageNameFromHash}`;
    }

    return {
      folderHash: customHash,
      displayTitle: title,
      branchName: undefined,
    };
  }, [
    namespace,
    project,
    searchParams,
    templateId,
    location.hash,
    effectiveArtifactId,
    packageNameFromHash,
    artifactMetadata,
    sourceParam,
    titleParam,
  ]);

  usePageTitle(hasSpecificHandoff ? `${displayTitle} — ${brandName} IDE` : `${brandName} IDE — Select Workspace`);

  const workbenchUrl = useMemo(() => `/vscode/workbench${folderHash}`, [folderHash]);

  const broadcastSyncState = useCallback(() => {
    try {
      const bridge = new BroadcastChannel("modelscript:host-bridge");
      if (token && user) {
        bridge.postMessage({
          type: "MODELSCRIPT_AUTH_SYNC",
          token,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            email: user.email,
          },
        });
      }
      bridge.postMessage({
        type: "MODELSCRIPT_THEME_SYNC",
        theme: theme === "dark" ? "night" : "day",
      });
      if (artifactMetadata) {
        bridge.postMessage({
          type: "MODELSCRIPT_MOUNT_ARTIFACT",
          artifactId: artifactMetadata.id,
          title: artifactMetadata.title,
          viewType: artifactMetadata.viewType,
          viewConfig: artifactMetadata.viewConfig,
        });
      }
      bridge.close();
    } catch {
      // ignore
    }
  }, [artifactMetadata, theme, token, user]);

  const resolveForkedFromId = useCallback((): number | undefined => {
    const raw = fromArtifactParam || artifactIdFromHash;
    if (!raw) return undefined;
    const num = Number(raw);
    return Number.isNaN(num) ? undefined : num;
  }, [fromArtifactParam, artifactIdFromHash]);

  const pendingShareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openComposeWithEnrichedPayload = useCallback(
    (incomingPayload?: any) => {
      if (pendingShareTimeoutRef.current) {
        clearTimeout(pendingShareTimeoutRef.current);
        pendingShareTimeoutRef.current = null;
      }

      const forkedId = resolveForkedFromId();
      const baseMorsel = incomingPayload?.morselPayload || {};
      const filesMap = incomingPayload?.files || baseMorsel.files || artifactMetadata?.viewConfig?.files;
      const isMulti =
        incomingPayload?.isMultiFile ??
        baseMorsel.isMultiFile ??
        (filesMap && typeof filesMap === "object" && Object.keys(filesMap).length > 1) ??
        isMultiFileArtifact(artifactMetadata);

      const code =
        incomingPayload?.codeSnippet ??
        baseMorsel.code ??
        (typeof artifactMetadata?.viewConfig?.code === "string" ? artifactMetadata.viewConfig.code : "");

      const dialect =
        incomingPayload?.dialect ||
        baseMorsel.dialect ||
        langParam ||
        inferDialectFromArtifact(artifactMetadata, displayTitle);

      const cleanTitle =
        baseMorsel.title || incomingPayload?.title || displayTitle.replace(/\.[^/.]+$/, "") || "Workspace";

      const defaultContent = editPostId
        ? undefined
        : replyToPostId
          ? `Here is my updated **${cleanTitle}** workspace:`
          : incomingPayload?.content ||
            (forkedId
              ? `Forked and modified **${cleanTitle}** (from Artifact #${forkedId}) in ${brandName} IDE! 🚀`
              : `Check out my workspace in the ${brandName} IDE: **${cleanTitle}** 🚀`);

      const composeInit: any = {
        ...(defaultContent !== undefined ? { content: defaultContent } : {}),
        morselPayload: {
          title: cleanTitle,
          code,
          dialect,
          isMultiFile: Boolean(isMulti),
          ...(filesMap && typeof filesMap === "object" ? { files: filesMap } : {}),
          ...(incomingPayload?.primaryFile || baseMorsel.primaryFile
            ? { primaryFile: incomingPayload?.primaryFile || baseMorsel.primaryFile }
            : {}),
          ...(forkedId ? { forkedFromArtifactId: forkedId } : {}),
        },
        ...(forkedId ? { forkedFromArtifactId: forkedId } : {}),
        ...(editPostId !== undefined && !Number.isNaN(editPostId) ? { editPostId } : {}),
        ...(replyToPostId !== undefined && !Number.isNaN(replyToPostId)
          ? { replyToPostId, replyToPost: { id: replyToPostId } }
          : {}),
      };

      openCompose(composeInit);
    },
    [artifactMetadata, brandName, displayTitle, editPostId, langParam, openCompose, replyToPostId, resolveForkedFromId],
  );

  // Listen to messages from standalone VS Code window via BroadcastChannel
  useEffect(() => {
    let lastHandledShareTimestamp = 0;

    const processMessageData = (data: any) => {
      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "MODELSCRIPT_READY":
          broadcastSyncState();
          break;

        case "MODELSCRIPT_WORKSPACE_SNAPSHOT":
        case "MODELSCRIPT_SHARE_TO_FEED": {
          const now = Date.now();
          if (now - lastHandledShareTimestamp < 250) {
            return;
          }
          lastHandledShareTimestamp = now;
          openComposeWithEnrichedPayload(data.payload as any);
          break;
        }

        case "MODELSCRIPT_NAVIGATE":
          if (data.path && typeof data.path === "string") {
            navigate(data.path);
          }
          break;
      }
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("modelscript:host-bridge");
      channel.onmessage = (event) => {
        processMessageData(event.data);
      };
    } catch {
      // BroadcastChannel not available
    }

    return () => {
      channel?.close();
      if (pendingShareTimeoutRef.current) {
        clearTimeout(pendingShareTimeoutRef.current);
      }
    };
  }, [broadcastSyncState, navigate, openComposeWithEnrichedPayload]);

  const handleLaunchVsCodeUrl = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(broadcastSyncState, 700);
    setTimeout(broadcastSyncState, 1800);
  };

  const handleLaunchHandoffInVsCode = () => {
    if (effectiveArtifactId || artifactMetadata) {
      openArtifactInVsCodeWindow({
        artifactId: effectiveArtifactId || artifactMetadata?.id,
        viewType: artifactMetadata?.viewType,
        viewConfig: artifactMetadata?.viewConfig,
        title: displayTitle,
        dialect: langParam || undefined,
      });
      return;
    }
    handleLaunchVsCodeUrl(workbenchUrl);
  };

  const canOpenInPlayground = !namespace && !project && !isMultiFileArtifact(artifactMetadata);

  const handleOpenInPlayground = () => {
    const url = buildEditorUrlForArtifact({
      artifactId: resolveForkedFromId(),
      viewType: artifactMetadata?.viewType,
      viewConfig: artifactMetadata?.viewConfig,
      code:
        typeof artifactMetadata?.viewConfig?.code === "string"
          ? artifactMetadata.viewConfig.code
          : sourceParam || undefined,
      title: displayTitle,
      dialect: langParam || inferDialectFromArtifact(artifactMetadata, displayTitle),
      editPostId,
      replyToPostId,
    });
    navigate(url);
  };

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return WORKSPACE_CATALOG.filter((item) => {
      if (selectedCategory !== "all" && item.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, selectedCategory]);

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%" }}>
      <HeaderSection>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" alignItems="center" gap={2.5}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "linear-gradient(135deg, rgba(14, 165, 233, 0.18), rgba(59, 130, 246, 0.15))",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <VsCodeIcon size={20} color="#38bdf8" />
            </div>
            <Box display="flex" flexDirection="column">
              <Heading as="h1" style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
                {brandName} IDE
              </Heading>
              <Text style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                Select a workspace to launch in a dedicated VS Code window (powered by ModelScript)
              </Text>
            </Box>
          </Box>

          <Box display="flex" alignItems="center" gap={2}>
            <LaunchButton
              type="button"
              onClick={() => handleLaunchVsCodeUrl("/vscode/workbench#memfs:empty")}
              title="Open a fresh blank workspace in a new VS Code window"
            >
              <PlusIcon size={14} />
              <span>New Blank Workspace</span>
              <span style={{ opacity: 0.75 }}>↗</span>
            </LaunchButton>
          </Box>
        </Box>

        <SearchRow>
          <SearchIcon size={16} fill="var(--color-text-muted)" />
          <input
            type="text"
            placeholder="Filter workspaces by domain, solver, or language (e.g. Drone, Modelica, SysML, FEA, CFD)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter workspaces"
          />
        </SearchRow>

        <CategoryPills>
          {[
            { id: "all", label: "All Workspaces" },
            { id: "featured", label: "Digital Threads & Featured" },
            { id: "cad-cae", label: "3D CAD · FEA · CFD" },
            { id: "cosim", label: "FMI / SSP Co-Simulation" },
            { id: "sysml-owl", label: "SysML v2 & Ontologies" },
            { id: "simulation", label: "System Simulation" },
          ].map((cat) => (
            <CategoryPill
              key={cat.id}
              type="button"
              $active={selectedCategory === cat.id}
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.label}
            </CategoryPill>
          ))}
        </CategoryPills>
      </HeaderSection>

      {hasSpecificHandoff && (
        <HeroHandoffCard>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
            <Box display="flex" flexDirection="column" gap={1}>
              <Box display="flex" alignItems="center" gap={2}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: "rgba(56, 189, 248, 0.2)",
                    color: "#38bdf8",
                    border: "1px solid rgba(56, 189, 248, 0.35)",
                  }}
                >
                  Selected Workspace
                </span>
                {branchName && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono, monospace)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    @{branchName}
                  </span>
                )}
              </Box>
              <Heading as="h2" style={{ fontSize: "16px", fontWeight: 700, margin: "2px 0 0" }}>
                {displayTitle}
              </Heading>
              <Text style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Launch this workspace in a standalone VS Code window for full screen real estate and multi-file LSP
                support.
              </Text>
            </Box>

            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <LaunchButton type="button" onClick={handleLaunchHandoffInVsCode}>
                <VsCodeIcon size={15} color="#38bdf8" />
                <span>Launch in VS Code Window</span>
                <span>↗</span>
              </LaunchButton>

              {canOpenInPlayground && (
                <button
                  type="button"
                  onClick={handleOpenInPlayground}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <PlayIcon size={13} />
                  <span>Open in Playground</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => openComposeWithEnrichedPayload(undefined)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-canvas-subtle)",
                  color: "var(--color-text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <ShareAndroidIcon size={13} />
                <span>Share to Feed</span>
              </button>
            </Box>
          </Box>
        </HeroHandoffCard>
      )}

      <Box px={3} pt={3} pb={1} display="flex" justifyContent="space-between" alignItems="center">
        <Text
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
          }}
        >
          Starter Workspaces &amp; Digital Threads ({filteredTemplates.length})
        </Text>
      </Box>

      <WorkspaceGrid>
        {filteredTemplates.map((tpl) => (
          <WorkspaceCard
            key={tpl.id}
            onClick={() => handleLaunchVsCodeUrl(`/vscode/workbench#memfs:${tpl.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleLaunchVsCodeUrl(`/vscode/workbench#memfs:${tpl.id}`);
              }
            }}
          >
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    background: "rgba(56, 189, 248, 0.14)",
                    color: "#38bdf8",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                  }}
                >
                  {tpl.badge}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "11px",
                    fontWeight: 600,
                    fontFamily: "var(--font-mono, monospace)",
                    color: "#38bdf8",
                  }}
                >
                  <VsCodeIcon size={13} color="#38bdf8" />
                  <span>Open ↗</span>
                </span>
              </Box>

              <Text style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>{tpl.name}</Text>

              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.45 }}>
                {tpl.description}
              </Text>
            </Box>
          </WorkspaceCard>
        ))}
      </WorkspaceGrid>

      <Box
        px={3}
        pt={3}
        pb={2}
        borderTop="1px solid var(--color-border)"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box display="flex" alignItems="center" gap={1.5}>
          <RepoIcon size={15} />
          <Text
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-text-muted)",
            }}
          >
            Git Repositories
          </Text>
        </Box>
        <Link
          to="/repos"
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--color-accent-cyan, #38bdf8)",
            textDecoration: "none",
          }}
        >
          Browse all repositories →
        </Link>
      </Box>

      {reposLoading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="small" />
        </Box>
      ) : repos.length === 0 ? (
        <Box p={4} color="var(--color-text-muted)" style={{ fontSize: "13px" }}>
          No repositories found. Visit <Link to="/repos">Repositories</Link> to create or import a project.
        </Box>
      ) : (
        <Box display="flex" flexDirection="column">
          {repos.map((repo) => {
            const fullPath = `${repo.namespace}/${repo.project}`;
            const wsUrl = `/vscode/workbench#${fullPath}@main`;
            return (
              <RepoRow key={`${repo.provider}-${fullPath}`}>
                <Box display="flex" flexDirection="column" gap={0.5} style={{ minWidth: 0 }}>
                  <Text
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fullPath}
                  </Text>
                  {repo.description && (
                    <Text
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {repo.description}
                    </Text>
                  )}
                </Box>
                <LaunchButton
                  type="button"
                  onClick={() => handleLaunchVsCodeUrl(wsUrl)}
                  style={{ padding: "5px 10px", fontSize: "12px", flexShrink: 0 }}
                  title={`Open ${fullPath} in a new VS Code window`}
                >
                  <VsCodeIcon size={13} color="#38bdf8" />
                  <span>Open in VS Code ↗</span>
                </LaunchButton>
              </RepoRow>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default IdeWorkspacePage;
