// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner } from "@primer/react";
import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import type { GitlabProject } from "../api";
import { getGitlabIssues, getGitlabMergeRequests, getGitlabPipelines, getGitlabProject } from "../api";
import Box from "../components/Box";
import { usePageTitle } from "../util/title";
import { ActionsTab, CodeTab, IssuesTab, PullRequestsTab, SettingsTab, WorkspaceHeader } from "./workspace";

type WorkspaceTab = "code" | "issues" | "pulls" | "actions" | "settings";
const VALID_TABS: readonly WorkspaceTab[] = ["code", "issues", "pulls", "actions", "settings"];

export default function WorkspacePage() {
  const { provider, namespace, project } = useParams<{ provider: string; namespace: string; project: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = `${namespace}/${project}`;

  const [repo, setRepo] = useState<GitlabProject | null>(null);
  usePageTitle(repo ? `${repo.name || project}` : project ? `${project}` : "Workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [issuesCount, setIssuesCount] = useState<number | undefined>(undefined);
  const [pullsCount, setPullsCount] = useState<number | undefined>(undefined);
  const [actionsCount, setActionsCount] = useState<number | undefined>(undefined);

  const basePath = `/repos/${provider}/${namespace}/${project}`;

  const normalizedPathname = location.pathname.replace(/\/+$/, "");
  const relativePath = normalizedPathname.startsWith(basePath)
    ? normalizedPathname.slice(basePath.length).replace(/^\/+/, "")
    : "";
  const firstSegment = relativePath.split("/")[0] || "";
  const queryTab = searchParams.get("tab");
  const resolvedTab: WorkspaceTab =
    firstSegment && VALID_TABS.includes(firstSegment as WorkspaceTab)
      ? (firstSegment as WorkspaceTab)
      : queryTab && VALID_TABS.includes(queryTab as WorkspaceTab)
        ? (queryTab as WorkspaceTab)
        : "code";

  const [currentTab, setCurrentTab] = useState<WorkspaceTab>(resolvedTab);
  const [activeRef, setActiveRef] = useState<string>(() => searchParams.get("ref") || "");
  const [selectedPath, setSelectedPath] = useState<string>(
    () => searchParams.get("path") || searchParams.get("file") || "",
  );

  const syncWorkspaceParams = useCallback(
    (updates: { tab?: WorkspaceTab | null; ref?: string | null; path?: string | null }) => {
      const next = new URLSearchParams(searchParams);
      if (updates.tab !== undefined) {
        if (updates.tab) {
          setCurrentTab(updates.tab);
          next.set("tab", updates.tab);
        } else {
          next.delete("tab");
        }
      }
      if (updates.ref !== undefined) {
        setActiveRef(updates.ref || "");
        if (updates.ref) next.set("ref", updates.ref);
        else next.delete("ref");
      }
      if (updates.path !== undefined) {
        setSelectedPath(updates.path || "");
        if (updates.path) next.set("path", updates.path);
        else next.delete("path");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    setCurrentTab(resolvedTab);
    const urlRef = searchParams.get("ref") || "";
    const urlPath = searchParams.get("path") || searchParams.get("file") || "";
    if (urlRef !== activeRef) setActiveRef(urlRef);
    if (urlPath !== selectedPath) setSelectedPath(urlPath);

    if (firstSegment && VALID_TABS.includes(firstSegment as WorkspaceTab)) {
      if (searchParams.get("tab") !== firstSegment) {
        syncWorkspaceParams({ tab: firstSegment as WorkspaceTab });
      }
    }
  }, [resolvedTab, firstSegment, searchParams, activeRef, selectedPath, syncWorkspaceParams]);

  const refreshCounts = useCallback(async () => {
    try {
      const [issues, mrs, pipelines] = await Promise.all([
        getGitlabIssues(projectId, provider).catch(() => []),
        getGitlabMergeRequests(projectId, provider).catch(() => []),
        getGitlabPipelines(projectId, provider).catch(() => []),
      ]);
      setIssuesCount(issues.filter((i) => i.state === "opened" || i.state === "open").length);
      setPullsCount(mrs.filter((m) => m.state === "opened" || m.state === "open").length);
      setActionsCount(pipelines.length);
    } catch {
      // Ignore counter errors
    }
  }, [projectId, provider]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const repoData = await getGitlabProject(projectId, provider);
        setRepo(repoData);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
    refreshCounts();
  }, [projectId, provider, refreshCounts]);

  useEffect(() => {
    const handler = () => {
      refreshCounts();
    };
    window.addEventListener("modelscript:repo-counts-changed", handler);
    return () => window.removeEventListener("modelscript:repo-counts-changed", handler);
  }, [refreshCounts]);

  if (loading) {
    return (
      <Box p={6} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (error || !repo) {
    return (
      <Box p={6} color="var(--color-danger-fg)">
        Error: {error}
      </Box>
    );
  }

  const effectiveDefaultBranch = activeRef || repo.default_branch;

  const renderTabContent = (tab: WorkspaceTab) => {
    switch (tab) {
      case "issues":
        return <IssuesTab projectId={projectId} provider={provider!} />;
      case "pulls":
        return <PullRequestsTab projectId={projectId} provider={provider!} defaultBranch={effectiveDefaultBranch} />;
      case "actions":
        return <ActionsTab projectId={projectId} provider={provider!} defaultBranch={effectiveDefaultBranch} />;
      case "settings":
        return (
          <SettingsTab
            repo={repo}
            provider={provider}
            onRepoUpdated={(patch) => setRepo((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        );
      case "code":
      default:
        return <CodeTab projectId={projectId} repo={repo} provider={provider!} />;
    }
  };

  return (
    <Box data-active-ref={effectiveDefaultBranch} data-selected-path={selectedPath}>
      <WorkspaceHeader
        namespace={namespace!}
        project={project!}
        provider={provider}
        basePath={basePath}
        currentTab={currentTab}
        repo={repo}
        issuesCount={issuesCount}
        pullsCount={pullsCount}
        actionsCount={actionsCount}
      />

      <Box style={{ paddingTop: "16px", paddingBottom: "24px" }}>
        <Box maxWidth="1280px" mx="auto" px={4}>
          <Routes>
            <Route path="/" element={renderTabContent(currentTab)} />
            <Route path="issues" element={<IssuesTab projectId={projectId} provider={provider!} />} />
            <Route
              path="pulls"
              element={
                <PullRequestsTab projectId={projectId} provider={provider!} defaultBranch={effectiveDefaultBranch} />
              }
            />
            <Route
              path="actions"
              element={<ActionsTab projectId={projectId} provider={provider!} defaultBranch={effectiveDefaultBranch} />}
            />
            <Route
              path="settings"
              element={
                <SettingsTab
                  repo={repo}
                  provider={provider}
                  onRepoUpdated={(patch) => setRepo((prev) => (prev ? { ...prev, ...patch } : prev))}
                />
              }
            />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}
