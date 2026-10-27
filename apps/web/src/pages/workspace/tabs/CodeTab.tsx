// SPDX-License-Identifier: AGPL-3.0-or-later

import Editor from "@monaco-editor/react";
import {
  BookIcon,
  CloudIcon,
  CodeIcon,
  FileDirectoryIcon,
  FileIcon,
  GitBranchIcon,
  PlayIcon,
  SearchIcon,
  TagIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Heading, Link as PrimerLink, Spinner, Text, TextInput } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GitlabCommit, GitlabProject, GitlabTreeNode } from "../../../api";
import { getGitlabCommits, getGitlabFileRaw, getGitlabTree } from "../../../api";
import Box from "../../../components/Box";
import CloudSimulationModal from "../../../components/CloudSimulationModal";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import CommitInfoBar from "../components/CommitInfoBar";
import RepoAboutSidebar from "../components/RepoAboutSidebar";
import { FileRow, MarkdownBody, StyledBox } from "../styles";
import { getLanguageFromFileName, getRelativeTime } from "../utils";

export interface CodeTabProps {
  projectId: string;
  repo: GitlabProject;
  provider: string;
}

export const CodeTab: React.FC<CodeTabProps> = ({ projectId, repo, provider }) => {
  const [currentPath, setCurrentPath] = useState("");
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [tree, setTree] = useState<GitlabTreeNode[]>([]);
  const [commits, setCommits] = useState<GitlabCommit[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCloudSim, setShowCloudSim] = useState(false);
  const [copiedClone, setCopiedClone] = useState(false);
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const defaultBranch = repo.default_branch || "main";
        const commitsData = await getGitlabCommits(projectId, defaultBranch, provider).catch(() => []);
        setCommits(commitsData);

        if (currentFile) {
          const raw = await getGitlabFileRaw(projectId, currentFile, defaultBranch, provider);
          setFileContent(raw);
          setTree([]);
          setReadme(null);
        } else {
          const [treeData, readmeData] = await Promise.all([
            getGitlabTree(projectId, defaultBranch, currentPath, provider),
            currentPath === ""
              ? getGitlabFileRaw(projectId, "README.md", defaultBranch, provider).catch(() => null)
              : Promise.resolve(null),
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
  }, [projectId, currentPath, currentFile, provider, repo.default_branch]);

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
    if (error.includes("404")) {
      return (
        <Box display="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", gap: "32px" }}>
          <Box display="flex" flexDirection="column" gap={4}>
            <Box
              p={6}
              bg="var(--color-canvas-subtle)"
              borderRadius={2}
              style={{ border: "1px solid var(--color-border-default)" }}
            >
              <Heading as="h3" style={{ fontSize: "16px", marginBottom: "16px" }}>
                Quick setup — if you've done this kind of thing before
              </Heading>
              <Box mb={4} display="flex" gap={2}>
                <TextInput
                  value={`https://modelscript.com/${repo.path_with_namespace}.git`}
                  readOnly
                  block
                  style={{ fontFamily: "monospace" }}
                />
                <Button>Copy</Button>
              </Box>

              <Text
                as="p"
                style={{
                  fontWeight: "bold",
                  marginBottom: "8px",
                  borderBottom: "1px solid var(--color-border-default)",
                  paddingBottom: "8px",
                }}
              >
                …or create a new repository on the command line
              </Text>
              <Box
                bg="var(--color-canvas-default)"
                p={3}
                borderRadius={2}
                mb={4}
                style={{ border: "1px solid var(--color-border-default)", overflowX: "auto" }}
              >
                <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "14px", lineHeight: "1.5" }}>
                  {`echo "# ${repo.name}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://modelscript.com/${repo.path_with_namespace}.git
git push -u origin main`}
                </pre>
              </Box>

              <Text
                as="p"
                style={{
                  fontWeight: "bold",
                  marginBottom: "8px",
                  borderBottom: "1px solid var(--color-border-default)",
                  paddingBottom: "8px",
                }}
              >
                …or push an existing repository from the command line
              </Text>
              <Box
                bg="var(--color-canvas-default)"
                p={3}
                borderRadius={2}
                style={{ border: "1px solid var(--color-border-default)", overflowX: "auto" }}
              >
                <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "14px", lineHeight: "1.5" }}>
                  {`git remote add origin https://modelscript.com/${repo.path_with_namespace}.git
git branch -M main
git push -u origin main`}
                </pre>
              </Box>
            </Box>
          </Box>
          <RepoAboutSidebar repo={repo} />
        </Box>
      );
    }
    return (
      <Box
        p={4}
        color="var(--color-danger-fg)"
        bg="var(--color-danger-subtle)"
        borderRadius={2}
        style={{ border: "1px solid var(--color-danger-muted)" }}
      >
        <Heading as="h4" style={{ fontSize: "16px", margin: "0 0 8px 0" }}>
          Failed to load repository data
        </Heading>
        <Text>{error}</Text>
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
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
            <ActionMenu>
              <ActionMenu.Button
                leadingVisual={GitBranchIcon}
                variant="default"
                style={{ padding: "3px 12px", height: "32px" }}
              >
                main
              </ActionMenu.Button>
              <ActionMenu.Overlay>
                <ActionList>
                  <ActionList.Item>main</ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>

            {pathParts.length === 0 && (
              <Box display="flex" alignItems="center" gap={3} ml={3}>
                <PrimerLink
                  href="#"
                  muted
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "14px",
                    "&:hover": { color: "var(--color-accent-fg)" },
                  }}
                >
                  <GitBranchIcon /> <strong style={{ color: "var(--color-fg-default)" }}>8</strong> Branches
                </PrimerLink>
                <PrimerLink
                  href="#"
                  muted
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "14px",
                    "&:hover": { color: "var(--color-accent-fg)" },
                  }}
                >
                  <TagIcon /> <strong style={{ color: "var(--color-fg-default)" }}>18</strong> Tags
                </PrimerLink>
              </Box>
            )}

            {pathParts.length > 0 && (
              <Box display="flex" alignItems="center" gap={2} ml={2}>
                <PrimerLink
                  as="button"
                  onClick={() => {
                    setCurrentPath("");
                    setCurrentFile(null);
                  }}
                  style={{
                    fontWeight: "bold",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    color: "var(--color-accent-fg)",
                  }}
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
                        color: "var(--color-accent-fg)",
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
            {!currentFile && (
              <>
                <Button
                  variant="default"
                  leadingVisual={SearchIcon}
                  size="small"
                  style={{ height: "32px", color: "var(--color-fg-muted)" }}
                  onClick={() => {
                    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
                  }}
                  title="Search repository files (Cmd+K)"
                >
                  Go to file
                </Button>
                <ActionMenu>
                  <ActionMenu.Button variant="default" size="small" style={{ height: "32px" }}>
                    Add file
                  </ActionMenu.Button>
                  <ActionMenu.Overlay>
                    <ActionList>
                      <ActionList.Item
                        onSelect={() => {
                          const targetRef = repo.default_branch || "main";
                          navigate(
                            `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(targetRef)}`,
                          );
                        }}
                      >
                        Create new file in Web IDE
                      </ActionList.Item>
                    </ActionList>
                  </ActionMenu.Overlay>
                </ActionMenu>
              </>
            )}
            {hasCae && (
              <Button
                variant="default"
                leadingVisual={CloudIcon}
                size="small"
                style={{ height: "32px", gap: "6px" }}
                onClick={() => setShowCloudSim(true)}
              >
                Run on Cloud
              </Button>
            )}
            <Button
              variant="default"
              leadingVisual={PlayIcon}
              size="small"
              style={{ height: "32px", gap: "6px" }}
              onClick={() => {
                const targetRef = repo.default_branch || "main";
                navigate(
                  `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(targetRef)}`,
                );
              }}
            >
              Open in IDE
            </Button>
            <ActionMenu>
              <ActionMenu.Button
                variant="primary"
                leadingVisual={CodeIcon}
                size="small"
                style={{
                  height: "32px",
                  backgroundColor: "var(--color-success-emphasis)",
                  color: "#fff",
                  borderColor: "rgba(240, 246, 252, 0.1)",
                }}
              >
                Code
              </ActionMenu.Button>
              <ActionMenu.Overlay>
                <ActionList>
                  <ActionList.Item
                    onSelect={() => {
                      const targetRef = repo.default_branch || "main";
                      navigate(
                        `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(targetRef)}`,
                      );
                    }}
                  >
                    Open in ModelScript IDE (Web VS Code)
                  </ActionList.Item>
                  <ActionList.Item
                    onSelect={() => {
                      navigator.clipboard?.writeText(
                        `https://modelscript.com/${repo.path_with_namespace || repo.name}.git`,
                      );
                      setCopiedClone(true);
                      setTimeout(() => setCopiedClone(false), 2000);
                    }}
                  >
                    {copiedClone ? "✓ Copied to clipboard!" : "Copy Git Clone URL (HTTPS)"}
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </Box>
        </Box>

        <StyledBox style={{ borderColor: "var(--color-border-muted)" }}>
          <CommitInfoBar latestCommit={latestCommit} commitsCount={commits.length} currentFile={currentFile} />

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
              <Box style={{ borderTop: "1px solid var(--color-border-default)" }}>
                <Box
                  p={2}
                  px={3}
                  bg="var(--color-canvas-subtle)"
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  borderBottom="1px solid var(--color-border-muted)"
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <CodeIcon />
                    <Text fontWeight="bold" fontSize="13px">
                      {currentFile.split("/").pop()}
                    </Text>
                  </Box>
                  <Box display="flex" alignItems="center" gap={2}>
                    {hasCae && (
                      <Button
                        size="small"
                        variant="primary"
                        leadingVisual={CloudIcon}
                        onClick={() => setShowCloudSim(true)}
                      >
                        Run on Cloud HPC
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="default"
                      leadingVisual={PlayIcon}
                      onClick={() => {
                        const targetRef = repo.default_branch || "main";
                        navigate(
                          `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(targetRef)}`,
                        );
                      }}
                    >
                      Edit in IDE
                    </Button>
                  </Box>
                </Box>
                <Box style={{ height: "600px" }}>
                  <Editor
                    height="100%"
                    language={getLanguageFromFileName(currentFile)}
                    theme="vs-dark"
                    value={fileContent}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 14,
                      wordWrap: "on",
                      padding: { top: 16, bottom: 16 },
                    }}
                  />
                </Box>
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
                  sx={{ py: "8px", px: 3 }}
                >
                  <Box display="flex" alignItems="center" width="24px" justifyContent="center">
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
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "13px" }}
                    >
                      <PrimerLink
                        href="#"
                        muted
                        sx={{ "&:hover": { color: "var(--color-accent-fg)", textDecoration: "underline" } }}
                      >
                        {latestCommit.title}
                      </PrimerLink>
                    </Box>
                  )}
                  <Box color="var(--color-fg-muted)" textAlign="right" width="120px" style={{ fontSize: "13px" }}>
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
            <Box bg="var(--color-canvas-subtle)" p={3} display="flex" alignItems="center" gap={2}>
              <BookIcon />
              <Text style={{ fontWeight: "bold" }}>README.md</Text>
            </Box>
            <Box p={4}>
              <MarkdownBody
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(marked.parse(readme) as string),
                }}
              />
            </Box>
          </StyledBox>
        )}
      </Box>

      {/* Right Column: About */}
      <RepoAboutSidebar repo={repo} />

      {hasCae && (
        <CloudSimulationModal
          isOpen={showCloudSim}
          onClose={() => setShowCloudSim(false)}
          fileName={currentFile || ""}
          fileContent={fileContent || ""}
          libraryName={repo?.name}
        />
      )}
    </Box>
  );
};

export default CodeTab;
