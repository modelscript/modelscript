import {
  BookIcon,
  CheckCircleFillIcon,
  CircleIcon,
  CodeIcon,
  EyeIcon,
  FileDirectoryIcon,
  FileIcon,
  GearIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  LawIcon,
  PlayIcon,
  RepoForkedIcon,
  StarIcon,
  TriangleDownIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import {
  ActionList,
  ActionMenu,
  Avatar,
  Button,
  Dialog,
  Flash,
  Heading,
  Label,
  Link as PrimerLink,
  Spinner,
  Text,
  TextInput,
  Textarea,
  UnderlineNav,
} from "@primer/react";
import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation, useParams } from "react-router-dom";
import styled from "styled-components";
import type { GitlabCommit, GitlabIssue, GitlabJob, GitlabMergeRequest, GitlabProject, GitlabTreeNode } from "../api";
import {
  createGitlabIssue,
  getGitlabCommits,
  getGitlabFileRaw,
  getGitlabIssues,
  getGitlabMergeRequests,
  getGitlabPipelineJobs,
  getGitlabPipelines,
  getGitlabProject,
  getGitlabTree,
} from "../api";
import Box from "../components/Box";

// Helper for formatting relative time
function getRelativeTime(dateString: string) {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const daysDifference = Math.round((new Date(dateString).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  return rtf.format(daysDifference, "day");
}

const StyledBox = styled(Box)`
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  overflow: hidden;
`;

const FileRow = styled(Box)`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  font-size: 14px;
  cursor: pointer;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const CommitRow = styled(Box)`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  font-size: 14px;

  &:last-child {
    border-bottom: none;
  }
`;

const MarkdownBody = styled.div`
  color: var(--color-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  word-wrap: break-word;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  h1 {
    font-size: 2em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--color-border-default);
  }
  h2 {
    font-size: 1.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--color-border-default);
  }
  p {
    margin-top: 0;
    margin-bottom: 16px;
  }
  code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    white-space: break-spaces;
    background-color: var(--color-canvas-subtle);
    border-radius: 6px;
  }
  pre {
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: var(--color-canvas-subtle);
    border-radius: 6px;
    code {
      background-color: transparent;
      padding: 0;
    }
  }
`;

function CodeTab({ projectId, repo }: { projectId: string; repo: GitlabProject }) {
  const [currentPath, setCurrentPath] = useState("");
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [tree, setTree] = useState<GitlabTreeNode[]>([]);
  const [commits, setCommits] = useState<GitlabCommit[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const commitsData = await getGitlabCommits(projectId).catch(() => []);
        setCommits(commitsData);

        if (currentFile) {
          const raw = await getGitlabFileRaw(projectId, currentFile);
          setFileContent(raw);
          setTree([]);
          setReadme(null);
        } else {
          const [treeData, readmeData] = await Promise.all([
            getGitlabTree(projectId, "main", currentPath),
            currentPath === "" ? getGitlabFileRaw(projectId, "README.md").catch(() => null) : Promise.resolve(null),
          ]);
          setTree(
            treeData.sort((a, b) => (a.type === "tree" ? -1 : b.type === "tree" ? 1 : a.name.localeCompare(b.name))),
          );
          setReadme(readmeData);
          setFileContent(null);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, currentPath, currentFile]);

  const navigateUp = () => {
    if (currentFile) {
      const parts = currentFile.split("/");
      parts.pop();
      setCurrentFile(null);
      setCurrentPath(parts.join("/"));
      return;
    }
    const parts = currentPath.split("/");
    parts.pop();
    setCurrentPath(parts.join("/"));
  };

  if (loading && !fileContent && tree.length === 0) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4} color="var(--color-danger-fg)">
        Error: {error}
      </Box>
    );
  }

  const latestCommit = commits[0];
  const pathParts = (currentFile || currentPath).split("/").filter(Boolean);

  return (
    <Box display="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", gap: "32px" }}>
      {/* Left Column */}
      <Box display="flex" flexDirection="column" gap={4}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box display="flex" gap={2} alignItems="center">
            <ActionMenu>
              <ActionMenu.Button leadingVisual={GitCommitIcon}>main</ActionMenu.Button>
              <ActionMenu.Overlay>
                <ActionList>
                  <ActionList.Item>main</ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>

            {pathParts.length > 0 && (
              <Box display="flex" alignItems="center" gap={2} ml={2}>
                <PrimerLink
                  as="button"
                  onClick={() => {
                    setCurrentPath("");
                    setCurrentFile(null);
                  }}
                  style={{ fontWeight: "bold", cursor: "pointer", background: "none", border: "none" }}
                >
                  {repo.name}
                </PrimerLink>
                {pathParts.map((part, index) => (
                  <Box key={index} display="flex" alignItems="center" gap={2}>
                    <Text color="var(--color-fg-muted)">/</Text>
                    <PrimerLink
                      as="button"
                      onClick={() => {
                        const newPath = pathParts.slice(0, index + 1).join("/");
                        if (index === pathParts.length - 1 && currentFile) return;
                        setCurrentFile(null);
                        setCurrentPath(newPath);
                      }}
                      style={{
                        fontWeight: index === pathParts.length - 1 ? "bold" : "normal",
                        cursor: "pointer",
                        background: "none",
                        border: "none",
                      }}
                    >
                      {part}
                    </PrimerLink>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
          <Box display="flex" gap={2}>
            <Button variant="primary" leadingVisual={CodeIcon}>
              Code
            </Button>
          </Box>
        </Box>

        <StyledBox>
          <Box
            bg="var(--color-canvas-subtle)"
            p={3}
            style={{ borderBottom: "1px solid var(--color-border-default)" }}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            {latestCommit ? (
              <Box display="flex" alignItems="center" gap={2}>
                <Avatar src={`https://github.com/identicons/${latestCommit.author_email}.png`} size={24} />
                <Text style={{ fontWeight: "bold" }}>{latestCommit.author_name}</Text>
                <PrimerLink href="#" muted style={{ textDecoration: "none" }}>
                  {latestCommit.title}
                </PrimerLink>
              </Box>
            ) : (
              <Text>No commits found</Text>
            )}
            {latestCommit && (
              <Box display="flex" alignItems="center" gap={3} color="var(--color-fg-muted)" fontSize={1}>
                {!currentFile && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <GitCommitIcon />
                    <span style={{ fontWeight: "bold" }}>{commits.length}</span> commits
                  </Box>
                )}
                <code style={{ fontFamily: "monospace", fontSize: "12px" }}>{latestCommit.short_id}</code>
                <span>{getRelativeTime(latestCommit.created_at)}</span>
              </Box>
            )}
          </Box>

          <Box display="flex" flexDirection="column">
            {(currentPath || currentFile) && (
              <FileRow onClick={navigateUp}>
                <Box color="var(--color-fg-muted)" display="flex" alignItems="center" width="24px"></Box>
                <Box flex={1} style={{ fontWeight: "bold" }}>
                  ..
                </Box>
              </FileRow>
            )}

            {currentFile && fileContent !== null ? (
              <Box p={3} bg="var(--color-canvas-default)" style={{ overflowX: "auto" }}>
                <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "14px", lineHeight: "1.5" }}>
                  {fileContent}
                </pre>
              </Box>
            ) : (
              tree.map((node) => (
                <FileRow
                  key={node.id}
                  onClick={() => {
                    if (node.type === "tree") {
                      setCurrentPath(node.path);
                    } else {
                      setCurrentFile(node.path);
                    }
                  }}
                >
                  <Box color="var(--color-fg-muted)" display="flex" alignItems="center" width="24px">
                    {node.type === "tree" ? (
                      <FileDirectoryIcon fill="var(--color-icon-directory)" />
                    ) : (
                      <FileIcon fill="var(--color-fg-muted)" />
                    )}
                  </Box>
                  <Box flex={1}>
                    <span style={{ color: "var(--color-fg-default)" }}>{node.name}</span>
                  </Box>
                  {latestCommit && (
                    <Box
                      flex={2}
                      color="var(--color-fg-muted)"
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {latestCommit.title}
                    </Box>
                  )}
                  <Box color="var(--color-fg-muted)" textAlign="right" width="100px">
                    {latestCommit ? getRelativeTime(latestCommit.created_at) : ""}
                  </Box>
                </FileRow>
              ))
            )}
            {tree.length === 0 && !currentFile && !loading && (
              <Box p={3} textAlign="center" color="var(--color-fg-muted)">
                This directory is empty.
              </Box>
            )}
          </Box>
        </StyledBox>

        {readme && !currentFile && (
          <StyledBox>
            <Box
              bg="var(--color-canvas-subtle)"
              p={3}
              style={{ borderBottom: "1px solid var(--color-border-default)" }}
              display="flex"
              alignItems="center"
              gap={2}
            >
              <BookIcon />
              <Text style={{ fontWeight: "bold" }}>README.md</Text>
            </Box>
            <Box p={4}>
              <MarkdownBody
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    readme
                      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
                      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
                      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
                      .replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>")
                      .replace(/\*\*(.*)\*\*/gim, "<b>$1</b>")
                      .replace(/\*(.*)\*/gim, "<i>$1</i>")
                      .replace(/!\[(.*?)\]\((.*?)\)/gim, "<img alt='$1' src='$2' />")
                      .replace(/\[(.*?)\]\((.*?)\)/gim, "<a href='$2'>$1</a>")
                      .replace(/\n\n/gim, "<br /><br />"),
                  ),
                }}
              />
            </Box>
          </StyledBox>
        )}
      </Box>

      {/* Right Column: About */}
      <Box display="flex" flexDirection="column" gap={4} style={{ paddingTop: "8px" }}>
        <Box>
          <Heading as="h2" style={{ fontSize: "16px", marginBottom: "16px" }}>
            About
          </Heading>
          <Text as="p" style={{ marginBottom: "16px", color: "var(--color-fg-default)" }}>
            {repo.description || "No description, website, or topics provided."}
          </Text>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <BookIcon fill="var(--color-fg-muted)" />
            <PrimerLink href="#" style={{ color: "var(--color-fg-muted)", fontWeight: "bold" }}>
              Readme
            </PrimerLink>
          </Box>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <LawIcon fill="var(--color-fg-muted)" />
            <PrimerLink href="#" style={{ color: "var(--color-fg-muted)", fontWeight: "bold" }}>
              MIT License
            </PrimerLink>
          </Box>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <StarIcon fill="var(--color-fg-muted)" />
            <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>9.3k</Text>{" "}
            <Text color="var(--color-fg-muted)">stars</Text>
          </Box>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <EyeIcon fill="var(--color-fg-muted)" />
            <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>198</Text>{" "}
            <Text color="var(--color-fg-muted)">watching</Text>
          </Box>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <RepoForkedIcon fill="var(--color-fg-muted)" />
            <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>736</Text>{" "}
            <Text color="var(--color-fg-muted)">forks</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function IssuesTab({ projectId }: { projectId: string }) {
  const [issues, setIssues] = useState<GitlabIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueBody, setNewIssueBody] = useState("");

  const loadIssues = async () => {
    try {
      const data = await getGitlabIssues(projectId);
      setIssues(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadIssues();
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleCreateIssue = async () => {
    await createGitlabIssue(projectId, newIssueTitle, newIssueBody);
    setIsDialogOpen(false);
    setNewIssueTitle("");
    setNewIssueBody("");
    loadIssues();
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Issues
        </Heading>
        <Button variant="primary" onClick={() => setIsDialogOpen(true)}>
          New issue
        </Button>
      </Box>

      <StyledBox>
        <Box
          bg="var(--color-canvas-subtle)"
          p={3}
          style={{ borderBottom: "1px solid var(--color-border-default)" }}
          display="flex"
          alignItems="center"
          gap={2}
        >
          <IssueOpenedIcon />
          <Text style={{ fontWeight: "bold" }}>{issues.length} Open</Text>
        </Box>

        {loading ? (
          <Box p={4} display="flex" justifyContent="center">
            <Spinner />
          </Box>
        ) : issues.length === 0 ? (
          <Box display="flex" flexDirection="column" alignItems="center" p={8} textAlign="center">
            <IssueOpenedIcon size={32} fill="var(--color-fg-muted)" />
            <Heading as="h3" style={{ fontSize: "20px", marginTop: "16px", marginBottom: "8px" }}>
              Welcome to issues!
            </Heading>
            <Text color="var(--color-fg-muted)">Issues are used to track todos, bugs, feature requests, and more.</Text>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column">
            {issues.map((issue) => (
              <CommitRow key={issue.id}>
                <Box display="flex" gap={3}>
                  <div style={{ marginTop: "4px" }}>
                    <IssueOpenedIcon fill="var(--color-success-fg)" />
                  </div>
                  <Box display="flex" flexDirection="column">
                    <PrimerLink
                      href="#"
                      style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "16px" }}
                    >
                      {issue.title}
                    </PrimerLink>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                      #{issue.iid} opened {getRelativeTime(issue.created_at)} by {issue.author.username}
                    </Text>
                  </Box>
                </Box>
              </CommitRow>
            ))}
          </Box>
        )}
      </StyledBox>

      {isDialogOpen && (
        <Dialog onClose={() => setIsDialogOpen(false)} title="Create New Issue">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <TextInput
              value={newIssueTitle}
              onChange={(e) => setNewIssueTitle(e.target.value)}
              placeholder="Title"
              block
            />
            <Textarea
              value={newIssueBody}
              onChange={(e) => setNewIssueBody(e.target.value)}
              placeholder="Leave a comment"
              block
              rows={5}
            />
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateIssue} disabled={!newIssueTitle}>
                Submit new issue
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
}

function PullRequestsTab({ projectId }: { projectId: string }) {
  const [mrs, setMrs] = useState<GitlabMergeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await getGitlabMergeRequests(projectId);
        setMrs(data);
      } catch {
        // ignore
      }
      setLoading(false);
    }
    load();
  }, [projectId]);

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Pull Requests
        </Heading>
        <Button variant="primary">New pull request</Button>
      </Box>

      <StyledBox>
        <Box
          bg="var(--color-canvas-subtle)"
          p={3}
          style={{ borderBottom: "1px solid var(--color-border-default)" }}
          display="flex"
          alignItems="center"
          gap={2}
        >
          <GitPullRequestIcon />
          <Text style={{ fontWeight: "bold" }}>{mrs.length} Open</Text>
        </Box>

        {loading ? (
          <Box p={4} display="flex" justifyContent="center">
            <Spinner />
          </Box>
        ) : mrs.length === 0 ? (
          <Box display="flex" flexDirection="column" alignItems="center" p={8} textAlign="center">
            <GitPullRequestIcon size={32} fill="var(--color-fg-muted)" />
            <Heading as="h3" style={{ fontSize: "20px", marginTop: "16px", marginBottom: "8px" }}>
              Welcome to pull requests!
            </Heading>
            <Text color="var(--color-fg-muted)">Pull requests help you collaborate on code with other people.</Text>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column">
            {mrs.map((mr) => (
              <CommitRow key={mr.id}>
                <Box display="flex" gap={3}>
                  <div style={{ marginTop: "4px" }}>
                    <GitPullRequestIcon fill="var(--color-success-fg)" />
                  </div>
                  <Box display="flex" flexDirection="column">
                    <PrimerLink
                      href="#"
                      style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "16px" }}
                    >
                      {mr.title}
                    </PrimerLink>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                      #{mr.iid} opened {getRelativeTime(mr.created_at)} by {mr.author.username}
                    </Text>
                  </Box>
                </Box>
              </CommitRow>
            ))}
          </Box>
        )}
      </StyledBox>
    </Box>
  );
}

function SettingsTab({ repo }: { repo: GitlabProject }) {
  const [saved, setSaved] = useState(false);

  return (
    <Box display="grid" style={{ gridTemplateColumns: "250px 1fr", gap: "32px" }}>
      <Box>
        <ActionList>
          <ActionList.Item selected>General</ActionList.Item>
          <ActionList.Item>Access</ActionList.Item>
          <ActionList.Item>Branches</ActionList.Item>
          <ActionList.Item>Tags</ActionList.Item>
          <ActionList.Item>Webhooks</ActionList.Item>
          <ActionList.Item>Pages</ActionList.Item>
        </ActionList>
      </Box>
      <Box display="flex" flexDirection="column" gap={5}>
        <Box>
          <Heading
            as="h2"
            style={{
              fontSize: "24px",
              borderBottom: "1px solid var(--color-border-default)",
              paddingBottom: "8px",
              marginBottom: "16px",
            }}
          >
            General
          </Heading>

          {saved && (
            <Flash variant="success" style={{ marginBottom: "16px" }}>
              Settings successfully saved.
            </Flash>
          )}

          <Box display="flex" flexDirection="column" gap={4}>
            <Box>
              <Text as="label" style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                Repository name
              </Text>
              <Box display="flex" gap={2}>
                <TextInput defaultValue={repo.name} block />
                <Button variant="primary" onClick={() => setSaved(true)}>
                  Rename
                </Button>
              </Box>
            </Box>
            <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
              <Text as="label" style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                Social preview
              </Text>
              <Box
                bg="var(--color-canvas-subtle)"
                p={4}
                borderRadius={2}
                style={{ border: "1px solid var(--color-border-default)" }}
                display="flex"
                justifyContent="center"
                alignItems="center"
              >
                <Text color="var(--color-fg-muted)">
                  Upload an image to customize your repository's social media preview.
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>

        <Box>
          <Heading
            as="h2"
            style={{
              fontSize: "24px",
              color: "var(--color-danger-fg)",
              borderBottom: "1px solid var(--color-danger-muted)",
              paddingBottom: "8px",
              marginBottom: "16px",
            }}
          >
            Danger Zone
          </Heading>
          <StyledBox style={{ borderColor: "var(--color-danger-muted)" }}>
            <Box
              p={3}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              style={{ borderBottom: "1px solid var(--color-danger-muted)" }}
            >
              <Box>
                <Text style={{ fontWeight: "bold", display: "block" }}>Change repository visibility</Text>
                <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                  This repository is currently public.
                </Text>
              </Box>
              <Button variant="danger">Change visibility</Button>
            </Box>
            <Box
              p={3}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              style={{ borderBottom: "1px solid var(--color-danger-muted)" }}
            >
              <Box>
                <Text style={{ fontWeight: "bold", display: "block" }}>Transfer ownership</Text>
                <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                  Transfer this repository to another user or to an organization.
                </Text>
              </Box>
              <Button variant="danger">Transfer</Button>
            </Box>
            <Box p={3} display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <Text style={{ fontWeight: "bold", display: "block" }}>Delete this repository</Text>
                <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                  Once you delete a repository, there is no going back. Please be certain.
                </Text>
              </Box>
              <Button variant="danger">Delete this repository</Button>
            </Box>
          </StyledBox>
        </Box>
      </Box>
    </Box>
  );
}

function ActionsTab({ projectId }: { projectId: string }) {
  const [latestJobs, setLatestJobs] = useState<GitlabJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const pipelinesData = await getGitlabPipelines(projectId).catch(() => []);
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
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4} color="var(--color-danger-fg)">
        Error: {error}
      </Box>
    );
  }

  return (
    <Box>
      <Heading as="h2" style={{ fontSize: "20px", marginBottom: "16px" }}>
        Latest CI Pipeline Jobs
      </Heading>
      <StyledBox>
        {latestJobs.map((job) => (
          <CommitRow key={job.id}>
            <Box display="flex" flexDirection="column" gap={2}>
              <Box display="flex" alignItems="center" gap={2}>
                {job.status === "success" && <CheckCircleFillIcon fill="var(--color-success-fg)" />}
                {job.status === "failed" && <XCircleFillIcon fill="var(--color-danger-fg)" />}
                {job.status === "running" && <CircleIcon fill="var(--color-accent-fg)" />}
                <Text style={{ fontWeight: "bold" }}>{job.name}</Text>
                <Label variant="secondary" style={{ marginLeft: "8px" }}>
                  {job.stage}
                </Label>
              </Box>
            </Box>
            <Box display="flex" flexDirection="column" alignItems="flex-end" color="var(--color-fg-muted)" fontSize={1}>
              <Text>{job.duration ? `Duration: ${Math.round(job.duration)}s` : "Pending"}</Text>
              {job.artifacts && job.artifacts.length > 0 && <Text>{job.artifacts.length} artifacts</Text>}
              <PrimerLink href={job.web_url} target="_blank" rel="noreferrer" style={{ marginTop: "4px" }}>
                View Log
              </PrimerLink>
            </Box>
          </CommitRow>
        ))}
        {latestJobs.length === 0 && (
          <Box p={4} textAlign="center" color="var(--color-fg-muted)">
            No CI jobs found for the latest pipeline.
          </Box>
        )}
      </StyledBox>
    </Box>
  );
}

export default function WorkspacePage() {
  const { namespace, project } = useParams<{ namespace: string; project: string }>();
  const location = useLocation();
  const projectId = `${namespace}/${project}`;

  const [repo, setRepo] = useState<GitlabProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const basePath = `/workspace/${namespace}/${project}`;

  const currentTab =
    location.pathname === basePath || location.pathname === `${basePath}/`
      ? "code"
      : location.pathname.split("/").pop();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const repoData = await getGitlabProject(projectId);
        setRepo(repoData);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

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
    <Box bg="var(--color-canvas-default)" minHeight="100vh">
      {/* Repository Header (Full width background, default canvas) */}
      <Box
        bg="var(--color-canvas-default)"
        style={{ borderBottom: "1px solid var(--color-border-default)", paddingTop: "16px" }}
      >
        <Box maxWidth="1280px" mx="auto" px={4}>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={4}>
            <Box display="flex" alignItems="center" gap={2}>
              <BookIcon size={24} fill="var(--color-fg-muted)" />
              <Heading as="h1" style={{ fontSize: "20px", fontWeight: "normal", color: "var(--color-fg-default)" }}>
                <PrimerLink as={Link} to={basePath} style={{ color: "var(--color-accent-fg)" }}>
                  {namespace}
                </PrimerLink>
                <Text color="var(--color-fg-muted)" style={{ margin: "0 4px" }}>
                  /
                </Text>
                <PrimerLink as={Link} to={basePath} style={{ color: "var(--color-accent-fg)", fontWeight: "bold" }}>
                  {project}
                </PrimerLink>
              </Heading>
              <Label variant="secondary" style={{ marginLeft: "8px" }}>
                Public
              </Label>
            </Box>
            <Box display="flex" gap={2}>
              <Button leadingVisual={EyeIcon} trailingVisual={TriangleDownIcon} size="small" variant="primary">
                Watch
              </Button>
              <Button leadingVisual={RepoForkedIcon} size="small" variant="primary">
                Fork
              </Button>
              <Button leadingVisual={StarIcon} size="small" variant="primary">
                Star
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
            >
              Issues
            </UnderlineNav.Item>
            <UnderlineNav.Item
              as={Link}
              to={`${basePath}/pulls`}
              aria-current={currentTab === "pulls" ? "page" : undefined}
              icon={GitPullRequestIcon}
            >
              Pull Requests
            </UnderlineNav.Item>
            <UnderlineNav.Item
              as={Link}
              to={`${basePath}/actions`}
              aria-current={currentTab === "actions" ? "page" : undefined}
              icon={PlayIcon}
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

      {/* Main Content Area */}
      <Box bg="var(--color-canvas-default)" style={{ paddingTop: "16px", paddingBottom: "24px" }}>
        <Box maxWidth="1280px" mx="auto" px={4}>
          <Routes>
            <Route path="/" element={<CodeTab projectId={projectId} repo={repo} />} />
            <Route path="issues" element={<IssuesTab projectId={projectId} />} />
            <Route path="pulls" element={<PullRequestsTab projectId={projectId} />} />
            <Route path="actions" element={<ActionsTab projectId={projectId} />} />
            <Route path="settings" element={<SettingsTab repo={repo} />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}
