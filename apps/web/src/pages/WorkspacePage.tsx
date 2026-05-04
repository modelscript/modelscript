import {
  CheckCircleFillIcon,
  CircleIcon,
  FileDirectoryIcon,
  FileIcon,
  GitCommitIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import styled from "styled-components";
import type { GitlabCommit, GitlabJob, GitlabProject, GitlabTreeNode } from "../api";
import { getGitlabCommits, getGitlabPipelineJobs, getGitlabPipelines, getGitlabProject, getGitlabTree } from "../api";
import Box from "../components/Box";

const Container = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  padding: 40px;
  width: 100%;
  box-sizing: border-box;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-heading);
`;

const Description = styled.p`
  color: var(--color-text-muted);
  font-size: 14px;
  margin: 0 0 16px 0;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
`;

const Panel = styled.div`
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
`;

const PanelHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
`;

const FileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: 14px;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--color-bg-tertiary);
  }
`;

const CommitRow = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;

  &:last-child {
    border-bottom: none;
  }
`;

const CommitMessage = styled.div`
  font-weight: 600;
  color: var(--color-text-heading);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CommitMeta = styled.div`
  color: var(--color-text-muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export default function WorkspacePage() {
  const { namespace, project } = useParams<{ namespace: string; project: string }>();
  const projectId = `${namespace}/${project}`;

  const [repo, setRepo] = useState<GitlabProject | null>(null);
  const [tree, setTree] = useState<GitlabTreeNode[]>([]);
  const [commits, setCommits] = useState<GitlabCommit[]>([]);
  const [latestJobs, setLatestJobs] = useState<GitlabJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [repoData, treeData, commitsData, pipelinesData] = await Promise.all([
          getGitlabProject(projectId),
          getGitlabTree(projectId),
          getGitlabCommits(projectId),
          getGitlabPipelines(projectId).catch(() => []),
        ]);
        setRepo(repoData);
        setTree(
          treeData.sort((a, b) => (a.type === "tree" ? -1 : b.type === "tree" ? 1 : a.name.localeCompare(b.name))),
        );
        setCommits(commitsData);

        if (pipelinesData.length > 0) {
          const jobs = await getGitlabPipelineJobs(projectId, pipelinesData[0].id).catch(() => []);
          setLatestJobs(jobs);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

  if (loading) {
    return <Container>Loading workspace...</Container>;
  }

  if (error || !repo) {
    return <Container>Error: {error}</Container>;
  }

  return (
    <Container>
      <Header>
        <Title>{repo.name_with_namespace}</Title>
      </Header>
      {repo.description && <Description>{repo.description}</Description>}

      <Grid>
        <Box>
          <Panel>
            <PanelHeader>Files</PanelHeader>
            {tree.map((node) => (
              <FileRow key={node.id}>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {node.type === "tree" ? <FileDirectoryIcon size={16} /> : <FileIcon size={16} />}
                </span>
                <span>{node.name}</span>
              </FileRow>
            ))}
            {tree.length === 0 && <div style={{ padding: 16 }}>No files found.</div>}
          </Panel>
        </Box>
        <Box>
          <Panel>
            <PanelHeader>Recent Commits</PanelHeader>
            {commits.map((commit) => (
              <CommitRow key={commit.id}>
                <CommitMessage>{commit.title}</CommitMessage>
                <CommitMeta>
                  <GitCommitIcon size={12} />
                  <span style={{ fontFamily: "monospace" }}>{commit.short_id}</span>
                  <span>•</span>
                  <span>{commit.author_name}</span>
                </CommitMeta>
              </CommitRow>
            ))}
            {commits.length === 0 && <div style={{ padding: 16 }}>No commits found.</div>}
          </Panel>

          <Panel style={{ marginTop: 24 }}>
            <PanelHeader>Latest CI Pipeline Jobs</PanelHeader>
            {latestJobs.map((job) => (
              <CommitRow key={job.id}>
                <CommitMessage style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {job.status === "success" && (
                    <span style={{ color: "var(--color-success-fg)" }}>
                      <CheckCircleFillIcon />
                    </span>
                  )}
                  {job.status === "failed" && (
                    <span style={{ color: "var(--color-danger-fg)" }}>
                      <XCircleFillIcon />
                    </span>
                  )}
                  {job.status === "running" && (
                    <span style={{ color: "var(--color-accent-fg)" }}>
                      <CircleIcon />
                    </span>
                  )}
                  {job.name}{" "}
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: "normal" }}>
                    ({job.stage})
                  </span>
                </CommitMessage>
                <CommitMeta>
                  {job.duration ? `Duration: ${Math.round(job.duration)}s` : "Pending"}
                  {job.artifacts && job.artifacts.length > 0 && <span>• {job.artifacts.length} artifacts</span>}
                  <a
                    href={job.web_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginLeft: "auto", color: "var(--color-accent-fg)" }}
                  >
                    View Log
                  </a>
                </CommitMeta>
              </CommitRow>
            ))}
            {latestJobs.length === 0 && <div style={{ padding: 16 }}>No CI jobs found for the latest pipeline.</div>}
          </Panel>
        </Box>
      </Grid>
    </Container>
  );
}
