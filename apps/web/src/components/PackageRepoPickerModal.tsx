// SPDX-License-Identifier: AGPL-3.0-or-later

import { GitBranchIcon, MarkGithubIcon, PackageIcon, RepoIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { createArtifactView, getLibraries, getRepos, type LibrarySummary } from "../api";
import Box from "./Box";

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

const ModalContent = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  width: 100%;
  max-width: 680px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const SearchInputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--color-search-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-search-border, rgba(255, 255, 255, 0.1));
  border-radius: 9999px;
  margin: 16px 24px 8px 24px;
`;

const StyledInput = styled.input`
  background: transparent;
  border: none;
  outline: none;
  width: 100%;
  color: var(--color-text-primary, #ffffff);
  font-size: 14px;
  &::placeholder {
    color: var(--color-text-muted, #8b949e);
  }
`;

const TabContainer = styled.div`
  display: flex;
  gap: 8px;
  padding: 4px 24px 12px 24px;
  border-bottom: 1px solid var(--color-border);
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "var(--gradient-cta)" : "rgba(255, 255, 255, 0.05)")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-primary, #c9d1d9)")};
  border: 1px solid ${(props) => (props.$active ? "transparent" : "var(--color-border-glass)")};
  border-radius: 9999px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &:hover {
    background: ${(props) => (props.$active ? "var(--gradient-cta)" : "rgba(255, 255, 255, 0.1)")};
  }
`;

const ItemList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ItemCard = styled.div`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:hover {
    background: rgba(6, 182, 212, 0.06);
    border-color: rgba(6, 182, 212, 0.35);
    transform: translateY(-1px);
  }
`;

interface PackageRepoPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (result: { artifactId: number; title: string; type: "package" | "repository" }) => void;
}

export const PackageRepoPickerModal: React.FC<PackageRepoPickerModalProps> = ({ isOpen, onClose, onSelect }) => {
  const [activeTab, setActiveTab] = useState<"packages" | "repositories">("packages");
  const [searchQuery, setSearchQuery] = useState("");
  const [packages, setPackages] = useState<LibrarySummary[]>([]);
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);

    if (activeTab === "packages") {
      getLibraries(searchQuery)
        .then((pkgs) => {
          if (mounted) setPackages(pkgs || []);
        })
        .catch(console.error)
        .finally(() => {
          if (mounted) setLoading(false);
        });
    } else {
      getRepos()
        .then((data) => {
          if (mounted) setRepos(data.repos || []);
        })
        .catch(console.error)
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }

    return () => {
      mounted = false;
    };
  }, [isOpen, activeTab, searchQuery]);

  const filteredRepos = useMemo(() => {
    if (!searchQuery) return repos;
    const q = searchQuery.toLowerCase();
    return repos.filter(
      (r) =>
        r.project?.toLowerCase().includes(q) ||
        r.namespace?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q),
    );
  }, [repos, searchQuery]);

  if (!isOpen) return null;

  const handleSelectPackage = async (pkg: LibrarySummary) => {
    setAttaching(true);
    try {
      const data = await createArtifactView({
        artifact_type: "package",
        source_type: "registry",
        title: `${pkg.name}@${pkg.version}`,
        view_config: JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          license: pkg.license,
          dialect: pkg.dialect || "modelica",
        }),
      });
      onSelect({
        artifactId: data.id,
        title: pkg.name,
        type: "package",
      });
      onClose();
    } catch (err) {
      console.error("Failed to attach package artifact:", err);
    } finally {
      setAttaching(false);
    }
  };

  const handleSelectRepo = async (repo: any) => {
    setAttaching(true);
    try {
      const fullName = `${repo.namespace}/${repo.project}`;
      const data = await createArtifactView({
        artifact_type: "repository",
        source_type: "git",
        title: fullName,
        view_config: JSON.stringify({
          namespace: repo.namespace,
          project: repo.project,
          provider: repo.provider || "github",
          description: repo.description,
          defaultBranch: repo.default_branch || "main",
        }),
      });
      onSelect({
        artifactId: data.id,
        title: fullName,
        type: "repository",
      });
      onClose();
    } catch (err) {
      console.error("Failed to attach repository artifact:", err);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Box display="flex" alignItems="center" gap={2}>
            {activeTab === "packages" ? (
              <PackageIcon size={20} style={{ color: "var(--color-accent-purple, #a855f7)" }} />
            ) : (
              <RepoIcon size={20} style={{ color: "var(--color-accent-cyan, #06b6d4)" }} />
            )}
            <Text style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-fg-default)" }}>
              Attach Engineering Resource
            </Text>
          </Box>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            <XIcon size={18} />
          </button>
        </ModalHeader>

        <SearchInputWrapper>
          <SearchIcon size={16} style={{ color: "var(--color-text-muted)" }} />
          <StyledInput
            placeholder={
              activeTab === "packages" ? "Search packages (e.g. Modelica, Buildings)..." : "Search repositories..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </SearchInputWrapper>

        <TabContainer>
          <TabButton $active={activeTab === "packages"} onClick={() => setActiveTab("packages")}>
            <PackageIcon size={14} /> Packages
          </TabButton>
          <TabButton $active={activeTab === "repositories"} onClick={() => setActiveTab("repositories")}>
            <RepoIcon size={14} /> Repositories
          </TabButton>
        </TabContainer>

        <ItemList>
          {loading ? (
            <Box display="flex" justifyContent="center" alignItems="center" p={6}>
              <Spinner size="medium" />
            </Box>
          ) : activeTab === "packages" ? (
            packages.length === 0 ? (
              <Box textAlign="center" p={6} color="var(--color-text-muted)">
                No packages found.
              </Box>
            ) : (
              packages.map((pkg) => (
                <ItemCard key={`${pkg.name}-${pkg.version}`} onClick={() => !attaching && handleSelectPackage(pkg)}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box display="flex" alignItems="center" gap={2}>
                      <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-fg-default)" }}>
                        {pkg.name}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          background: "rgba(255, 255, 255, 0.08)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        v{pkg.version}
                      </span>
                    </Box>
                    <span
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-accent-cyan)",
                        fontWeight: 600,
                      }}
                    >
                      ⚡ {(pkg.dialect || "modelica").toUpperCase()}
                    </span>
                  </Box>
                  {pkg.description && (
                    <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>{pkg.description}</Text>
                  )}
                </ItemCard>
              ))
            )
          ) : filteredRepos.length === 0 ? (
            <Box textAlign="center" p={6} color="var(--color-text-muted)">
              No repositories found.
            </Box>
          ) : (
            filteredRepos.map((repo) => (
              <ItemCard
                key={repo.id || `${repo.namespace}/${repo.project}`}
                onClick={() => !attaching && handleSelectRepo(repo)}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Box display="flex" alignItems="center" gap={2}>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-fg-default)" }}>
                      {repo.namespace}/{repo.project}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <GitBranchIcon size={11} /> {repo.default_branch || "main"}
                    </span>
                  </Box>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--color-accent-purple)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {repo.provider === "github" ? <MarkGithubIcon size={12} /> : null}
                    {repo.provider || "git"}
                  </span>
                </Box>
                {repo.description && (
                  <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>{repo.description}</Text>
                )}
              </ItemCard>
            ))
          )}
        </ItemList>
      </ModalContent>
    </ModalOverlay>
  );
};

export default PackageRepoPickerModal;
