// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, CodeIcon, GitBranchIcon, LinkExternalIcon, ShareIcon, SyncIcon } from "@primer/octicons-react";
import { Button, IconButton, Spinner, Text } from "@primer/react";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/ComposeContext";
import { useTheme } from "../theme";

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100vh - 54px - var(--dev-header-height, 0px));
  background-color: var(--color-canvas-default, #0d1117);
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background-color: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
  z-index: 10;
  box-sizing: border-box;
`;

const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const BreadcrumbText = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-fg-default);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  a {
    color: var(--color-accent-cyan);
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  .separator {
    color: var(--color-fg-muted);
  }
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan);
  border: 1px solid rgba(6, 182, 212, 0.25);
`;

const IframeWrapper = styled.div`
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-canvas-default, #0d1117);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 5;
  color: var(--color-fg-muted, #8b949e);
  font-size: 14px;
`;

const TEMPLATE_NAMES: Record<string, string> = {
  "bouncing-ball": "Bouncing Ball (Continuous Simulation)",
  rlc: "RLC Circuit (Analogue Electronics)",
  sysml2: "SysML v2 Vehicle Architecture",
  "drone-chassis": "Drone Chassis Thread (Multi-Disciplinary CAD/FEA/CFD)",
  "injection-molding-cosim": "Injection Molding Co-Simulation",
  surrogate: "AI Surrogate ROMs (WASM Neural Models)",
  "cfd-verification": "CFD-FMU Thermal Verification",
  calibration: "Parameter Calibration & Fitting",
  "optimica-polyglot": "SysML2 / Optimica Optimal Control",
  uncertainty: "Monte Carlo Uncertainty Analysis",
  "assembly-to-multibody": "STEP CAD to Multi-Body Dynamic Model",
  "modelica-procedural-cad": "Modelica Procedural 3D CAD",
  cosim: "Multi-FMU Co-Simulation Master",
  "uns-mqtt": "UNS / MQTT Digital Twin Streaming",
  "owl2-contradiction": "OWL2 Contradiction Detection",
  "owl2-fmea": "OWL2 FMEA Fault Propagation",
  "owl2-manufacturing": "Supply Chain & Manufacturing Ontologies",
  "owl2-subsumption": "Component Subsumption Reasoning",
  "owl2-units": "Semantic Unit Verification",
  empty: "Blank Project",
  notebook: "Interactive Engineering Notebook",
  script: "ModelScript REPL & Automation Script",
  cad: "3D CAD Polyglot Modeler",
  "drone-meshing": "Drone Mesh Generation",
  "drone-fea": "Drone Finite Element Analysis",
  "drone-cfd": "Drone Computational Fluid Dynamics",
};

export const IdeWorkspacePage: React.FC = () => {
  const { provider, namespace, project, templateId } = useParams<{
    provider?: string;
    namespace?: string;
    project?: string;
    templateId?: string;
  }>();

  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { theme } = useTheme();
  const { openCompose } = useContext(ComposeContext);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Compute folder hash and title
  const { folderHash, displayTitle, backUrl, branchName } = useMemo(() => {
    // 1. Repository route: /repos/:provider/:namespace/:project/ide
    if (namespace && project) {
      const ref = searchParams.get("ref") || "main";
      const fullRepo = `${namespace}/${project}`;
      return {
        folderHash: `#${fullRepo}@${ref}`,
        displayTitle: fullRepo,
        backUrl: `/repos/${provider || "github"}/${namespace}/${project}`,
        branchName: ref,
      };
    }

    // 2. Template route: /ide/:templateId or /ide?template=...
    const tId = templateId || searchParams.get("template");
    if (tId) {
      const friendlyName = TEMPLATE_NAMES[tId] || tId;
      return {
        folderHash: `#memfs:${tId}`,
        displayTitle: friendlyName,
        backUrl: "/explore",
        branchName: undefined,
      };
    }

    // 3. Fallback: query param or blank project
    const customHash = location.hash || "#memfs:empty";
    return {
      folderHash: customHash,
      displayTitle: "Blank Workspace",
      backUrl: "/home",
      branchName: undefined,
    };
  }, [namespace, project, provider, searchParams, templateId, location.hash]);

  const workbenchUrl = useMemo(() => {
    return `/vscode/workbench${folderHash}`;
  }, [folderHash]);

  // Sync state to iframe when loaded
  const handleIframeLoad = () => {
    setIsLoading(false);
    sendSyncState();
  };

  const sendSyncState = () => {
    if (!iframeRef.current?.contentWindow) return;
    const targetOrigin = window.location.origin;
    try {
      // 1. Sync authentication
      if (token && user) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: "MODELSCRIPT_AUTH_SYNC",
            token,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.display_name,
              email: user.email,
            },
          },
          targetOrigin,
        );
      }

      // 2. Sync theme
      iframeRef.current.contentWindow.postMessage(
        {
          type: "MODELSCRIPT_THEME_SYNC",
          theme: theme === "dark" ? "night" : "day",
        },
        targetOrigin,
      );
    } catch {
      // Cross-origin restriction fallback
    }
  };

  const syncStateRef = useRef(sendSyncState);
  useEffect(() => {
    syncStateRef.current = sendSyncState;
  });

  // Listen to messages from child VS Code iframe via postMessage and BroadcastChannel
  useEffect(() => {
    const processMessageData = (data: Record<string, unknown> | null | undefined) => {
      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "MODELSCRIPT_READY":
          syncStateRef.current();
          break;

        case "MODELSCRIPT_SHARE_TO_FEED":
          if (data.payload) {
            window.dispatchEvent(
              new CustomEvent("modelscript:open-compose", {
                detail: data.payload,
              }),
            );
          }
          openCompose();
          break;

        case "MODELSCRIPT_NAVIGATE":
          if (data.path && typeof data.path === "string") {
            navigate(data.path);
          }
          break;
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      processMessageData(event.data);
    };

    window.addEventListener("message", handleMessage);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("modelscript:host-bridge");
      channel.onmessage = (event) => {
        processMessageData(event.data);
      };
    } catch {
      // BroadcastChannel not available in environment
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      channel?.close();
    };
  }, [navigate, openCompose]);

  return (
    <PageContainer>
      <Toolbar>
        <ToolbarLeft>
          {backUrl && (
            <IconButton
              aria-label="Back"
              icon={ArrowLeftIcon}
              size="small"
              variant="invisible"
              onClick={() => navigate(backUrl)}
              sx={{ color: "var(--color-fg-muted)" }}
            />
          )}

          <BreadcrumbText>
            <CodeIcon />
            {namespace && project ? (
              <>
                <Link to={`/repos/${provider || "github"}/${namespace}/${project}`}>{namespace}</Link>
                <span className="separator">/</span>
                <Link to={`/repos/${provider || "github"}/${namespace}/${project}`}>
                  <strong>{project}</strong>
                </Link>
                {branchName && (
                  <Badge>
                    <GitBranchIcon size={12} />
                    {branchName}
                  </Badge>
                )}
              </>
            ) : (
              <>
                <Text style={{ fontWeight: 600 }}>{displayTitle}</Text>
                <Badge>memfs</Badge>
              </>
            )}
          </BreadcrumbText>
        </ToolbarLeft>

        <ToolbarRight>
          <Button
            size="small"
            variant="default"
            leadingVisual={ShareIcon}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("modelscript:open-compose", {
                  detail: {
                    content: `Check out my model in the ModelScript IDE: ${displayTitle}`,
                    title: displayTitle,
                  },
                }),
              );
              openCompose();
            }}
          >
            Share to Feed
          </Button>

          <IconButton
            aria-label="Reload Workbench"
            icon={SyncIcon}
            size="small"
            variant="invisible"
            onClick={() => {
              setIsLoading(true);
              setReloadKey((k) => k + 1);
            }}
            sx={{ color: "var(--color-fg-muted)" }}
          />

          <IconButton
            aria-label="Open in Dedicated Tab"
            icon={LinkExternalIcon}
            size="small"
            variant="invisible"
            onClick={() => window.open(workbenchUrl, "_blank")}
            sx={{ color: "var(--color-fg-muted)" }}
          />
        </ToolbarRight>
      </Toolbar>

      <IframeWrapper>
        {isLoading && (
          <LoadingOverlay>
            <Spinner size="large" />
            <Text>Initializing ModelScript IDE & WebAssembly Solvers...</Text>
          </LoadingOverlay>
        )}
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={workbenchUrl}
          title="ModelScript IDE Workbench"
          allow="clipboard-read; clipboard-write"
          onLoad={handleIframeLoad}
        />
      </IframeWrapper>
    </PageContainer>
  );
};

export default IdeWorkspacePage;
