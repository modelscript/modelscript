// SPDX-License-Identifier: AGPL-3.0-or-later

import Editor from "@monaco-editor/react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileDirectoryIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitIcon,
  PlayIcon,
  SearchIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  TerminalIcon,
  XIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Heading, Label, Spinner, Text, TextInput } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import styled from "styled-components";
import {
  getSpaceBranches,
  getSpaceCommits,
  getSpaceFileRaw,
  getSpaceTree,
  initSpaceTemplate,
  type GitlabBranch,
  type GitlabCommit,
  type GitlabTreeNode,
  type SpaceDetailResponse,
  type SpaceRole,
} from "../../api";
import Box from "../../components/Box";
import { PostMarkdownContent } from "../../components/post/PostMarkdownContent";
import { useToast } from "../../components/ToastContext";
import { useTheme } from "../../theme";
import { ensureMonacoThemesDefined, getMonacoThemeName } from "../../util/monaco-theme";
import {
  buildFileTree,
  formatBytes,
  formatLanguageLabel,
  getLanguageFromFileName,
  getRelativeTime,
  type FileTreeNode,
} from "../workspace/utils";

export { buildFileTree, type FileTreeNode };

export interface SpaceCodeTabProps {
  detail: SpaceDetailResponse;
  viewerState: {
    canWrite: boolean;
    canAdmin: boolean;
    role: SpaceRole | null;
  };
}

/* ─── Styled Components ─── */

const CodeContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
`;

const ToolbarRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const ToolbarLeftGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const ToolbarRightGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const BreadcrumbNav = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  color: var(--color-fg-muted);
  flex-wrap: wrap;

  .segment-btn {
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: 4px;
    color: var(--color-accent-fg, #38bdf8);
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
      background: var(--color-canvas-subtle);
    }
  }

  .separator {
    color: var(--color-fg-muted);
    user-select: none;
  }

  .current {
    color: var(--color-fg-default);
    font-weight: 600;
  }
`;

const CommitBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-canvas-subtle, var(--ms-surface-hover));
  border: 1px solid var(--color-border-default, var(--color-border));
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--color-fg-default);
  flex-wrap: wrap;
`;

const CommitMessage = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .author {
    font-weight: 600;
    color: var(--color-fg-default);
  }

  .msg {
    color: var(--color-fg-muted);
  }
`;

const CommitMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-fg-muted);
`;

const TreeCard = styled.div`
  border: 1px solid var(--color-border-default, var(--color-border));
  border-radius: 6px;
  background: var(--color-canvas-default, var(--color-bg-primary));
  overflow: hidden;
`;

const TreeRow = styled.div<{ $isParentNav?: boolean }>`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.06));
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--color-canvas-subtle, var(--ms-surface-hover));
  }

  .name-col {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: ${(p) => (p.$isParentNav ? 600 : 500)};
    color: ${(p) => (p.$isParentNav ? "var(--color-fg-muted)" : "var(--color-fg-default)")};
  }

  .size-col {
    font-size: 12px;
    color: var(--color-fg-muted);
    font-family: var(--font-mono, monospace);
    text-align: right;
  }

  .time-col {
    font-size: 12px;
    color: var(--color-fg-muted);
    text-align: right;
    min-width: 80px;
  }
`;

const FileViewerCard = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-default, var(--color-bg-primary));
  overflow: hidden;
  height: 100%;
`;

const FileViewerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-canvas-subtle, var(--ms-surface-hover));
  border-bottom: 1px solid var(--color-border-default, var(--color-border));
  gap: 12px;
  flex-wrap: wrap;
  min-height: 44px;
  flex-shrink: 0;
`;

const WorkbenchBody = styled.div`
  display: flex;
  height: 640px;
  min-height: 520px;
  max-height: calc(100vh - 200px);
  position: relative;
  overflow: hidden;

  @media (max-width: 900px) {
    flex-direction: column;
    height: auto;
    max-height: none;
  }
`;

const ReadmeContainer = styled.div`
  border: 1px solid var(--color-border-default, var(--color-border));
  border-radius: 6px;
  background: var(--color-canvas-default, var(--color-bg-primary));
  overflow: hidden;
  margin-top: 12px;
`;

const ReadmeHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--color-canvas-subtle, var(--ms-surface-hover));
  border-bottom: 1px solid var(--color-border-default, var(--color-border));
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default);
`;

const ReadmeBody = styled.div`
  padding: 24px;
`;

const EmptyVaultCard = styled.div`
  padding: 32px 24px;
  text-align: center;
  border: 1px dashed var(--color-border-default);
  border-radius: 8px;
  background: var(--color-canvas-subtle);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
`;

export interface CodeSymbolPill {
  kind: "class" | "parameter" | "input" | "output" | "equation" | "algorithm" | "constant";
  name: string;
  line: number;
  type?: string;
  value?: string;
}

export function extractCodeSymbols(code: string, _language?: string): CodeSymbolPill[] {
  if (!code) return [];
  const lines = code.split("\n");
  const symbols: CodeSymbolPill[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    // Modelica / SysML classes and blocks
    const classMatch = trimmed.match(
      /^(?:model|block|class|record|connector|function|package|part\s+def|item\s+def)\s+([A-Za-z0-9_]+)/i,
    );
    if (classMatch) {
      symbols.push({ kind: "class", name: classMatch[1], line: i + 1 });
      continue;
    }

    // Parameters
    const paramMatch = trimmed.match(/^parameter\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)(?:\s*=\s*([^;]+))?/i);
    if (paramMatch) {
      symbols.push({
        kind: "parameter",
        name: paramMatch[2],
        type: paramMatch[1],
        value: paramMatch[3]?.trim(),
        line: i + 1,
      });
      continue;
    }

    // Inputs / Ports
    const inputMatch = trimmed.match(/^(?:input|in\s+port|port\s+def)\s+([A-Za-z0-9_]+)(?:\s+([A-Za-z0-9_]+))?/i);
    if (inputMatch) {
      symbols.push({ kind: "input", name: inputMatch[2] || inputMatch[1], type: inputMatch[1], line: i + 1 });
      continue;
    }

    // Outputs
    const outputMatch = trimmed.match(/^(?:output|out\s+port)\s+([A-Za-z0-9_]+)(?:\s+([A-Za-z0-9_]+))?/i);
    if (outputMatch) {
      symbols.push({ kind: "output", name: outputMatch[2] || outputMatch[1], type: outputMatch[1], line: i + 1 });
      continue;
    }

    // Equation / Algorithm section headers
    if (/^equation\b/i.test(trimmed)) {
      symbols.push({ kind: "equation", name: "equation", line: i + 1 });
    } else if (/^algorithm\b/i.test(trimmed)) {
      symbols.push({ kind: "algorithm", name: "algorithm", line: i + 1 });
    }
  }

  return symbols;
}

function getFileIconColor(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mo":
    case "mos":
      return "#38bdf8"; // Cyan
    case "sysml":
    case "kerml":
      return "#a855f7"; // Purple
    case "scad":
      return "#f97316"; // Orange
    case "sp":
    case "cir":
      return "#eab308"; // Amber
    case "step":
    case "stp":
      return "#10b981"; // Emerald
    case "md":
    case "markdown":
      return "#94a3b8"; // Slate
    default:
      return "var(--color-fg-muted)";
  }
}

const SplitLayout = styled.div<{ $sidebarOpen?: boolean }>`
  border: 1px solid var(--color-border-default, var(--color-border));
  border-radius: 8px;
  background: var(--color-canvas-default, var(--color-bg-primary));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  width: 100%;
`;

const FileTreeSidebar = styled.div`
  width: 270px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-default, var(--color-border));
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;

  @media (max-width: 900px) {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-default, var(--color-border));
    max-height: 260px;
  }
`;

const SidebarHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-default, var(--color-border));
  background: var(--color-canvas-subtle, var(--ms-surface-hover));
  font-size: 12px;
  font-weight: 600;
  color: var(--color-fg-default);
  flex-shrink: 0;
`;

const SidebarSearchBox = styled.div`
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-default, var(--color-border));
  flex-shrink: 0;
`;

const SidebarFileList = styled.div`
  overflow-y: auto;
  flex: 1;
  padding: 6px 0;
  scrollbar-width: thin;
`;

const TreeFolderRow = styled.div<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  padding-left: ${(p) => p.$depth * 14 + 10}px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-fg-default);
  cursor: pointer;
  user-select: none;
  transition: background 0.1s ease;

  &:hover {
    background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  }

  .chevron-icon {
    display: flex;
    align-items: center;
    color: var(--color-fg-muted);
    width: 14px;
    justify-content: center;
  }

  .folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
`;

const TreeFileRow = styled.div<{ $depth: number; $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  padding-left: ${(p) => p.$depth * 14 + 24}px;
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
  background: ${(p) => (p.$active ? "var(--color-accent-subtle, rgba(56, 189, 248, 0.12))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-accent-fg, #38bdf8)" : "var(--color-fg-default)")};
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  border-left: 3px solid ${(p) => (p.$active ? "var(--color-accent-fg, #38bdf8)" : "transparent")};
  transition: all 0.1s ease;

  &:hover {
    background: ${(p) =>
      p.$active
        ? "var(--color-accent-subtle, rgba(56, 189, 248, 0.18))"
        : "var(--color-canvas-subtle, rgba(255, 255, 255, 0.04))"};
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
`;

const TreeItemNode: React.FC<{
  node: FileTreeNode;
  depth: number;
  currentFile: string | null;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}> = ({ node, depth, currentFile, collapsedFolders, onToggleFolder, onSelectFile }) => {
  const isFolder = node.type === "tree";
  const isCollapsed = collapsedFolders.has(node.path);

  if (isFolder) {
    return (
      <div key={node.path}>
        <TreeFolderRow $depth={depth} onClick={() => onToggleFolder(node.path)} title={node.path}>
          <span className="chevron-icon">
            {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
          </span>
          <FileDirectoryIcon size={14} fill="var(--color-accent-fg, #38bdf8)" />
          <span className="folder-name">{node.name}</span>
        </TreeFolderRow>
        {!isCollapsed && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItemNode
                key={child.path}
                node={child}
                depth={depth + 1}
                currentFile={currentFile}
                collapsedFolders={collapsedFolders}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = node.path === currentFile;
  return (
    <TreeFileRow
      key={node.path}
      $depth={depth}
      $active={isActive}
      onClick={() => onSelectFile(node.path)}
      title={node.path}
    >
      <FileIcon size={14} fill={getFileIconColor(node.name)} />
      <span className="file-name">{node.name}</span>
    </TreeFileRow>
  );
};

const SymbolOutlineBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--color-canvas-subtle, var(--ms-surface-hover));
  border-top: 1px solid var(--color-border-default, var(--color-border));
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: thin;
  flex-shrink: 0;
  min-height: 36px;
`;

const SymbolPill = styled.button<{ $kind: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  color: var(--color-fg-default);
  transition: all 0.12s ease;

  &:hover {
    border-color: var(--color-accent-fg, #38bdf8);
    color: var(--color-accent-fg, #38bdf8);
  }

  .kind-tag {
    color: ${(p) =>
      p.$kind === "class"
        ? "#a855f7"
        : p.$kind === "parameter"
          ? "#06b6d4"
          : p.$kind === "input"
            ? "#22c55e"
            : p.$kind === "output"
              ? "#f59e0b"
              : "#94a3b8"};
    font-weight: 700;
  }
`;

/* ─── SpaceCodeTab Component ─── */

export const SpaceCodeTab: React.FC<SpaceCodeTabProps> = ({ detail, viewerState }) => {
  const { space } = detail;
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const theme = useTheme();

  const [branches, setBranches] = useState<GitlabBranch[]>([]);
  const [activeRef, setActiveRef] = useState<string>(() => searchParams.get("ref") || space.default_branch || "main");
  const [currentPath, setCurrentPath] = useState<string>(() => searchParams.get("path") || "");
  const [currentFile, setCurrentFile] = useState<string | null>(() => searchParams.get("file") || null);

  const [tree, setTree] = useState<GitlabTreeNode[]>([]);
  const [commits, setCommits] = useState<GitlabCommit[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [copiedClone, setCopiedClone] = useState(false);
  const [copiedFile, setCopiedFile] = useState(false);
  const [initializingTemplate, setInitializingTemplate] = useState(false);

  const editorRef = useRef<any>(null);
  const [allRepoFiles, setAllRepoFiles] = useState<GitlabTreeNode[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fileFilterQuery, setFileFilterQuery] = useState("");

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    ensureMonacoThemesDefined(monaco);
  };

  const handleJumpToSymbol = (line: number) => {
    if (!editorRef.current) return;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.focus();
  };

  // Load recursive repo files for the sidebar
  useEffect(() => {
    let unmounted = false;
    getSpaceTree(space.owner_namespace, space.slug, activeRef, "", true)
      .then((items) => {
        if (!unmounted && items.length > 0) {
          setAllRepoFiles(items.filter((item) => item.type === "blob"));
        }
      })
      .catch(() => {});
    return () => {
      unmounted = true;
    };
  }, [space.owner_namespace, space.slug, activeRef]);

  const filteredSidebarFiles = useMemo(() => {
    if (!fileFilterQuery.trim()) return allRepoFiles;
    const q = fileFilterQuery.trim().toLowerCase();
    return allRepoFiles.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
  }, [allRepoFiles, fileFilterQuery]);

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());

  const handleToggleFolder = (folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const treeData = useMemo(() => {
    return buildFileTree(allRepoFiles);
  }, [allRepoFiles]);

  // Ensure current file's ancestor folders are not collapsed
  useEffect(() => {
    if (!currentFile) return;
    const parts = currentFile.split("/").filter(Boolean);
    if (parts.length > 1) {
      let path = "";
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        setCollapsedFolders((prev) => {
          if (prev.has(path)) {
            const next = new Set(prev);
            next.delete(path);
            return next;
          }
          return prev;
        });
      }
    }
  }, [currentFile]);

  const symbols = useMemo(() => {
    return extractCodeSymbols(fileContent ?? "", getLanguageFromFileName(currentFile ?? ""));
  }, [fileContent, currentFile]);

  // Sync state with URL params
  const updateUrlParams = useCallback(
    (updates: { ref?: string; path?: string; file?: string | null }) => {
      const next = new URLSearchParams(searchParams);
      if (updates.ref !== undefined) {
        if (updates.ref) next.set("ref", updates.ref);
        else next.delete("ref");
      }
      if (updates.path !== undefined) {
        if (updates.path) next.set("path", updates.path);
        else next.delete("path");
      }
      if (updates.file !== undefined) {
        if (updates.file) next.set("file", updates.file);
        else next.delete("file");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Load branches
  useEffect(() => {
    let unmounted = false;
    getSpaceBranches(space.owner_namespace, space.slug)
      .then((b) => {
        if (unmounted || b.length === 0) return;
        setBranches(b);
        const refParam = searchParams.get("ref");
        if (!refParam) {
          const defaultB = b.find((x) => x.default)?.name || b[0]?.name;
          if (defaultB && defaultB !== activeRef) {
            setActiveRef(defaultB);
          }
        }
      })
      .catch(() => {});
    return () => {
      unmounted = true;
    };
  }, [space.owner_namespace, space.slug, searchParams]);

  const handleInitStarterModels = async () => {
    try {
      setInitializingTemplate(true);
      await initSpaceTemplate(space.owner_namespace, space.slug);
      showToast("Starter models successfully initialized in Git Vault", "info");
      const [treeItems, commitItems, branchItems] = await Promise.all([
        getSpaceTree(space.owner_namespace, space.slug, activeRef, currentPath),
        getSpaceCommits(space.owner_namespace, space.slug, activeRef),
        getSpaceBranches(space.owner_namespace, space.slug),
      ]);
      setTree(treeItems);
      setCommits(commitItems);
      if (branchItems.length > 0) setBranches(branchItems);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to initialize starter models", "error");
    } finally {
      setInitializingTemplate(false);
    }
  };

  // Load tree and commits for active ref and path
  useEffect(() => {
    let unmounted = false;
    setLoading(true);

    Promise.all([
      getSpaceTree(space.owner_namespace, space.slug, activeRef, currentPath),
      getSpaceCommits(space.owner_namespace, space.slug, activeRef),
    ])
      .then(([treeItems, commitItems]) => {
        if (unmounted) return;
        setTree(treeItems);
        setCommits(commitItems);

        // Check if there is a README in this directory
        const readmeNode = treeItems.find((t) => t.type === "blob" && /^readme(\.md|\.markdown|\.txt)?$/i.test(t.name));
        if (readmeNode && !currentFile) {
          getSpaceFileRaw(space.owner_namespace, space.slug, readmeNode.path, activeRef)
            .then((content) => {
              if (!unmounted) setReadmeContent(content);
            })
            .catch(() => {
              if (!unmounted) setReadmeContent(null);
            });
        } else {
          setReadmeContent(null);
        }
      })
      .catch((err) => {
        if (!unmounted) {
          showToast(err instanceof Error ? err.message : "Failed to load directory tree", "error");
        }
      })
      .finally(() => {
        if (!unmounted) setLoading(false);
      });

    return () => {
      unmounted = true;
    };
  }, [space.owner_namespace, space.slug, activeRef, currentPath, currentFile, showToast]);

  // Load file content when a file is opened
  useEffect(() => {
    if (!currentFile) {
      setFileContent(null);
      return;
    }
    let unmounted = false;
    setFileLoading(true);
    getSpaceFileRaw(space.owner_namespace, space.slug, currentFile, activeRef)
      .then((content) => {
        if (!unmounted) setFileContent(content);
      })
      .catch((err) => {
        if (!unmounted) {
          showToast(err instanceof Error ? err.message : "Failed to load file contents", "error");
        }
      })
      .finally(() => {
        if (!unmounted) setFileLoading(false);
      });

    return () => {
      unmounted = true;
    };
  }, [space.owner_namespace, space.slug, currentFile, activeRef, showToast]);

  const handleBranchSelect = (branchName: string) => {
    setActiveRef(branchName);
    updateUrlParams({ ref: branchName });
  };

  const handleNavigatePath = (targetPath: string) => {
    setCurrentPath(targetPath);
    setCurrentFile(null);
    updateUrlParams({ path: targetPath, file: null });
  };

  const handleOpenFile = (filePath: string) => {
    setCurrentFile(filePath);
    updateUrlParams({ file: filePath });
  };

  const handleCloseFile = () => {
    setCurrentFile(null);
    updateUrlParams({ file: null });
  };

  const handleNavigateUp = () => {
    if (currentFile) {
      handleCloseFile();
      return;
    }
    const segments = currentPath.split("/").filter(Boolean);
    segments.pop();
    const parent = segments.join("/");
    handleNavigatePath(parent);
  };

  const handleCopyClone = () => {
    const cloneCmd = `git clone @${space.owner_namespace}/${space.slug}.git`;
    navigator.clipboard?.writeText(cloneCmd);
    setCopiedClone(true);
    showToast("Copied clone command to clipboard", "info");
    setTimeout(() => setCopiedClone(false), 2000);
  };

  const handleCopyFileContent = () => {
    if (!fileContent) return;
    navigator.clipboard?.writeText(fileContent);
    setCopiedFile(true);
    showToast("File content copied to clipboard", "info");
    setTimeout(() => setCopiedFile(false), 2000);
  };

  const handleDownloadFile = () => {
    if (!fileContent || !currentFile) return;
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentFile.split("/").pop() || "file";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInStudio = (filePath?: string) => {
    const branch = activeRef || space.default_branch || "main";
    let url = `/vscode/workbench#${space.owner_namespace}/${space.slug}@${branch}`;
    if (filePath) {
      url += `&file=${encodeURIComponent(filePath)}`;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Breadcrumbs parsing
  const pathSegments = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split("/").filter(Boolean);
  }, [currentPath]);

  const lineCount = useMemo(() => (fileContent ? fileContent.split("\n").length : 1), [fileContent]);

  const latestCommit = commits[0];

  return (
    <CodeContainer>
      {/* ── Toolbar: Branch Picker, Breadcrumbs & Actions ── */}
      <ToolbarRow>
        <ToolbarLeftGroup>
          <ActionMenu>
            <ActionMenu.Button size="small" leadingVisual={GitBranchIcon}>
              {activeRef}
            </ActionMenu.Button>
            <ActionMenu.Overlay width="medium">
              <ActionList>
                <ActionList.Group title="Branches">
                  {branches.map((b) => (
                    <ActionList.Item
                      key={b.name}
                      selected={b.name === activeRef}
                      onSelect={() => handleBranchSelect(b.name)}
                    >
                      {b.name}
                      {b.default && (
                        <ActionList.TrailingVisual>
                          <Label size="small">default</Label>
                        </ActionList.TrailingVisual>
                      )}
                    </ActionList.Item>
                  ))}
                </ActionList.Group>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>

          {!currentFile && (
            <BreadcrumbNav>
              <button type="button" className="segment-btn" onClick={() => handleNavigatePath("")}>
                {space.slug}
              </button>
              {pathSegments.map((segment, idx) => {
                const subPath = pathSegments.slice(0, idx + 1).join("/");
                const isLast = idx === pathSegments.length - 1;
                return (
                  <React.Fragment key={subPath}>
                    <span className="separator">/</span>
                    {isLast ? (
                      <span className="current">{segment}</span>
                    ) : (
                      <button type="button" className="segment-btn" onClick={() => handleNavigatePath(subPath)}>
                        {segment}
                      </button>
                    )}
                  </React.Fragment>
                );
              })}
            </BreadcrumbNav>
          )}
        </ToolbarLeftGroup>

        <ToolbarRightGroup>
          {!currentFile && (
            <Button size="small" leadingVisual={CodeIcon} onClick={() => handleOpenInStudio(undefined)}>
              Open in Studio
            </Button>
          )}

          <Button size="small" leadingVisual={copiedClone ? CheckIcon : CopyIcon} onClick={handleCopyClone}>
            {copiedClone ? "Copied" : "Clone"}
          </Button>
        </ToolbarRightGroup>
      </ToolbarRow>

      {/* ── File Viewer Mode (Single Integrated Workbench) ── */}
      {currentFile && (
        <SplitLayout $sidebarOpen={sidebarOpen}>
          <FileViewerHeader>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" minWidth={0} flex={1}>
              <Button
                size="small"
                variant="invisible"
                leadingVisual={sidebarOpen ? SidebarCollapseIcon : SidebarExpandIcon}
                aria-label={sidebarOpen ? "Hide files sidebar" : "Show files sidebar"}
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? "Hide files sidebar" : "Show files sidebar"}
              />
              <FileIcon size={16} fill={getFileIconColor(currentFile)} />
              <BreadcrumbNav>
                <button
                  type="button"
                  className="segment-btn"
                  onClick={() => {
                    handleNavigatePath("");
                    handleCloseFile();
                  }}
                >
                  {space.slug}
                </button>
                {currentFile.split("/").map((segment, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  const dirPath = arr.slice(0, idx + 1).join("/");
                  return (
                    <React.Fragment key={dirPath}>
                      <span className="separator">/</span>
                      {isLast ? (
                        <span className="current">{segment}</span>
                      ) : (
                        <button
                          type="button"
                          className="segment-btn"
                          onClick={() => {
                            handleNavigatePath(dirPath);
                            handleCloseFile();
                          }}
                        >
                          {segment}
                        </button>
                      )}
                    </React.Fragment>
                  );
                })}
              </BreadcrumbNav>
              <Label size="small" variant="accent">
                {formatLanguageLabel(getLanguageFromFileName(currentFile), currentFile)}
              </Label>
              {fileContent !== null && (
                <Text
                  style={{
                    fontSize: "11.5px",
                    color: "var(--color-fg-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {formatBytes(new Blob([fileContent]).size)} • {lineCount} {lineCount === 1 ? "line" : "lines"}
                </Text>
              )}
            </Box>

            <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
              <Button size="small" leadingVisual={copiedFile ? CheckIcon : CopyIcon} onClick={handleCopyFileContent}>
                {copiedFile ? "Copied" : "Copy"}
              </Button>
              <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadFile} title="Download raw file">
                Raw
              </Button>
              <Button size="small" leadingVisual={CodeIcon} onClick={() => handleOpenInStudio(currentFile)}>
                Open in Studio
              </Button>
              <Button size="small" leadingVisual={XIcon} onClick={handleCloseFile} title="Close file">
                Close
              </Button>
            </Box>
          </FileViewerHeader>

          <WorkbenchBody>
            {sidebarOpen && (
              <FileTreeSidebar>
                <SidebarHeader>
                  <Box display="flex" alignItems="center" gap={2}>
                    <FileDirectoryIcon size={14} />
                    <span>Files ({allRepoFiles.length})</span>
                  </Box>
                </SidebarHeader>

                <SidebarSearchBox>
                  <TextInput
                    size="small"
                    block
                    leadingVisual={SearchIcon}
                    placeholder="Filter files..."
                    value={fileFilterQuery}
                    onChange={(e) => setFileFilterQuery(e.target.value)}
                  />
                </SidebarSearchBox>

                <SidebarFileList>
                  {fileFilterQuery.trim() ? (
                    filteredSidebarFiles.length === 0 ? (
                      <Box p={3} textAlign="center">
                        <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                          No files match &ldquo;{fileFilterQuery}&rdquo;
                        </Text>
                      </Box>
                    ) : (
                      filteredSidebarFiles.map((f) => {
                        const isActive = f.path === currentFile;
                        return (
                          <TreeFileRow
                            key={f.path}
                            $depth={0}
                            $active={isActive}
                            onClick={() => handleOpenFile(f.path)}
                            title={f.path}
                          >
                            <FileIcon size={14} fill={getFileIconColor(f.name)} />
                            <span className="file-name">{f.path}</span>
                          </TreeFileRow>
                        );
                      })
                    )
                  ) : (
                    treeData.map((node) => (
                      <TreeItemNode
                        key={node.path}
                        node={node}
                        depth={0}
                        currentFile={currentFile}
                        collapsedFolders={collapsedFolders}
                        onToggleFolder={handleToggleFolder}
                        onSelectFile={handleOpenFile}
                      />
                    ))
                  )}
                </SidebarFileList>
              </FileTreeSidebar>
            )}

            <FileViewerCard>
              {fileLoading ? (
                <Box p={5} display="flex" justifyContent="center" alignItems="center" flex={1} height="100%">
                  <Spinner />
                </Box>
              ) : (
                <>
                  <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                    <Editor
                      height="100%"
                      language={getLanguageFromFileName(currentFile)}
                      value={fileContent ?? ""}
                      theme={getMonacoThemeName(theme)}
                      beforeMount={(monaco) => ensureMonacoThemesDefined(monaco)}
                      onMount={(editor, monaco) => handleEditorMount(editor, monaco)}
                      options={{
                        readOnly: true,
                        domReadOnly: true,
                        minimap: { enabled: lineCount > 60 },
                        fontSize: 13,
                        fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        renderLineHighlight: "all",
                        wordWrap: "on",
                        scrollbar: {
                          vertical: lineCount > 25 ? "auto" : "hidden",
                          horizontal: "auto",
                          verticalScrollbarSize: 8,
                          horizontalScrollbarSize: 8,
                        },
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        overviewRulerBorder: false,
                      }}
                    />
                  </div>

                  {symbols.length > 0 && (
                    <SymbolOutlineBar>
                      <Text
                        style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-fg-muted)", marginRight: 4 }}
                      >
                        OUTLINE:
                      </Text>
                      {symbols.map((s, idx) => (
                        <SymbolPill
                          key={`${s.kind}-${s.name}-${idx}`}
                          $kind={s.kind}
                          onClick={() => handleJumpToSymbol(s.line)}
                          title={`Jump to line ${s.line}`}
                        >
                          <span className="kind-tag">{s.kind}</span>
                          <span>{s.name}</span>
                          {s.value && <span style={{ color: "var(--color-fg-muted)" }}>= {s.value}</span>}
                        </SymbolPill>
                      ))}
                    </SymbolOutlineBar>
                  )}
                </>
              )}
            </FileViewerCard>
          </WorkbenchBody>
        </SplitLayout>
      )}

      {/* ── Directory Tree View Mode ── */}
      {!currentFile && (
        <>
          {latestCommit && (
            <CommitBar>
              <CommitMessage>
                <GitCommitIcon size={14} />
                <span className="author">{latestCommit.author_name || "engineer"}</span>
                <span className="msg">{latestCommit.title}</span>
              </CommitMessage>
              <CommitMeta>
                <span>{latestCommit.short_id || latestCommit.id.slice(0, 8)}</span>
                <span>•</span>
                <span>{getRelativeTime(latestCommit.created_at)}</span>
              </CommitMeta>
            </CommitBar>
          )}

          {loading ? (
            <Box p={5} display="flex" justifyContent="center">
              <Spinner />
            </Box>
          ) : tree.length === 0 ? (
            <EmptyVaultCard>
              <TerminalIcon size={32} />
              <Heading as="h3" style={{ fontSize: "16px", margin: 0 }}>
                Git Vault is ready for your first models
              </Heading>
              <Text style={{ fontSize: "13px", color: "var(--color-fg-muted)", maxWidth: "520px" }}>
                Push your Modelica, SysML v2, STEP CAD, or polyglot engineering models to this Space's Git Vault, or
                launch the web Studio IDE to begin modeling immediately.
              </Text>
              <Box display="flex" gap={2} mt={2} flexWrap="wrap" justifyContent="center">
                {viewerState.canWrite && (
                  <Button
                    variant="primary"
                    leadingVisual={PlayIcon}
                    loading={initializingTemplate}
                    onClick={handleInitStarterModels}
                  >
                    Initialize Starter Models
                  </Button>
                )}
                <Button
                  variant={viewerState.canWrite ? "default" : "primary"}
                  leadingVisual={CodeIcon}
                  onClick={() => handleOpenInStudio()}
                >
                  Open Web Studio IDE
                </Button>
                <Button leadingVisual={CopyIcon} onClick={handleCopyClone}>
                  Copy Git Clone URL
                </Button>
              </Box>
            </EmptyVaultCard>
          ) : (
            <TreeCard>
              {currentPath && (
                <TreeRow $isParentNav onClick={handleNavigateUp}>
                  <div className="name-col">
                    <FileDirectoryIcon size={16} />
                    <span>..</span>
                  </div>
                  <div />
                  <div />
                  <div />
                </TreeRow>
              )}

              {/* Directories first, then files */}
              {[...tree]
                .sort((a, b) => {
                  if (a.type === b.type) return a.name.localeCompare(b.name);
                  return a.type === "tree" ? -1 : 1;
                })
                .map((node) => {
                  const isDir = node.type === "tree";
                  return (
                    <TreeRow
                      key={node.path}
                      onClick={() => (isDir ? handleNavigatePath(node.path) : handleOpenFile(node.path))}
                    >
                      <div className="name-col">
                        {isDir ? (
                          <FileDirectoryIcon size={16} fill="var(--color-accent-fg, #38bdf8)" />
                        ) : (
                          <FileIcon size={16} fill="var(--color-fg-muted)" />
                        )}
                        <span>{node.name}</span>
                      </div>
                      <div />
                      <div className="size-col">{node.size ? formatBytes(node.size) : ""}</div>
                      <div className="time-col">{latestCommit ? getRelativeTime(latestCommit.created_at) : ""}</div>
                    </TreeRow>
                  );
                })}
            </TreeCard>
          )}

          {/* ── Auto-rendered README.md ── */}
          {readmeContent && (
            <ReadmeContainer>
              <ReadmeHeader>
                <FileIcon size={14} />
                <span>README.md</span>
              </ReadmeHeader>
              <ReadmeBody>
                <PostMarkdownContent text={readmeContent} isLongForm={true} />
              </ReadmeBody>
            </ReadmeContainer>
          )}
        </>
      )}
    </CodeContainer>
  );
};

export default SpaceCodeTab;
