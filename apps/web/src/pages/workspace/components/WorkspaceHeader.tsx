// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CodeIcon,
  EyeIcon,
  GearIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  PlayIcon,
  RepoForkedIcon,
  ShareIcon,
  StarFillIcon,
  StarIcon,
} from "@primer/octicons-react";
import { Button, CounterLabel, Heading, Label, Link as PrimerLink, Text, UnderlineNav } from "@primer/react";
import React, { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRepo } from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { ComposeContext } from "../../../components/ComposeContext";
import { useToast } from "../../../components/ToastContext";
import { isRepoForked, isRepoStarred, isRepoWatching, setRepoForked, setRepoStarred, setRepoWatching } from "../utils";

export interface WorkspaceHeaderProps {
  namespace: string;
  project: string;
  provider?: string | undefined;
  basePath: string;
  currentTab: string | undefined;
  repo?:
    | {
        visibility?: string | undefined;
        description?: string | null | undefined;
        default_branch?: string | undefined;
        star_count?: number | undefined;
        forks_count?: number | undefined;
        watchers_count?: number | undefined;
        web_url?: string | undefined;
      }
    | null
    | undefined;
  issuesCount?: number | undefined;
  pullsCount?: number | undefined;
  actionsCount?: number | undefined;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  namespace,
  project,
  provider = "github",
  basePath,
  currentTab,
  repo,
  issuesCount,
  pullsCount,
  actionsCount,
}) => {
  const { showToast } = useToast();
  const { token } = useAuth();
  const navigate = useNavigate();
  const { openCompose } = useContext(ComposeContext);

  const repoKey = `${namespace}/${project}`;
  const [watching, setWatching] = useState(() => isRepoWatching(repoKey));
  const [starred, setStarred] = useState(() => isRepoStarred(repoKey));
  const [forked, setForked] = useState(() => isRepoForked(repoKey));

  useEffect(() => {
    const sync = () => {
      setWatching(isRepoWatching(repoKey));
      setStarred(isRepoStarred(repoKey));
      setForked(isRepoForked(repoKey));
    };
    sync();
    window.addEventListener("modelscript:repo-engagement-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("modelscript:repo-engagement-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [repoKey]);

  const toggleWatch = () => {
    const next = !watching;
    setWatching(next);
    setRepoWatching(repoKey, next);
    showToast(next ? `Watching ${repoKey}` : `Unwatched ${repoKey}`, "info");
  };

  const toggleStar = () => {
    const next = !starred;
    setStarred(next);
    setRepoStarred(repoKey, next);
    showToast(next ? `Starred ${repoKey}` : `Removed ${repoKey} from Starred`, "info");
  };

  const handleFork = async () => {
    const next = !forked;
    setForked(next);
    setRepoForked(repoKey, next);
    if (next && token) {
      try {
        await createRepo({
          provider: provider || "github",
          repo_full_name: repoKey,
          external_repo_id: repoKey,
          default_branch: repo?.default_branch || "main",
          description: repo?.description,
        });
      } catch {
        // Ignore if already linked (409)
      }
    }
    showToast(
      next ? `Forked & linked ${repoKey} to your workspace` : `Removed local fork mark for ${repoKey}`,
      "success",
    );
  };

  const baseStars = repo?.star_count ?? 0;
  const baseForks = repo?.forks_count ?? 0;
  const baseWatchers = repo?.watchers_count ?? 0;
  const displayStars = baseStars + (starred ? 1 : 0);
  const displayForks = baseForks + (forked ? 1 : 0);
  const displayWatchers = baseWatchers + (watching ? 1 : 0);

  const externalUrl =
    repo?.web_url ||
    (provider === "gitlab"
      ? `https://gitlab.com/${namespace}/${project}`
      : provider === "local"
        ? undefined
        : `https://github.com/${namespace}/${project}`);

  return (
    <Box style={{ borderBottom: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
      <Box maxWidth="1280px" mx="auto" px={4}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3} mb={3}>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <BookIcon size={22} fill="var(--color-fg-muted)" />
            <Heading
              as="h1"
              style={{ fontSize: "20px", fontWeight: "normal", color: "var(--color-fg-default)", margin: 0 }}
            >
              <PrimerLink
                as={Link}
                to={`/repos?q=${encodeURIComponent(namespace)}`}
                style={{ color: "var(--color-accent-fg)" }}
              >
                {namespace}
              </PrimerLink>
              <Text color="var(--color-fg-muted)" style={{ margin: "0 4px" }}>
                /
              </Text>
              <PrimerLink as={Link} to={basePath} style={{ color: "var(--color-accent-fg)", fontWeight: "bold" }}>
                {project}
              </PrimerLink>
            </Heading>
            <Label variant="secondary" style={{ marginLeft: "4px" }}>
              {repo?.visibility === "private" ? "Private" : "Public"}
            </Label>
            <Label variant="accent" style={{ textTransform: "capitalize" }}>
              {provider === "gitlab" ? "GitLab" : provider === "local" ? "ModelScript Git" : "GitHub"}
            </Label>
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`View on ${provider === "gitlab" ? "GitLab" : "GitHub"}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "12px",
                  color: "var(--color-fg-muted)",
                  textDecoration: "none",
                  marginLeft: "4px",
                }}
              >
                {provider === "github" && <MarkGithubIcon size={14} />}
                <LinkExternalIcon size={13} />
              </a>
            )}
          </Box>

          <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
            <Button
              leadingVisual={CodeIcon}
              size="small"
              onClick={() => navigate(`${basePath}/ide?ref=${encodeURIComponent(repo?.default_branch || "main")}`)}
              title="Open repository in ModelScript Web IDE"
            >
              Web IDE
            </Button>

            {openCompose && (
              <Button
                leadingVisual={ShareIcon}
                size="small"
                onClick={() =>
                  openCompose({
                    content: `Exploring **${namespace}/${project}** on ModelScript! 🚀`,
                    repoPayload: {
                      namespace,
                      project,
                      provider: provider || "github",
                      description: repo?.description || undefined,
                    },
                  })
                }
                title="Share repository to feed"
              >
                Share
              </Button>
            )}

            <Button
              leadingVisual={EyeIcon}
              size="small"
              variant={watching ? "primary" : "default"}
              onClick={toggleWatch}
              trailingVisual={() => <CounterLabel>{displayWatchers.toLocaleString()}</CounterLabel>}
            >
              {watching ? "Watching" : "Watch"}
            </Button>

            <Button
              leadingVisual={RepoForkedIcon}
              size="small"
              variant={forked ? "primary" : "default"}
              onClick={handleFork}
              trailingVisual={() => <CounterLabel>{displayForks.toLocaleString()}</CounterLabel>}
            >
              {forked ? "Forked" : "Fork"}
            </Button>

            <Button
              leadingVisual={starred ? StarFillIcon : StarIcon}
              size="small"
              variant={starred ? "primary" : "default"}
              onClick={toggleStar}
              trailingVisual={() => <CounterLabel>{displayStars.toLocaleString()}</CounterLabel>}
            >
              {starred ? "Starred" : "Star"}
            </Button>
          </Box>
        </Box>

        <UnderlineNav aria-label="Repository">
          <UnderlineNav.Item
            as={Link}
            to={basePath}
            aria-current={currentTab === "code" ? "page" : undefined}
            icon={CodeIcon}
          >
            Code
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/issues`}
            aria-current={currentTab === "issues" ? "page" : undefined}
            icon={IssueOpenedIcon}
            counter={issuesCount}
          >
            Issues
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/pulls`}
            aria-current={currentTab === "pulls" ? "page" : undefined}
            icon={GitPullRequestIcon}
            counter={pullsCount}
          >
            Pull Requests
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/actions`}
            aria-current={currentTab === "actions" ? "page" : undefined}
            icon={PlayIcon}
            counter={actionsCount}
          >
            Actions
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/settings`}
            aria-current={currentTab === "settings" ? "page" : undefined}
            icon={GearIcon}
          >
            Settings
          </UnderlineNav.Item>
        </UnderlineNav>
      </Box>
    </Box>
  );
};

export default WorkspaceHeader;
