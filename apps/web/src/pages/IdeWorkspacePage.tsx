// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon, PlayIcon, PlusIcon, RepoIcon, SearchIcon, ShareAndroidIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { getArtifactView, getPopularRepos, getPost, getRepos } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { ComposeContext } from "../components/ComposeContext";
import { MorselIcon } from "../components/icons/AnsatzSketchIcon";
import { VsCodeIcon } from "../components/icons/VsCodeIcon";
import Spinner from "../components/Spinner";
import { useFeatureFlag } from "../FeatureFlagContext";
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
import { GitlabSvgIcon, inferRepoDomainTags } from "./RepositoryListPage";

import { parseStudioGitTarget } from "./workspace/utils";

const HeaderSection = styled.div`
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const ActionTilesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 16px;
  padding: 16px 20px;
`;

const ActionTile = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-canvas-subtle);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;

  &:hover {
    border-color: var(--color-accent-cyan, #38bdf8);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0891b2);
    outline-offset: 2px;
  }
`;

const GitRowContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
  width: 100%;
  min-width: 0;
`;

const ProviderSelectWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0 8px;
  height: 36px;
  flex-shrink: 0;
  color: var(--color-text-secondary);
  transition: border-color 0.15s ease;

  &:focus-within {
    border-color: var(--ms-brand, #0891b2);
    color: var(--color-text-primary);
  }
`;

const ProviderSelect = styled.select`
  background: transparent;
  color: var(--color-text-primary);
  border: none;
  font-size: 13px;
  font-weight: 600;
  outline: none;
  cursor: pointer;
  padding: 0;

  option {
    background: var(--color-canvas-overlay, #161b22);
    color: var(--color-text-primary);
  }
`;

const RepoPathInputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  height: 36px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0 10px;
  flex-wrap: nowrap;
  white-space: nowrap;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus-within {
    border-color: var(--ms-brand, #0891b2);
    box-shadow: 0 0 0 1px var(--ms-brand, #0891b2);
  }
`;

const PathSegmentInput = styled.input`
  flex: 1;
  min-width: 48px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: var(--font-mono, monospace);
  outline: none;
  padding: 0;

  &::placeholder {
    color: var(--color-text-muted);
    opacity: 0.7;
    font-family: var(--font-sans, sans-serif);
    font-size: 12px;
  }
`;

const BranchInputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0 8px;
  flex-shrink: 0;
  transition: border-color 0.15s ease;

  &:focus-within {
    border-color: var(--ms-brand, #0891b2);
  }

  input {
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 13px;
    outline: none;
    font-family: var(--font-mono, monospace);
    width: 46px;

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.7;
    }
  }
`;

const PrimaryOpenButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--ms-brand, #0891b2);
  background: var(--ms-brand, #0891b2);
  color: var(--ms-brand-contrast, #ffffff);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    background: var(--ms-brand-hover, #06b6d4);
    border-color: var(--ms-brand-hover, #06b6d4);
    box-shadow: 0 2px 10px rgba(6, 182, 212, 0.35);
  }

  &:active {
    background: var(--ms-brand-active, #0e7490);
    border-color: var(--ms-brand-active, #0e7490);
  }
`;

const RepoSearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 6px 10px;

  &:focus-within {
    border-color: var(--color-accent-cyan, #38bdf8);
  }

  input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 13px;
    outline: none;
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
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--ms-brand, #0891b2);
  background: var(--ms-brand, #0891b2);
  color: var(--ms-brand-contrast, #ffffff);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    background: var(--ms-brand-hover, #06b6d4);
    border-color: var(--ms-brand-hover, #06b6d4);
    box-shadow: 0 2px 10px rgba(6, 182, 212, 0.35);
  }

  &:active {
    background: var(--ms-brand-active, #0e7490);
    border-color: var(--ms-brand-active, #0e7490);
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
  const { openCompose } = useContext(ComposeContext);
  const hasGitRepos = useFeatureFlag("git_repositories");
  const hasLegacyRepos = useFeatureFlag("repositories");
  const hasRepos = Boolean(hasGitRepos || hasLegacyRepos);

  const sourceParam = searchParams.get("source");
  const titleParam = searchParams.get("title");
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");

  const editPostId = editPostIdParam ? Number(editPostIdParam) : undefined;
  const replyToPostId = replyToPostIdParam ? Number(replyToPostIdParam) : undefined;

  const [editPostContent, setEditPostContent] = useState<string | null>(null);

  useEffect(() => {
    if (editPostId === undefined || Number.isNaN(editPostId)) return;
    let mounted = true;
    getPost(editPostId)
      .then((res) => {
        if (mounted && res?.post?.content) {
          setEditPostContent(res.post.content);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [editPostId]);

  const [artifactMetadata, setArtifactMetadata] = useState<IdeArtifactMetadata | null>(null);
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [gitProvider, setGitProvider] = useState<"github" | "gitlab">("github");
  const [gitOwner, setGitOwner] = useState("");
  const [gitProject, setGitProject] = useState("");
  const [gitBranch, setGitBranch] = useState("");
  const [gitUrlError, setGitUrlError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepositoryDTO[]>([]);
  const [reposLoading, setReposLoading] = useState<boolean>(true);

  const artifactIdFromHash = useMemo(() => {
    if (!location.hash) return null;
    if (location.hash.startsWith("#memfs:artifact-")) {
      return location.hash.slice("#memfs:artifact-".length).split("&")[0] || null;
    }
    if (location.hash.startsWith("#memfs:")) {
      const rest = location.hash.slice("#memfs:".length).split("&")[0] || "";
      if (/^\d+$/.test(rest)) {
        return rest;
      }
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
    if (!hasRepos) {
      setRepos([]);
      setReposLoading(false);
      return;
    }
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
  }, [token, hasRepos]);

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

    const customHash = location.hash || (effectiveArtifactId ? `#memfs:${effectiveArtifactId}` : "#memfs:empty");
    let title = "Blank Workspace";

    if (effectiveArtifactId) {
      title = artifactMetadata?.title || titleParam || `Workspace #${effectiveArtifactId}`;
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

  usePageTitle(hasSpecificHandoff ? `${displayTitle} — Studio` : "Studio");

  const workbenchUrl = useMemo(() => `/vscode/workbench${folderHash}`, [folderHash]);

  useEffect(() => {
    try {
      if (token) {
        document.cookie = `modelscript_token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
      }
    } catch {
      // ignore
    }
  }, [token]);

  const broadcastSyncState = useCallback(() => {
    try {
      if (token) {
        document.cookie = `modelscript_token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
      }
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

  const resolveForkedFromId = useCallback((): number | string | undefined => {
    const raw = fromArtifactParam || artifactIdFromHash;
    if (!raw) return undefined;
    return raw;
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
        ? (editPostContent ?? undefined)
        : replyToPostId
          ? `Here is my updated **${cleanTitle}** workspace:`
          : incomingPayload?.content ||
            (forkedId
              ? `Forked and modified **${cleanTitle}** (from Artifact #${forkedId}) in Studio! 🚀`
              : `Check out my workspace in Studio: **${cleanTitle}** 🚀`);

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

  const handleOpenBlankWorkspace = () => {
    handleLaunchVsCodeUrl("/vscode/workbench#memfs:empty");
  };

  const handleOwnerChange = (val: string) => {
    if (gitUrlError) setGitUrlError(null);
    const trimmed = val.trim();
    if (trimmed.includes("/") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const target = parseStudioGitTarget(trimmed, gitBranch);
        if (target.provider === "github" || target.provider === "gitlab") {
          setGitProvider(target.provider);
        }
        setGitOwner(target.owner);
        setGitProject(target.repo);
        if (target.ref && target.ref !== "main") {
          setGitBranch(target.ref);
        }
        return;
      } catch {
        // Fall back to standard input
      }
    }
    setGitOwner(val);
  };

  const handleProjectChange = (val: string) => {
    if (gitUrlError) setGitUrlError(null);
    const trimmed = val.trim();
    if (trimmed.includes("/") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const target = parseStudioGitTarget(trimmed, gitBranch);
        if (target.provider === "github" || target.provider === "gitlab") {
          setGitProvider(target.provider);
        }
        setGitOwner(target.owner);
        setGitProject(target.repo);
        if (target.ref && target.ref !== "main") {
          setGitBranch(target.ref);
        }
        return;
      } catch {
        // Fall back to standard input
      }
    }
    setGitProject(val);
  };

  const handleOpenGitRepo = () => {
    const owner = gitOwner.trim();
    const proj = gitProject.trim();
    if (!owner && !proj) {
      setGitUrlError("Please enter a repository owner/scope and project name.");
      return;
    }
    if (!owner) {
      setGitUrlError("Please enter the repository owner or organization.");
      return;
    }
    if (!proj) {
      setGitUrlError("Please enter the project or repository name.");
      return;
    }
    try {
      const combined = `${owner}/${proj}`;
      const target = parseStudioGitTarget(combined, gitBranch, gitProvider);
      setGitUrlError(null);
      handleLaunchVsCodeUrl(target.workbenchUrl);
    } catch (err: unknown) {
      setGitUrlError(err instanceof Error ? err.message : "Invalid repository specification");
    }
  };

  const filteredRepos = useMemo(() => {
    const q = repoSearchQuery.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => {
      const domainTags = inferRepoDomainTags(r);
      return (
        r.project.toLowerCase().includes(q) ||
        r.namespace.toLowerCase().includes(q) ||
        r.provider.toLowerCase().includes(q) ||
        Boolean(r.description && r.description.toLowerCase().includes(q)) ||
        domainTags.some((t) => t.label.toLowerCase().includes(q))
      );
    });
  }, [repoSearchQuery, repos]);

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%" }}>
      <HeaderSection>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" flexDirection="column">
            <Heading as="h1" style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
              Studio
            </Heading>
            <Text style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              Engineering creation suite — interactive in-browser morsel modeling and full VS Code workspaces
            </Text>
          </Box>

          {hasRepos && (
            <Box display="flex" alignItems="center" gap={2}>
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
          )}
        </Box>
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
                Launch this workspace in a standalone Studio window for full screen real estate and multi-file LSP
                support.
              </Text>
            </Box>

            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <LaunchButton type="button" onClick={handleLaunchHandoffInVsCode}>
                <VsCodeIcon size={15} color="#ffffff" />
                <span>Launch in Studio Window</span>
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
          Start a Workspace
        </Text>
      </Box>

      <ActionTilesGrid>
        {/* Tile 1: Ansatz Morsel */}
        <ActionTile
          role="button"
          tabIndex={0}
          onClick={() => navigate("/morsel")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate("/morsel");
            }
          }}
          style={{ cursor: "pointer" }}
          aria-label="Launch Ansatz Morsel"
          data-testid="studio-morsel-tile"
        >
          <Box display="flex" flexDirection="column" gap={1.5}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(16, 185, 129, 0.15))",
                  border: "1px solid rgba(6, 182, 212, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-accent-cyan, #06b6d4)",
                }}
              >
                <MorselIcon size={20} color="currentColor" />
              </div>
              <Box display="flex" alignItems="center" gap={1.5}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    background: "rgba(6, 182, 212, 0.14)",
                    color: "var(--color-accent-cyan, #06b6d4)",
                    border: "1px solid rgba(6, 182, 212, 0.3)",
                  }}
                >
                  Instant · Wasm
                </span>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "var(--color-accent-cyan, #06b6d4)",
                  }}
                >
                  ↗
                </span>
              </Box>
            </Box>

            <Heading as="h3" style={{ fontSize: "16px", fontWeight: 700, margin: "8px 0 2px" }}>
              Ansatz Morsel
            </Heading>

            <Text style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              Launch the lightweight in-browser scratchpad with instant WebAssembly simulation, live 2D plotting, 3D
              visualization, and schematic rendering.
            </Text>
          </Box>

          <Box mt={3} display="flex" alignItems="center" justifyContent="space-between">
            <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Instant start · No setup required
            </Text>
            <Text
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-accent-cyan, #06b6d4)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span>Open Morsel</span>
              <span>↗</span>
            </Text>
          </Box>
        </ActionTile>

        {/* Tile 2: New Blank Workspace */}
        <ActionTile
          role="button"
          tabIndex={0}
          onClick={handleOpenBlankWorkspace}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpenBlankWorkspace();
            }
          }}
          style={{ cursor: "pointer" }}
          aria-label="Launch New Blank Workspace in Studio"
        >
          <Box display="flex" flexDirection="column" gap={1.5}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(59, 130, 246, 0.15))",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#38bdf8",
                }}
              >
                <PlusIcon size={20} />
              </div>
              <Box display="flex" alignItems="center" gap={1.5}>
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
                  Blank Canvas
                </span>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "var(--color-accent-cyan, #38bdf8)",
                  }}
                >
                  ↗
                </span>
              </Box>
            </Box>

            <Heading as="h3" style={{ fontSize: "16px", fontWeight: 700, margin: "8px 0 2px" }}>
              New Blank Workspace
            </Heading>

            <Text style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              Launch an empty, standalone workspace in a dedicated VS Code window with language servers, simulation
              runners, and live diagramming.
            </Text>
          </Box>

          <Box mt={3} display="flex" alignItems="center" justifyContent="space-between">
            <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Instant start · No setup required
            </Text>
            <Text
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-accent-cyan, #38bdf8)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span>Launch Workspace</span>
              <span>↗</span>
            </Text>
          </Box>
        </ActionTile>

        {/* Tile 2: Open Git Repository */}
        <ActionTile onClick={(e) => e.stopPropagation()}>
          <Box display="flex" flexDirection="column" gap={1.5}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.15))",
                  border: "1px solid rgba(139, 92, 246, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#a855f7",
                }}
              >
                <RepoIcon size={20} />
              </div>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono, monospace)",
                  padding: "2px 7px",
                  borderRadius: "6px",
                  background: "rgba(139, 92, 246, 0.14)",
                  color: "#a855f7",
                  border: "1px solid rgba(139, 92, 246, 0.3)",
                }}
              >
                GitHub · GitLab
              </span>
            </Box>

            <Heading as="h3" style={{ fontSize: "16px", fontWeight: 700, margin: "8px 0 2px" }}>
              Open Git Repository
            </Heading>

            <Text style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              Mount any repository directly in Studio by provider, owner/scope, and repository name without cloning.
            </Text>

            <Box display="flex" flexDirection="column" gap={1.5} mt={1}>
              <GitRowContainer>
                <ProviderSelectWrapper>
                  {gitProvider === "github" ? (
                    <MarkGithubIcon size={14} fill="currentColor" />
                  ) : (
                    <GitlabSvgIcon size={14} />
                  )}
                  <ProviderSelect
                    value={gitProvider}
                    onChange={(e) => setGitProvider(e.target.value as "github" | "gitlab")}
                    aria-label="Git provider"
                  >
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                  </ProviderSelect>
                </ProviderSelectWrapper>

                <RepoPathInputWrapper>
                  <RepoIcon size={14} fill="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                  <PathSegmentInput
                    type="text"
                    placeholder="owner / org"
                    value={gitOwner}
                    onChange={(e) => handleOwnerChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleOpenGitRepo();
                      }
                    }}
                    aria-label="Repository owner or scope"
                  />
                  <span
                    style={{
                      color: "var(--color-text-muted)",
                      fontSize: "14px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                  >
                    /
                  </span>
                  <PathSegmentInput
                    type="text"
                    placeholder="repository"
                    value={gitProject}
                    onChange={(e) => handleProjectChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleOpenGitRepo();
                      }
                    }}
                    aria-label="Repository or project name"
                    style={{ flex: 1.2 }}
                  />
                </RepoPathInputWrapper>

                <BranchInputWrapper title="Branch, tag, or ref (optional, defaults to main)">
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-muted)",
                      fontFamily: "var(--font-mono, monospace)",
                      userSelect: "none",
                    }}
                  >
                    @
                  </span>
                  <input
                    type="text"
                    placeholder="main"
                    value={gitBranch}
                    onChange={(e) => setGitBranch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleOpenGitRepo();
                      }
                    }}
                    aria-label="Git branch or ref"
                  />
                </BranchInputWrapper>

                <PrimaryOpenButton type="button" onClick={handleOpenGitRepo} aria-label="Open repository in Studio">
                  <span>Open</span>
                  <span>↗</span>
                </PrimaryOpenButton>
              </GitRowContainer>

              {gitUrlError && (
                <Text style={{ fontSize: "12px", color: "#f87171", margin: "2px 0 0" }}>{gitUrlError}</Text>
              )}
            </Box>
          </Box>
        </ActionTile>
      </ActionTilesGrid>

      {hasRepos && (
        <>
          <Box
            px={3}
            pt={3}
            pb={2}
            borderTop="1px solid var(--color-border)"
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap={2}
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
                Repositories &amp; Projects ({filteredRepos.length})
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

          {repos.length > 0 && (
            <Box px={3} pb={2}>
              <RepoSearchRow>
                <SearchIcon size={14} fill="var(--color-text-muted)" />
                <input
                  type="text"
                  placeholder="Filter repositories by name, owner, or domain tag (e.g. Modelica, SysML, FMI)..."
                  value={repoSearchQuery}
                  onChange={(e) => setRepoSearchQuery(e.target.value)}
                  aria-label="Filter repositories"
                />
              </RepoSearchRow>
            </Box>
          )}

          {reposLoading ? (
            <Box p={4} display="flex" justifyContent="center">
              <Spinner size="small" />
            </Box>
          ) : filteredRepos.length === 0 ? (
            <Box p={4} color="var(--color-text-muted)" style={{ fontSize: "13px" }}>
              {repoSearchQuery
                ? `No repositories match "${repoSearchQuery}". Try clearing the search filter.`
                : `No repositories found. Enter a GitHub or GitLab URL above, or visit Repositories to connect a project.`}
            </Box>
          ) : (
            <Box display="flex" flexDirection="column">
              {filteredRepos.map((repo) => {
                const fullPath = `${repo.namespace}/${repo.project}`;
                const branch = repo.default_branch || "main";
                const wsUrl = `/vscode/workbench#${fullPath}@${branch}`;
                const domainTags = inferRepoDomainTags(repo);
                return (
                  <RepoRow key={`${repo.provider}-${fullPath}`}>
                    <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          background: "var(--color-canvas-subtle)",
                          border: "1px solid var(--color-border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {repo.provider === "gitlab" ? (
                          <GitlabSvgIcon size={16} />
                        ) : (
                          <RepoIcon size={16} fill="var(--color-text-muted)" />
                        )}
                      </div>

                      <Box display="flex" flexDirection="column" gap={0.5} style={{ minWidth: 0 }}>
                        <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
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
                          <span
                            style={{
                              fontSize: "10px",
                              fontFamily: "var(--font-mono, monospace)",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            @{branch}
                          </span>
                          {domainTags.map((dt) => (
                            <span
                              key={dt.label}
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                fontFamily: "var(--font-mono, monospace)",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: `${dt.color}1f`,
                                color: dt.color,
                                border: `1px solid ${dt.color}40`,
                              }}
                            >
                              {dt.label}
                            </span>
                          ))}
                        </Box>
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
                    </Box>

                    <LaunchButton
                      type="button"
                      onClick={() => handleLaunchVsCodeUrl(wsUrl)}
                      style={{ padding: "5px 10px", fontSize: "12px", flexShrink: 0 }}
                      title={`Open ${fullPath} in a new Studio window`}
                    >
                      <VsCodeIcon size={13} color="#ffffff" />
                      <span>Open in Studio ↗</span>
                    </LaunchButton>
                  </RepoRow>
                );
              })}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default IdeWorkspacePage;
