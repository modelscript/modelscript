// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner } from "@primer/react";
import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useParams } from "react-router-dom";
import type { GitlabProject } from "../api";
import { getGitlabProject } from "../api";
import Box from "../components/Box";
import { usePageTitle } from "../util/title";
import { ActionsTab, CodeTab, IssuesTab, PullRequestsTab, SettingsTab, WorkspaceHeader } from "./workspace";

export default function WorkspacePage() {
  const { provider, namespace, project } = useParams<{ provider: string; namespace: string; project: string }>();
  const location = useLocation();
  const projectId = `${namespace}/${project}`;

  const [repo, setRepo] = useState<GitlabProject | null>(null);
  usePageTitle(repo ? `${repo.name || project}` : project ? `${project}` : "Workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const basePath = `/repos/${provider}/${namespace}/${project}`;

  const currentTab =
    location.pathname === basePath || location.pathname === `${basePath}/`
      ? "code"
      : location.pathname.split("/").pop();

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
  }, [projectId, provider]);

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

  return (
    <Box>
      <WorkspaceHeader namespace={namespace!} project={project!} basePath={basePath} currentTab={currentTab} />

      <Box style={{ paddingTop: "16px", paddingBottom: "24px" }}>
        <Box maxWidth="1280px" mx="auto" px={4}>
          <Routes>
            <Route path="/" element={<CodeTab projectId={projectId} repo={repo} provider={provider!} />} />
            <Route path="issues" element={<IssuesTab projectId={projectId} provider={provider!} />} />
            <Route
              path="pulls"
              element={
                <PullRequestsTab projectId={projectId} provider={provider!} defaultBranch={repo.default_branch} />
              }
            />
            <Route
              path="actions"
              element={<ActionsTab projectId={projectId} provider={provider!} defaultBranch={repo.default_branch} />}
            />
            <Route path="settings" element={<SettingsTab repo={repo} />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}
