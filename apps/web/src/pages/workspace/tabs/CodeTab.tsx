// SPDX-License-Identifier: AGPL-3.0-or-later

import Editor from "@monaco-editor/react";
import {
  BookIcon,
  CheckIcon,
  CloudIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileDirectoryIcon,
  FileIcon,
  GitBranchIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
} from "@primer/octicons-react";
import {
  ActionList,
  ActionMenu,
  Button,
  Dialog,
  FormControl,
  Heading,
  Link as PrimerLink,
  Spinner,
  Text,
  TextInput,
} from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { GitlabBranch, GitlabCommit, GitlabProject, GitlabTag, GitlabTreeNode } from "../../../api";
import {
  getAllRepoFilePaths,
  getGitlabBranches,
  getGitlabCommits,
  getGitlabFileRaw,
  getGitlabTags,
  getGitlabTree,
  readSavedFilesMap,
  saveRepositoryFile,
} from "../../../api";
import Box from "../../../components/Box";
import CloudSimulationModal from "../../../components/CloudSimulationModal";
import { useToast } from "../../../components/ToastContext";
import { useFeatureFlag, useLanguageEnabled } from "../../../FeatureFlagContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { useTheme } from "../../../theme";
import CommitInfoBar from "../components/CommitInfoBar";
import RepoAboutSidebar from "../components/RepoAboutSidebar";
import { FileRow, MarkdownBody, StyledBox } from "../styles";
import {
  canOpenFileInPlayground,
  formatBytes,
  getDialectForFileName,
  getFileDomainBadge,
  getLanguageFromFileName,
  getRelativeTime,
} from "../utils";

export interface CodeTabProps {
  projectId: string;
  repo: GitlabProject;
  provider: string;
}

function isLikelyFilePath(pathStr: string): boolean {
  if (!pathStr) return false;
  const base = pathStr.split("/").pop() || "";
  if (/^(readme|license|cmakelists\.txt|makefile|dockerfile)$/i.test(base)) return true;
  return /\.[a-z0-9]{1,8}$/i.test(base);
}

function matchCommitForTreeNode(
  node: GitlabTreeNode,
  commits: GitlabCommit[],
  savedFiles: Record<string, string>,
): GitlabCommit | undefined {
  if (commits.length === 0) return undefined;
  const nodePathLower = node.path.toLowerCase();
  const nodeNameLower = node.name.toLowerCase();
  const stem = nodeNameLower.replace(/\.[^.]+$/, "");

  const matched = commits.find((c) => {
    if (c.file_path) {
      const fp = c.file_path.toLowerCase();
      if (fp === nodePathLower || (node.type === "tree" && fp.startsWith(`${nodePathLower}/`))) {
        return true;
      }
    }
    if (Array.isArray(c.paths)) {
      if (
        c.paths.some((p) => {
          const pl = p.toLowerCase();
          return pl === nodePathLower || (node.type === "tree" && pl.startsWith(`${nodePathLower}/`));
        })
      ) {
        return true;
      }
    }
    const text = `${c.title || ""} ${c.message || ""}`.toLowerCase();
    if (text.includes(nodePathLower) || text.includes(nodeNameLower)) {
      return true;
    }
    if (stem.length >= 4 && text.includes(stem)) {
      return true;
    }
    if ((stem === "readme" || stem === "doc" || stem === "docs") && text.includes("documentation")) {
      return true;
    }
    return false;
  });

  if (matched) return matched;

  const isEditedInSaved =
    savedFiles[node.path] !== undefined ||
    (node.type === "tree" && Object.keys(savedFiles).some((k) => k.startsWith(`${node.path}/`)));
  if (isEditedInSaved) {
    return commits[0];
  }

  return commits[0];
}

export const CodeTab: React.FC<CodeTabProps> = ({ projectId, repo, provider }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPathParam = searchParams.get("path") || "";
  const rawFileParam = searchParams.get("file") || null;
  const currentFile = rawFileParam || (isLikelyFilePath(rawPathParam) ? rawPathParam : null);
  const currentPath = currentFile
    ? currentFile.includes("/")
      ? currentFile.split("/").slice(0, -1).join("/")
      : ""
    : rawPathParam;
  const defaultBranch = repo.default_branch || "main";
  const activeRef = searchParams.get("ref") || defaultBranch;

  const { showToast } = useToast();
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasMsxLang = useLanguageEnabled("modelscript");
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const { theme } = useTheme();
  const navigate = useNavigate();

  const updateParams = (updates: { path?: string | null; file?: string | null; ref?: string | null }) => {
    const next = new URLSearchParams(searchParams);
    if (updates.path !== undefined) {
      if (updates.path) next.set("path", updates.path);
      else next.delete("path");
    }
    if (updates.file !== undefined) {
      if (updates.file) {
        next.set("file", updates.file);
        next.set("path", updates.file);
      } else {
        next.delete("file");
      }
    }
    if (updates.ref !== undefined) {
      if (updates.ref) next.set("ref", updates.ref);
      else next.delete("ref");
    }
    setSearchParams(next, { replace: true });
  };

  const setPathAndFile = (nextPath: string, nextFile: string | null) => {
    updateParams({ path: nextFile || nextPath, file: nextFile });
  };

  const [tree, setTree] = useState<GitlabTreeNode[]>([]);
  const [commits, setCommits] = useState<GitlabCommit[]>([]);
  const [branches, setBranches] = useState<GitlabBranch[]>([]);
  const [tags, setTags] = useState<GitlabTag[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCloudSim, setShowCloudSim] = useState(false);
  const [copiedClone, setCopiedClone] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // File view mode: 'code' | 'preview' | 'edit'
  const [fileViewMode, setFileViewMode] = useState<"code" | "preview" | "edit">("code");
  const [editBuffer, setEditBuffer] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [isSavingFile, setIsSavingFile] = useState(false);

  // Go to file modal state
  const [isFinderOpen, setIsFinderOpen] = useState(false);
  const [finderQuery, setFinderQuery] = useState("");
  const [allFiles, setAllFiles] = useState<GitlabTreeNode[]>([]);
  const [loadingFinder, setLoadingFinder] = useState(false);

  // Create new file modal state
  const [isCreateFileOpen, setIsCreateFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [newFileCommitMsg, setNewFileCommitMsg] = useState("Add new model file");

  const upstreamWebUrl =
    repo.web_url ||
    (provider === "github"
      ? `https://github.com/${projectId}`
      : provider === "gitlab"
        ? `https://gitlab.com/${projectId}`
        : `${typeof window !== "undefined" ? window.location.origin : "https://modelscript.org"}/git/${repo.path_with_namespace || repo.name}`);
  const cloneUrl =
    provider === "github"
      ? `https://github.com/${projectId}.git`
      : provider === "gitlab"
        ? `https://gitlab.com/${projectId}.git`
        : `${typeof window !== "undefined" ? window.location.origin : "https://modelscript.org"}/git/${repo.path_with_namespace || repo.name}.git`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getGitlabBranches(projectId, provider).catch(() => []),
      getGitlabTags(projectId, provider).catch(() => []),
    ]).then(([br, tg]) => {
      if (!cancelled) {
        setBranches(br);
        setTags(tg);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, provider]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const commitsData = await getGitlabCommits(projectId, activeRef, provider).catch(() => []);
        setCommits(commitsData);

        if (currentFile) {
          const raw = await getGitlabFileRaw(projectId, currentFile, activeRef, provider);
          const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
          setFileContent(text);
          setEditBuffer(text);
          setCommitMessage(`Update ${currentFile.split("/").pop()}`);
          const isPreviewable = /\.(md|markdown|svg)$/i.test(currentFile);
          setFileViewMode(isPreviewable ? "preview" : "code");
          setTree([]);
          setReadme(null);
        } else {
          const treeData = await getGitlabTree(projectId, activeRef, currentPath, provider);
          const sortedTree = [...treeData].sort((a, b) =>
            a.type === "tree" ? -1 : b.type === "tree" ? 1 : a.name.localeCompare(b.name),
          );
          setTree(sortedTree);

          if (currentPath === "") {
            const readmeNode = sortedTree.find(
              (n) => n.type === "blob" && /^readme(\.(md|markdown|rst|txt))?$/i.test(n.name),
            );
            const readmeTarget = readmeNode ? readmeNode.path : "README.md";
            const readmeData = await getGitlabFileRaw(projectId, readmeTarget, activeRef, provider).catch(() => null);
            setReadme(typeof readmeData === "string" ? readmeData : null);
          } else {
            setReadme(null);
          }
          setFileContent(null);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, currentPath, currentFile, provider, activeRef, refreshTrigger]);

  const handleOpenFinder = async () => {
    setIsFinderOpen(true);
    setFinderQuery("");
    if (allFiles.length === 0) {
      setLoadingFinder(true);
      try {
        const list = await getAllRepoFilePaths(projectId, activeRef, provider);
        setAllFiles(list);
      } finally {
        setLoadingFinder(false);
      }
    }
  };

  const filteredFinderFiles = useMemo(() => {
    const q = finderQuery.trim().toLowerCase();
    if (!q) return allFiles.slice(0, 40);
    return allFiles.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 40);
  }, [allFiles, finderQuery]);

  const navigateUp = () => {
    if (currentFile) {
      const parts = currentFile.split("/");
      parts.pop();
      setPathAndFile(parts.join("/"), null);
      return;
    }
    const parts = currentPath.split("/");
    parts.pop();
    setPathAndFile(parts.join("/"), null);
  };

  const handleCopyRaw = () => {
    if (fileContent === null) return;
    navigator.clipboard?.writeText(fileContent).catch(() => {});
    setCopiedRaw(true);
    showToast("File contents copied to clipboard", "info");
    setTimeout(() => setCopiedRaw(false), 1800);
  };

  const handleDownloadRaw = () => {
    if (fileContent === null || !currentFile) return;
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentFile.split("/").pop() || "file.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveEditedFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile) return;
    setIsSavingFile(true);
    try {
      await saveRepositoryFile(
        projectId,
        currentFile,
        editBuffer,
        commitMessage.trim() || `Update ${currentFile}`,
        activeRef,
        provider,
      );
      setFileContent(editBuffer);
      setFileViewMode("code");
      setRefreshTrigger((k) => k + 1);
      showToast(`Committed changes to ${currentFile}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save file", "error");
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newFileName.trim().replace(/^\/+/, "");
    if (!cleanName) return;
    const fullPath = currentPath ? `${currentPath}/${cleanName}` : cleanName;
    setIsSavingFile(true);
    try {
      await saveRepositoryFile(
        projectId,
        fullPath,
        newFileContent,
        newFileCommitMsg.trim() || `Create ${fullPath}`,
        activeRef,
        provider,
      );
      setIsCreateFileOpen(false);
      setNewFileName("");
      setNewFileContent("");
      setAllFiles([]);
      setRefreshTrigger((k) => k + 1);
      const parentParts = fullPath.split("/");
      parentParts.pop();
      setPathAndFile(parentParts.join("/"), fullPath);
      showToast(`Created ${fullPath}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create file", "error");
    } finally {
      setIsSavingFile(false);
    }
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
                Quick setup — initialize this repository with your first engineering model
              </Heading>
              <Box mb={4} display="flex" gap={2} flexWrap="wrap">
                <TextInput value={cloneUrl} readOnly style={{ fontFamily: "monospace", flex: 1 }} />
                <Button
                  onClick={() => {
                    navigator.clipboard?.writeText(cloneUrl);
                    setCopiedClone(true);
                    setTimeout(() => setCopiedClone(false), 2000);
                  }}
                >
                  {copiedClone ? "Copied!" : "Copy Clone URL"}
                </Button>
                <Button
                  variant="primary"
                  leadingVisual={PlusIcon}
                  onClick={() => {
                    setNewFileName("README.md");
                    setNewFileContent(`# ${repo.name}\n\nEngineering model repository hosted on ${brandName}.\n`);
                    setIsCreateFileOpen(true);
                  }}
                >
                  Create README.md
                </Button>
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
git branch -M ${defaultBranch}
git remote add origin ${cloneUrl}
git push -u origin ${defaultBranch}`}
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
                  {`git remote add origin ${cloneUrl}
git branch -M ${defaultBranch}
git push -u origin ${defaultBranch}`}
                </pre>
              </Box>
            </Box>
          </Box>
          <RepoAboutSidebar repo={repo} tags={tags} onSelectTag={(t) => updateParams({ ref: t })} />
        </Box>
      );
    }
    return (
      <Box
        p={4}
        color="var(--color-danger-fg)"
        bg="var(--color-danger-subtle)"
        borderRadius={2}
        style={{ border: "1px solid var(--color-border-muted)" }}
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
  const fileLineCount = fileContent !== null ? fileContent.split(/\r?\n/).length : 0;
  const fileByteSize = fileContent !== null ? new TextEncoder().encode(fileContent).length : 0;
  const currentFileBadge = currentFile ? getFileDomainBadge(currentFile) : null;
  const isMarkdownFile = Boolean(currentFile && /\.(md|markdown)$/i.test(currentFile));
  const isSvgFile = Boolean(currentFile && /\.svg$/i.test(currentFile));
  const isPreviewSupported = isMarkdownFile || isSvgFile;

  return (
    <Box display="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", gap: "32px" }}>
      {/* Left Column */}
      <Box display="flex" flexDirection="column" gap={4}>
        {/* Top Action Bar */}
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
            {/* Branch & Tag Selector */}
            <ActionMenu>
              <ActionMenu.Button
                leadingVisual={GitBranchIcon}
                variant="default"
                style={{ padding: "3px 12px", height: "32px" }}
              >
                {activeRef}
              </ActionMenu.Button>
              <ActionMenu.Overlay width="medium">
                <ActionList selectionVariant="single">
                  <ActionList.Group title="Branches">
                    {(branches.length > 0 ? branches : [{ name: defaultBranch, default: true }]).map((b) => (
                      <ActionList.Item
                        key={`branch-${b.name}`}
                        selected={activeRef === b.name}
                        onSelect={() => updateParams({ ref: b.name })}
                      >
                        <ActionList.LeadingVisual>
                          <GitBranchIcon size={14} />
                        </ActionList.LeadingVisual>
                        {b.name}
                        {b.name === defaultBranch && (
                          <ActionList.Description variant="inline">default</ActionList.Description>
                        )}
                      </ActionList.Item>
                    ))}
                  </ActionList.Group>
                  {tags.length > 0 && (
                    <ActionList.Group title="Tags">
                      {tags.map((t) => (
                        <ActionList.Item
                          key={`tag-${t.name}`}
                          selected={activeRef === t.name}
                          onSelect={() => updateParams({ ref: t.name })}
                        >
                          <ActionList.LeadingVisual>
                            <TagIcon size={14} />
                          </ActionList.LeadingVisual>
                          {t.name}
                        </ActionList.Item>
                      ))}
                    </ActionList.Group>
                  )}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>

            {/* Breadcrumbs */}
            {pathParts.length > 0 && (
              <Box display="flex" alignItems="center" gap={1} ml={1} flexWrap="wrap">
                <PrimerLink
                  as="button"
                  onClick={() => {
                    setPathAndFile("", null);
                  }}
                  style={{
                    fontWeight: "bold",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    color: "var(--color-accent-fg)",
                    padding: "2px 4px",
                  }}
                >
                  {repo.name}
                </PrimerLink>
                {pathParts.map((part, index) => (
                  <Box key={index} display="flex" alignItems="center" gap={1}>
                    <Text color="var(--color-fg-muted)">/</Text>
                    <PrimerLink
                      as="button"
                      onClick={() => {
                        const newPath = pathParts.slice(0, index + 1).join("/");
                        if (index === pathParts.length - 1 && currentFile) return;
                        setPathAndFile(newPath, null);
                      }}
                      style={{
                        fontWeight: index === pathParts.length - 1 ? "bold" : "normal",
                        cursor: "pointer",
                        background: "none",
                        border: "none",
                        color: "var(--color-accent-fg)",
                        padding: "2px 4px",
                      }}
                    >
                      {part}
                    </PrimerLink>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          <Box display="flex" gap={2} flexWrap="wrap">
            <Button
              variant="default"
              leadingVisual={SearchIcon}
              size="small"
              style={{ height: "32px", color: "var(--color-fg-muted)" }}
              onClick={handleOpenFinder}
              title="Find file in repository"
            >
              Go to file
            </Button>

            {!currentFile && (
              <ActionMenu>
                <ActionMenu.Button variant="default" size="small" leadingVisual={PlusIcon} style={{ height: "32px" }}>
                  Add file
                </ActionMenu.Button>
                <ActionMenu.Overlay width="medium">
                  <ActionList>
                    <ActionList.Item
                      onSelect={() => {
                        setNewFileName("");
                        setNewFileContent(
                          `model NewModel\n  "Engineering model created in ${repo.name}"\n  Real x(start = 1.0);\nequation\n  der(x) = -x;\nend NewModel;\n`,
                        );
                        setNewFileCommitMsg("Add new engineering model");
                        setIsCreateFileOpen(true);
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <PlusIcon size={14} />
                      </ActionList.LeadingVisual>
                      Create new file inline
                    </ActionList.Item>
                    <ActionList.Item
                      onSelect={() => {
                        navigate(
                          `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(activeRef)}`,
                        );
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <CodeIcon size={14} />
                      </ActionList.LeadingVisual>
                      Create new file in Web IDE
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
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
                navigate(
                  `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(activeRef)}`,
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
              <ActionMenu.Overlay width="medium">
                <ActionList>
                  <ActionList.Item
                    onSelect={() => {
                      navigate(
                        `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(activeRef)}`,
                      );
                    }}
                  >
                    Open in {brandName} IDE (Web VS Code)
                  </ActionList.Item>
                  <ActionList.Item
                    onSelect={() => {
                      navigator.clipboard?.writeText(cloneUrl);
                      setCopiedClone(true);
                      showToast("Copied HTTPS clone URL to clipboard", "info");
                      setTimeout(() => setCopiedClone(false), 2000);
                    }}
                  >
                    {copiedClone ? "✓ Copied to clipboard!" : "Copy Git Clone URL (HTTPS)"}
                  </ActionList.Item>
                  <ActionList.Item
                    onSelect={() => {
                      window.open(upstreamWebUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    View on {provider === "gitlab" ? "GitLab" : provider === "local" ? "Git Server" : "GitHub"} ↗
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </Box>
        </Box>

        <StyledBox style={{ borderColor: "var(--color-border-muted)" }}>
          <CommitInfoBar
            latestCommit={latestCommit}
            commits={commits}
            commitsCount={commits.length}
            currentFile={currentFile}
          />

          <Box display="flex" flexDirection="column">
            {(currentPath || currentFile) && (
              <FileRow onClick={navigateUp}>
                <Box color="var(--color-fg-muted)" display="flex" alignItems="center" width="24px">
                  <FileDirectoryIcon fill="var(--color-icon-directory)" />
                </Box>
                <Box flex={1} style={{ fontWeight: "bold" }}>
                  ..
                </Box>
              </FileRow>
            )}

            {currentFile && fileContent !== null ? (
              <Box style={{ borderTop: "1px solid var(--color-border-default)" }}>
                {/* File Viewer Toolbar */}
                <Box
                  p={2}
                  px={3}
                  bg="var(--color-canvas-subtle)"
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  gap={2}
                  borderBottom="1px solid var(--color-border-muted)"
                >
                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    {isPreviewSupported && fileViewMode !== "edit" && (
                      <Box
                        display="inline-flex"
                        style={{
                          border: "1px solid var(--color-border-default)",
                          borderRadius: "6px",
                          overflow: "hidden",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setFileViewMode("preview")}
                          style={{
                            border: "none",
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background:
                              fileViewMode === "preview" ? "var(--color-accent-subtle)" : "var(--color-canvas-default)",
                            color: fileViewMode === "preview" ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
                          }}
                        >
                          <EyeIcon size={12} /> Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => setFileViewMode("code")}
                          style={{
                            border: "none",
                            borderLeft: "1px solid var(--color-border-default)",
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background:
                              fileViewMode === "code" ? "var(--color-accent-subtle)" : "var(--color-canvas-default)",
                            color: fileViewMode === "code" ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
                          }}
                        >
                          <CodeIcon size={12} /> Code
                        </button>
                      </Box>
                    )}

                    <Text fontWeight="bold" fontSize="13px">
                      {currentFile.split("/").pop()}
                    </Text>

                    {currentFileBadge && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "1px 8px",
                          borderRadius: "9999px",
                          backgroundColor: `${currentFileBadge.color}18`,
                          color: currentFileBadge.color,
                        }}
                      >
                        {currentFileBadge.label}
                      </span>
                    )}

                    <Text color="var(--color-fg-muted)" fontSize="12px">
                      {fileLineCount} {fileLineCount === 1 ? "line" : "lines"} · {formatBytes(fileByteSize)}
                    </Text>
                  </Box>

                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    {canOpenFileInPlayground(currentFile) && (
                      <Button
                        size="small"
                        variant="primary"
                        leadingVisual={PlayIcon}
                        onClick={() => {
                          const dialect = getDialectForFileName(currentFile) || "modelica";
                          const title = currentFile.split("/").pop() || "Model";
                          navigate(
                            `/playground?dialect=${encodeURIComponent(dialect)}&title=${encodeURIComponent(title)}&code=${encodeURIComponent(fileContent)}`,
                          );
                        }}
                        title="Simulate or inspect this model in the interactive Playground"
                      >
                        Open in Playground
                      </Button>
                    )}

                    {hasCae && (
                      <Button
                        size="small"
                        variant="default"
                        leadingVisual={CloudIcon}
                        onClick={() => setShowCloudSim(true)}
                      >
                        Run on Cloud HPC
                      </Button>
                    )}

                    <Button
                      size="small"
                      variant="default"
                      leadingVisual={copiedRaw ? CheckIcon : CopyIcon}
                      onClick={handleCopyRaw}
                      title="Copy file contents"
                    >
                      {copiedRaw ? "Copied" : "Copy"}
                    </Button>

                    <Button
                      size="small"
                      variant="default"
                      leadingVisual={DownloadIcon}
                      onClick={handleDownloadRaw}
                      title="Download raw file"
                    >
                      Raw
                    </Button>

                    {fileViewMode !== "edit" ? (
                      <Button
                        size="small"
                        variant="default"
                        leadingVisual={PencilIcon}
                        onClick={() => {
                          setEditBuffer(fileContent);
                          setFileViewMode("edit");
                        }}
                        title="Edit file inline"
                      >
                        Edit
                      </Button>
                    ) : (
                      <Button size="small" variant="default" onClick={() => setFileViewMode("code")}>
                        Cancel Edit
                      </Button>
                    )}

                    <Button
                      size="small"
                      variant="default"
                      leadingVisual={CodeIcon}
                      onClick={() => {
                        navigate(
                          `/repos/${provider}/${repo.path_with_namespace || repo.name}/ide?ref=${encodeURIComponent(activeRef)}`,
                        );
                      }}
                    >
                      Web IDE
                    </Button>
                  </Box>
                </Box>

                {/* File Body: Preview, Edit, or Monaco Code View */}
                {fileViewMode === "preview" && isMarkdownFile ? (
                  <Box p={4}>
                    <MarkdownBody
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(marked.parse(fileContent) as string),
                      }}
                    />
                  </Box>
                ) : fileViewMode === "preview" && isSvgFile ? (
                  <Box
                    p={4}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    bg="var(--color-canvas-default)"
                  >
                    <div
                      style={{ maxWidth: "100%", overflow: "auto" }}
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(fileContent, { USE_PROFILES: { svg: true, svgFilters: true } }),
                      }}
                    />
                  </Box>
                ) : fileViewMode === "edit" ? (
                  <form onSubmit={handleSaveEditedFile}>
                    <Box style={{ height: "520px", borderBottom: "1px solid var(--color-border-default)" }}>
                      <Editor
                        height="100%"
                        language={getLanguageFromFileName(currentFile)}
                        theme={theme === "dark" ? "vs-dark" : "light"}
                        value={editBuffer}
                        onChange={(val) => setEditBuffer(val ?? "")}
                        options={{
                          readOnly: false,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          fontSize: 14,
                          wordWrap: "on",
                          padding: { top: 16, bottom: 16 },
                        }}
                      />
                    </Box>
                    <Box
                      p={3}
                      bg="var(--color-canvas-subtle)"
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      gap={2}
                      flexWrap="wrap"
                    >
                      <TextInput
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder={`Update ${currentFile}`}
                        style={{ flex: 1, minWidth: "240px" }}
                      />
                      <Box display="flex" gap={2}>
                        <Button type="button" onClick={() => setFileViewMode("code")}>
                          Cancel
                        </Button>
                        <Button type="submit" variant="primary" disabled={isSavingFile}>
                          {isSavingFile ? "Committing..." : `Commit to ${activeRef}`}
                        </Button>
                      </Box>
                    </Box>
                  </form>
                ) : (
                  <Box style={{ height: "600px" }}>
                    <Editor
                      height="100%"
                      language={getLanguageFromFileName(currentFile)}
                      theme={theme === "dark" ? "vs-dark" : "light"}
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
                )}
              </Box>
            ) : (
              tree.map((node) => {
                const domainBadge = node.type === "blob" ? getFileDomainBadge(node.name) : null;
                const savedFiles = readSavedFilesMap(projectId);
                const nodeCommit = matchCommitForTreeNode(node, commits, savedFiles) || latestCommit;
                return (
                  <FileRow
                    key={node.id || node.path}
                    onClick={() => {
                      if (node.type === "tree") {
                        setPathAndFile(node.path, null);
                      } else {
                        setPathAndFile(currentPath, node.path);
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
                    <Box flex={1} display="flex" alignItems="center" gap={2}>
                      <span style={{ color: "var(--color-fg-default)", fontWeight: node.type === "tree" ? 600 : 400 }}>
                        {node.name}
                      </span>
                      {domainBadge && (
                        <span
                          style={{
                            fontSize: "10.5px",
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: "9999px",
                            backgroundColor: `${domainBadge.color}18`,
                            color: domainBadge.color,
                          }}
                        >
                          {domainBadge.label}
                        </span>
                      )}
                    </Box>
                    {nodeCommit && (
                      <Box
                        flex={2}
                        color="var(--color-fg-muted)"
                        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "13px" }}
                      >
                        <span>{nodeCommit.title}</span>
                      </Box>
                    )}
                    <Box color="var(--color-fg-muted)" textAlign="right" width="120px" style={{ fontSize: "13px" }}>
                      {nodeCommit ? getRelativeTime(nodeCommit.created_at) : ""}
                    </Box>
                  </FileRow>
                );
              })
            )}
            {tree.length === 0 && !currentFile && !loading && (
              <Box p={4} textAlign="center" color="var(--color-fg-muted)">
                <Text>This directory is empty.</Text>
              </Box>
            )}
          </Box>
        </StyledBox>

        {readme && !currentFile && (
          <StyledBox>
            <Box
              bg="var(--color-canvas-subtle)"
              p={3}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              style={{ borderBottom: "1px solid var(--color-border-muted)" }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <BookIcon />
                <Text style={{ fontWeight: "bold" }}>README.md</Text>
              </Box>
              <Button
                size="small"
                variant="invisible"
                leadingVisual={PencilIcon}
                onClick={() => setPathAndFile("", "README.md")}
              >
                View / Edit
              </Button>
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
      <RepoAboutSidebar repo={repo} tags={tags} onSelectTag={(tagName) => updateParams({ ref: tagName })} />

      {/* In-Repository File Finder Modal */}
      {isFinderOpen && (
        <Dialog
          isOpen={isFinderOpen}
          onDismiss={() => setIsFinderOpen(false)}
          aria-labelledby="repo-file-finder-title"
          sx={{ width: "560px", maxWidth: "95vw" }}
        >
          <Dialog.Header id="repo-file-finder-title">Jump to file in {repo.name}</Dialog.Header>
          <Box p={3}>
            <TextInput
              block
              autoFocus
              leadingVisual={SearchIcon}
              placeholder="Type a file name or path (e.g. ChuaCircuit.mo, README.md)..."
              value={finderQuery}
              onChange={(e) => setFinderQuery(e.target.value)}
              sx={{ mb: 3 }}
            />
            {loadingFinder ? (
              <Box p={4} display="flex" justifyContent="center">
                <Spinner />
              </Box>
            ) : filteredFinderFiles.length === 0 ? (
              <Box p={3} textAlign="center" color="var(--color-fg-muted)">
                No matching files found in {repo.name}.
              </Box>
            ) : (
              <Box
                style={{
                  maxHeight: "340px",
                  overflowY: "auto",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "6px",
                }}
              >
                {filteredFinderFiles.map((file) => {
                  const badge = getFileDomainBadge(file.name);
                  return (
                    <FileRow
                      key={file.path}
                      onClick={() => {
                        const parts = file.path.split("/");
                        parts.pop();
                        setPathAndFile(parts.join("/"), file.path);
                        setIsFinderOpen(false);
                      }}
                      sx={{ py: "8px", px: 3 }}
                    >
                      <FileIcon size={14} fill="var(--color-fg-muted)" />
                      <Box flex={1} style={{ fontFamily: "monospace", fontSize: "13px" }}>
                        {file.path}
                      </Box>
                      {badge && (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: "9999px",
                            backgroundColor: `${badge.color}18`,
                            color: badge.color,
                          }}
                        >
                          {badge.label}
                        </span>
                      )}
                    </FileRow>
                  );
                })}
              </Box>
            )}
          </Box>
        </Dialog>
      )}

      {/* Create New File Modal */}
      {isCreateFileOpen && (
        <Dialog
          isOpen={isCreateFileOpen}
          onDismiss={() => setIsCreateFileOpen(false)}
          aria-labelledby="create-repo-file-title"
          sx={{ width: "680px", maxWidth: "95vw" }}
        >
          <Dialog.Header id="create-repo-file-title">
            Create new file in {repo.name} {currentPath ? `(${currentPath}/)` : ""}
          </Dialog.Header>
          <Box p={3}>
            <form onSubmit={handleCreateNewFile}>
              <Box mb={2}>
                <FormControl required>
                  <FormControl.Label>File Name / Path</FormControl.Label>
                  <TextInput
                    block
                    placeholder="models/ThermalActuator.mo"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    required
                  />
                </FormControl>
              </Box>

              <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                <Text fontSize="12px" color="var(--color-fg-muted)" style={{ alignSelf: "center", marginRight: "4px" }}>
                  Templates:
                </Text>
                {[
                  {
                    label: "Modelica (.mo)",
                    name: "models/Pendulum.mo",
                    code: `model Pendulum\n  parameter Real L = 1.0 "Length (m)";\n  parameter Real g = 9.81 "Gravity (m/s2)";\n  Real theta(start = 0.5);\n  Real omega(start = 0.0);\nequation\n  der(theta) = omega;\n  der(omega) = -(g / L) * sin(theta);\nend Pendulum;\n`,
                  },
                  {
                    label: "SysML v2 (.sysml)",
                    name: "architecture/SystemModel.sysml",
                    code: `package SystemModel {\n  part def Actuator {\n    attribute mass : Real;\n  }\n  part actuator : Actuator;\n}\n`,
                  },
                  ...(hasMsxLang
                    ? [
                        {
                          label: "ModelScript (.msx)",
                          name: "src/Controller.msx",
                          code: `model Controller {\n  param kp: Real = 2.5;\n  var u: Real = 0.0;\n}\n`,
                        },
                      ]
                    : []),
                  {
                    label: "README.md",
                    name: "README.md",
                    code: `# ${repo.name}\n\n## Overview\n\nMulti-domain physical modeling and simulation workspace.\n`,
                  },
                ].map((tpl) => (
                  <Button
                    key={tpl.label}
                    type="button"
                    size="small"
                    onClick={() => {
                      if (!newFileName) setNewFileName(tpl.name);
                      setNewFileContent(tpl.code);
                    }}
                  >
                    {tpl.label}
                  </Button>
                ))}
              </Box>

              <Box
                style={{
                  height: "300px",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "6px",
                  overflow: "hidden",
                  marginBottom: "12px",
                }}
              >
                <Editor
                  height="100%"
                  language={getLanguageFromFileName(newFileName || "model.mo")}
                  theme={theme === "dark" ? "vs-dark" : "light"}
                  value={newFileContent}
                  onChange={(val) => setNewFileContent(val ?? "")}
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    wordWrap: "on",
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </Box>

              <Box mb={3}>
                <FormControl>
                  <FormControl.Label>Commit Message</FormControl.Label>
                  <TextInput
                    block
                    value={newFileCommitMsg}
                    onChange={(e) => setNewFileCommitMsg(e.target.value)}
                    placeholder="Add new engineering model"
                  />
                </FormControl>
              </Box>

              <Box display="flex" justifyContent="flex-end" gap={2}>
                <Button type="button" onClick={() => setIsCreateFileOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSavingFile || !newFileName.trim()}>
                  {isSavingFile ? "Committing..." : `Commit new file to ${activeRef}`}
                </Button>
              </Box>
            </form>
          </Box>
        </Dialog>
      )}

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
