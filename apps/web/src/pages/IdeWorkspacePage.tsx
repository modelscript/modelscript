// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getArtifactView } from "../api";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/ComposeContext";
import { useTheme } from "../theme";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";
import {
  IdeDeprecationBanner,
  IdeToolbar,
  IdeWorkbenchFrame,
  PageContainer,
  TEMPLATE_NAMES,
  type IdeArtifactMetadata,
  type LspStatusState,
} from "./ide";

export const IdeWorkspacePage: React.FC = () => {
  const { provider, namespace, project, templateId } = useParams<{
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
  const { openCompose } = useContext(ComposeContext);

  const sourceParam = searchParams.get("source");
  const titleParam = searchParams.get("title");

  const [artifactMetadata, setArtifactMetadata] = useState<IdeArtifactMetadata | null>(null);

  const artifactIdFromHash = useMemo(() => {
    if (location.hash && location.hash.startsWith("#memfs:artifact-")) {
      return location.hash.slice("#memfs:artifact-".length);
    }
    return null;
  }, [location.hash]);

  const packageNameFromHash = useMemo(() => {
    if (location.hash && location.hash.startsWith("#memfs:package-")) {
      return location.hash.slice("#memfs:package-".length);
    }
    return null;
  }, [location.hash]);

  useEffect(() => {
    let active = true;
    if (artifactIdFromHash) {
      getArtifactView(artifactIdFromHash)
        .then((data) => {
          if (!active) return;
          const av = data?.artifactView;
          if (av) {
            const config = safeJsonParse(av.view_config, {});
            setArtifactMetadata({
              id: av.id,
              title: av.title || av.name || `Artifact #${av.id}`,
              viewType: av.view_type || "modelica-code",
              viewConfig: config,
            });
          }
        })
        .catch((err) => {
          console.warn("[IdeWorkspacePage] Failed to fetch artifact metadata:", err);
        });
    } else if (sourceParam) {
      const decodedSource = decodeURIComponent(sourceParam);
      const title = titleParam ? decodeURIComponent(titleParam) : "ScratchModel.mo";
      const modelName = title.replace(/\.[^/.]+$/, "");
      const meta: IdeArtifactMetadata = {
        id: "scratch",
        title,
        viewType: "modelica-code",
        viewConfig: {
          code: decodedSource,
          model: modelName,
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
  }, [artifactIdFromHash, sourceParam, titleParam]);

  usePageTitle(
    project
      ? `${project} — Web IDE`
      : artifactMetadata
        ? `${artifactMetadata.title} — Web IDE`
        : packageNameFromHash
          ? `${packageNameFromHash} — Web IDE`
          : "Web IDE",
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [showDeprecationNotice, setShowDeprecationNotice] = useState(true);
  const [lspStatus, setLspStatus] = useState<LspStatusState | null>(null);

  const handleRestartLsp = () => {
    setLspStatus({ status: "loading", message: "Restarting language server…" });
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: "MODELSCRIPT_RESTART_LSP" }, window.location.origin);
      const channel = new BroadcastChannel("modelscript:host-bridge");
      channel.postMessage({ type: "MODELSCRIPT_RESTART_LSP" });
      channel.close();
    } catch {
      // ignore
    }
  };

  // Compute folder hash and title
  const { folderHash, displayTitle, backUrl, branchName, isDeprecated } = useMemo(() => {
    // 1. Repository route: /repos/:provider/:namespace/:project/ide
    if (namespace && project) {
      const ref = searchParams.get("ref") || "main";
      const fullRepo = `${namespace}/${project}`;
      return {
        folderHash: `#${fullRepo}@${ref}`,
        displayTitle: fullRepo,
        backUrl: `/repos/${provider || "github"}/${namespace}/${project}`,
        branchName: ref,
        isDeprecated: false,
      };
    }

    // 2. Template route: /ide/:templateId or /ide?template=...
    const tId = templateId || searchParams.get("template");
    if (tId) {
      const isDep = tId !== "empty" && tId !== "blank" && tId !== "bouncing-ball";
      const friendlyName = TEMPLATE_NAMES[tId] || tId;
      return {
        folderHash: `#memfs:${tId}`,
        displayTitle: friendlyName,
        backUrl: "/explore",
        branchName: undefined,
        isDeprecated: isDep,
      };
    }

    // 3. Fallback: query param, source code handoff, artifact handoff, package, or blank project
    if (sourceParam) {
      const title = titleParam ? decodeURIComponent(titleParam) : "ScratchModel.mo";
      return {
        folderHash: "#memfs:scratch",
        displayTitle: title,
        backUrl: "/feed",
        branchName: undefined,
        isDeprecated: false,
      };
    }

    const customHash = location.hash || "#memfs:empty";
    let title = "Blank Workspace";
    let back = "/home";

    if (artifactIdFromHash) {
      title = artifactMetadata?.title || `Artifact #${artifactIdFromHash}`;
      back = "/feed";
    } else if (packageNameFromHash) {
      title = `Package: ${packageNameFromHash}`;
      back = "/explore";
    }

    return {
      folderHash: customHash,
      displayTitle: title,
      backUrl: back,
      branchName: undefined,
      isDeprecated: false,
    };
  }, [
    namespace,
    project,
    provider,
    searchParams,
    templateId,
    location.hash,
    artifactIdFromHash,
    packageNameFromHash,
    artifactMetadata,
    sourceParam,
    titleParam,
  ]);

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

      // 3. Sync artifact mounting
      if (artifactMetadata) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: "MODELSCRIPT_MOUNT_ARTIFACT",
            artifactId: artifactMetadata.id,
            title: artifactMetadata.title,
            viewType: artifactMetadata.viewType,
            viewConfig: artifactMetadata.viewConfig,
          },
          targetOrigin,
        );

        try {
          const bridge = new BroadcastChannel("modelscript:host-bridge");
          bridge.postMessage({
            type: "MODELSCRIPT_MOUNT_ARTIFACT",
            artifactId: artifactMetadata.id,
            title: artifactMetadata.title,
            viewType: artifactMetadata.viewType,
            viewConfig: artifactMetadata.viewConfig,
          });
          bridge.close();
        } catch {
          // ignore
        }
      }
    } catch {
      // Cross-origin restriction fallback
    }
  };

  const syncStateRef = useRef(sendSyncState);
  useEffect(() => {
    syncStateRef.current = sendSyncState;
  });

  useEffect(() => {
    if (artifactMetadata) {
      sendSyncState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactMetadata]);

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
            openCompose(data.payload as any);
          } else {
            openCompose();
          }
          break;

        case "MODELSCRIPT_LSP_STATUS":
          if (data.status && typeof data.status === "string") {
            setLspStatus({
              status: data.status,
              message: typeof data.message === "string" ? data.message : undefined,
            });
          }
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
      <IdeToolbar
        backUrl={backUrl}
        onBack={() => navigate(backUrl)}
        namespace={namespace}
        project={project}
        provider={provider}
        branchName={branchName}
        displayTitle={displayTitle}
        artifactMetadata={artifactMetadata}
        packageNameFromHash={packageNameFromHash}
        isDeprecated={isDeprecated}
        lspStatus={lspStatus}
        onRestartLsp={handleRestartLsp}
        onShare={() => {
          const fromArtifactParam = searchParams.get("fromArtifact");
          const forkedId = fromArtifactParam
            ? Number(fromArtifactParam)
            : artifactIdFromHash
              ? Number(artifactIdFromHash)
              : undefined;

          if (artifactIdFromHash) {
            openCompose({
              content: `Sharing an update on **${displayTitle}**:`,
              artifactId: Number(artifactIdFromHash),
              forkedFromArtifactId: forkedId,
            });
            return;
          }

          if (artifactMetadata?.viewConfig?.code && typeof artifactMetadata.viewConfig.code === "string") {
            openCompose({
              content: `Check out my model in the ModelScript IDE: **${displayTitle}**`,
              morselPayload: {
                code: artifactMetadata.viewConfig.code,
                title: displayTitle.replace(/\.[^/.]+$/, ""),
                dialect: "modelica",
              },
              forkedFromArtifactId: forkedId,
            });
            return;
          }

          try {
            iframeRef.current?.contentWindow?.postMessage(
              { type: "MODELSCRIPT_REQUEST_ACTIVE_FILE" },
              window.location.origin,
            );
          } catch {
            // cross-origin fallback
          }

          openCompose({
            content: `Check out my workspace in the ModelScript IDE: **${displayTitle}**`,
            forkedFromArtifactId: forkedId,
          });
        }}
        onReload={() => {
          setIsLoading(true);
          setReloadKey((k) => k + 1);
        }}
        onOpenDedicatedTab={() => window.open(workbenchUrl, "_blank")}
      />

      {isDeprecated && showDeprecationNotice && (
        <IdeDeprecationBanner
          displayTitle={displayTitle}
          onSwitchToBlank={() => navigate("/ide")}
          onDismiss={() => setShowDeprecationNotice(false)}
        />
      )}

      <IdeWorkbenchFrame
        isLoading={isLoading}
        reloadKey={reloadKey}
        workbenchUrl={workbenchUrl}
        iframeRef={iframeRef}
        onIframeLoad={handleIframeLoad}
      />
    </PageContainer>
  );
};

export default IdeWorkspacePage;
