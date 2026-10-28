// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getArtifactView } from "../api";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/ComposeContext";
import { useTheme } from "../theme";
import {
  buildEditorUrlForArtifact,
  getExtensionForDialect,
  inferDialectFromArtifact,
  inferDialectFromFilename,
  isMultiFileArtifact,
} from "../util/editor-routing";
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
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");

  const editPostId = editPostIdParam ? Number(editPostIdParam) : undefined;
  const replyToPostId = replyToPostIdParam ? Number(replyToPostIdParam) : undefined;

  const [artifactMetadata, setArtifactMetadata] = useState<IdeArtifactMetadata | null>(null);

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
  const pendingShareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const title = titleParam || "ScratchModel.mo";
      return {
        folderHash: "#memfs:scratch",
        displayTitle: title,
        backUrl: "/home",
        branchName: undefined,
        isDeprecated: false,
      };
    }

    const customHash =
      location.hash || (effectiveArtifactId ? `#memfs:artifact-${effectiveArtifactId}` : "#memfs:empty");
    let title = "Blank Workspace";
    let back = "/home";

    if (effectiveArtifactId) {
      title = artifactMetadata?.title || titleParam || `Artifact #${effectiveArtifactId}`;
      back = "/home";
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
    effectiveArtifactId,
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

  const resolveForkedFromId = useCallback((): number | undefined => {
    const raw = fromArtifactParam || artifactIdFromHash;
    if (!raw) return undefined;
    const num = Number(raw);
    return Number.isNaN(num) ? undefined : num;
  }, [fromArtifactParam, artifactIdFromHash]);

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
              ? `Forked and modified **${cleanTitle}** (from Artifact #${forkedId}) in ModelScript IDE! 🚀`
              : `Check out my workspace in the ModelScript IDE: **${cleanTitle}** 🚀`);

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
    [artifactMetadata, displayTitle, editPostId, langParam, openCompose, replyToPostId, resolveForkedFromId],
  );

  // Listen to messages from child VS Code iframe via postMessage and BroadcastChannel
  useEffect(() => {
    let lastHandledShareTimestamp = 0;

    const processMessageData = (data: any) => {
      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "MODELSCRIPT_READY":
          syncStateRef.current();
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
      if (pendingShareTimeoutRef.current) {
        clearTimeout(pendingShareTimeoutRef.current);
      }
    };
  }, [navigate, openComposeWithEnrichedPayload]);

  const handleRequestShareSnapshot = () => {
    const requestId = `snap-${Date.now()}`;
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "MODELSCRIPT_REQUEST_WORKSPACE_SNAPSHOT", requestId },
        window.location.origin,
      );
      const channel = new BroadcastChannel("modelscript:host-bridge");
      channel.postMessage({ type: "MODELSCRIPT_REQUEST_WORKSPACE_SNAPSHOT", requestId });
      channel.close();
    } catch {
      // ignore cross-origin or broadcast channel error
    }

    if (pendingShareTimeoutRef.current) {
      clearTimeout(pendingShareTimeoutRef.current);
    }
    pendingShareTimeoutRef.current = setTimeout(() => {
      pendingShareTimeoutRef.current = null;
      openComposeWithEnrichedPayload(undefined);
    }, 450);
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

  const shareLabel = editPostId
    ? "Save Post Edit"
    : replyToPostId
      ? "Reply to Post"
      : effectiveArtifactId
        ? "Fork to Feed"
        : "Share to Feed";

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
        shareLabel={shareLabel}
        onOpenInPlayground={canOpenInPlayground ? handleOpenInPlayground : undefined}
        onRestartLsp={handleRestartLsp}
        onShare={handleRequestShareSnapshot}
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
        onRetry={() => {
          setIsLoading(true);
          setReloadKey((k) => k + 1);
        }}
        onOpenInPlayground={handleOpenInPlayground}
      />
    </PageContainer>
  );
};

export default IdeWorkspacePage;
