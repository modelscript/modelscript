// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  CpuIcon,
  GearIcon,
  GlobeIcon,
  HomeIcon,
  PackageIcon,
  PersonIcon,
  PlusCircleIcon,
  RepoIcon,
  SearchIcon,
  ShieldLockIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";

interface CommandItem {
  id: string;
  category: "AI Copilot" | "Navigation" | "Actions" | "Users" | "Packages" | "Repositories";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  animation: fadeIn 0.15s ease-out;

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const PaletteCard = styled.div`
  width: 100%;
  max-width: 620px;
  background: var(--surface-overlay);
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.6),
    0 0 30px rgba(139, 92, 246, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideDown 0.15s ease-out;

  @keyframes slideDown {
    from {
      transform: translateY(-12px) scale(0.98);
    }
    to {
      transform: translateY(0) scale(1);
    }
  }
`;

const InputHeader = styled.div`
  display: flex;
  align-items: center;
  padding: 14px 16px;
  gap: 12px;
  border-bottom: 1px solid var(--color-border);

  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 16px;
    color: var(--color-text-primary);
    font-family: inherit;

    &::placeholder {
      color: var(--color-text-muted);
    }
  }

  kbd {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: var(--color-text-muted);
    font-family: var(--font-mono, monospace);
  }
`;

const ResultsList = styled.div`
  max-height: 380px;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const CategoryHeader = styled.div`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  padding: 8px 12px 4px 12px;
`;

const ResultItem = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  background: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.15)" : "transparent")};
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-primary)")};
  transition: all 0.1s ease;

  &:hover {
    background: rgba(139, 92, 246, 0.15);
    color: var(--color-text-heading);
  }

  .left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-text-muted)")};
    }

    .info {
      display: flex;
      flex-direction: column;
      overflow: hidden;

      .title {
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subtitle {
        font-size: 12px;
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }

  .enter-hint {
    font-size: 11px;
    color: var(--color-text-muted);
    display: ${(props) => (props.$active ? "flex" : "none")};
    align-items: center;
    gap: 4px;
  }
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.02);
  font-size: 12px;
  color: var(--color-text-muted);

  .keys {
    display: flex;
    align-items: center;
    gap: 12px;

    span {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      kbd {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 10px;
        font-family: var(--font-mono, monospace);
      }
    }
  }
`;

interface UserCompletion {
  username: string;
  display_name?: string;
}

interface PackageCompletion {
  name: string;
  description?: string;
  latestVersion?: string;
}

interface RepoCompletion {
  id?: string;
  project?: string;
  name?: string;
  provider: string;
  namespace: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCompose?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onOpenCompose }) => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [completions, setCompletions] = useState<{
    users: UserCompletion[];
    packages: PackageCompletion[];
    repositories: RepoCompletion[];
  }>({ users: [], packages: [], repositories: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Fetch completions when query changes
  useEffect(() => {
    if (!query.trim()) {
      setCompletions({ users: [], packages: [], repositories: [] });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/search/completions?q=${encodeURIComponent(query)}&limit=6`);
        if (res.ok) {
          const data = await res.json();
          setCompletions({
            users: data.users || [],
            packages: data.packages || [],
            repositories: data.repositories || [],
          });
          setActiveIndex(0);
        }
      } catch {
        // Fallback silently on network errors
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Build items list
  const allItems: CommandItem[] = useMemo(() => {
    const defaultNavItems: CommandItem[] = [
      {
        id: "nav-home",
        category: "Navigation",
        title: "Home Timeline",
        subtitle: "View latest activity and models",
        icon: <HomeIcon size={16} />,
        action: () => {
          navigate("/home");
          onClose();
        },
      },
      {
        id: "nav-explore",
        category: "Navigation",
        title: "Explore",
        subtitle: "Trending topics, simulation models, and researchers",
        icon: <GlobeIcon size={16} />,
        action: () => {
          navigate("/explore");
          onClose();
        },
      },
      {
        id: "nav-packages",
        category: "Navigation",
        title: "Packages Registry",
        subtitle: "Browse Modelica and polyglot libraries",
        icon: <PackageIcon size={16} />,
        action: () => {
          navigate("/packages");
          onClose();
        },
      },
      {
        id: "nav-repos",
        category: "Navigation",
        title: "Git Repositories",
        subtitle: "Manage connected engineering repositories",
        icon: <RepoIcon size={16} />,
        action: () => {
          navigate("/repos");
          onClose();
        },
      },
      {
        id: "nav-ide",
        category: "Navigation",
        title: "ModelScript IDE Workbench",
        subtitle: "Launch VS Code Web editor with WASM solvers and CAD viewers",
        icon: <CodeIcon size={16} />,
        action: () => {
          navigate("/ide");
          onClose();
        },
      },
      {
        id: "nav-hpc",
        category: "Navigation",
        title: "Cloud Jobs & HPC Queue",
        subtitle: "Run SLURM jobs, simulation templates, and compute pipelines",
        icon: <CpuIcon size={16} />,
        action: () => {
          navigate("/jobs");
          onClose();
        },
      },
      {
        id: "nav-settings",
        category: "Navigation",
        title: "Settings",
        subtitle: "Account preferences and access tokens",
        icon: <GearIcon size={16} />,
        action: () => {
          navigate("/settings");
          onClose();
        },
      },
      ...(isAdmin
        ? [
            {
              id: "nav-admin",
              category: "Navigation" as const,
              title: "Instance Admin Console",
              subtitle: "Moderation queue, federation domains, DMCA, audit logs, and database migrations",
              icon: <ShieldLockIcon size={16} />,
              action: () => {
                navigate("/admin");
                onClose();
              },
            },
            {
              id: "nav-admin-moderation",
              category: "Navigation" as const,
              title: "Admin: Moderation Queue",
              subtitle: "Review reported content and enforce takedowns",
              icon: <ShieldLockIcon size={16} />,
              action: () => {
                navigate("/admin/moderation");
                onClose();
              },
            },
            {
              id: "nav-admin-federation",
              category: "Navigation" as const,
              title: "Admin: Federation Domains",
              subtitle: "Manage ActivityPub instance tiers (allow / silence / suspend)",
              icon: <ShieldLockIcon size={16} />,
              action: () => {
                navigate("/admin/federation");
                onClose();
              },
            },
            {
              id: "nav-admin-audit",
              category: "Navigation" as const,
              title: "Admin: Security Audit Logs",
              subtitle: "Inspect immutable audit records",
              icon: <ShieldLockIcon size={16} />,
              action: () => {
                navigate("/admin/audit");
                onClose();
              },
            },
            {
              id: "nav-admin-database",
              category: "Navigation" as const,
              title: "Admin: Database Operations",
              subtitle: "Check schema integrity and execute database migrations",
              icon: <ShieldLockIcon size={16} />,
              action: () => {
                navigate("/admin/database");
                onClose();
              },
            },
          ]
        : []),
    ];

    const defaultActionItems: CommandItem[] = [
      {
        id: "action-compose",
        category: "Actions",
        title: "Create New Post",
        subtitle: "Share models, simulation results, or engineering queries",
        icon: <PlusCircleIcon size={16} />,
        action: () => {
          onClose();
          if (onOpenCompose) onOpenCompose();
        },
      },
    ];

    if (!query.trim()) {
      return [...defaultActionItems, ...defaultNavItems];
    }

    // Filtered static navigation items
    const matchingNav = defaultNavItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(query.toLowerCase())),
    );

    // Entity completions
    const userItems: CommandItem[] = (completions.users || []).map((u) => ({
      id: `user-${u.username}`,
      category: "Users",
      title: u.display_name || u.username,
      subtitle: `@${u.username}`,
      icon: <PersonIcon size={16} />,
      action: () => {
        navigate(`/${u.username}`);
        onClose();
      },
    }));

    const packageItems: CommandItem[] = (completions.packages || []).map((pkg) => ({
      id: `pkg-${pkg.name}`,
      category: "Packages",
      title: pkg.name,
      subtitle: pkg.description || `v${pkg.latestVersion || "1.0.0"}`,
      icon: <PackageIcon size={16} />,
      action: () => {
        navigate(`/packages/${pkg.name}`);
        onClose();
      },
    }));

    const repoItems: CommandItem[] = (completions.repositories || []).map((r) => ({
      id: `repo-${r.id || r.project}`,
      category: "Repositories",
      title: r.project || r.name || "",
      subtitle: `${r.provider}/${r.namespace}`,
      icon: <RepoIcon size={16} />,
      action: () => {
        navigate(`/repos/${r.provider}/${r.namespace}/${r.project || r.name}`);
        onClose();
      },
    }));

    const aiItems: CommandItem[] = [
      {
        id: `ai-ask-${query}`,
        category: "AI Copilot",
        title: `Ask Copilot: "${query}"`,
        subtitle: "Query physical models, equation semantics, and solvers",
        icon: <ZapIcon size={16} />,
        action: () => {
          navigate(`/explore?q=${encodeURIComponent(query)}`);
          onClose();
        },
      },
      {
        id: `ai-synth-${query}`,
        category: "AI Copilot",
        title: `Synthesize: /synthesize ${query}`,
        subtitle: "Generate Modelica code and DAE architecture from specification",
        icon: <CodeIcon size={16} />,
        action: () => {
          onClose();
          if (onOpenCompose) onOpenCompose();
        },
      },
    ];

    return [...aiItems, ...matchingNav, ...userItems, ...packageItems, ...repoItems];
  }, [query, completions, navigate, onClose, onOpenCompose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (allItems.length > 0 ? (prev + 1) % allItems.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (allItems.length > 0 ? (prev - 1 + allItems.length) % allItems.length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (allItems[activeIndex]) {
          allItems[activeIndex].action();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, allItems, activeIndex, onClose]);

  if (!isOpen) return null;

  return (
    <Overlay onClick={onClose}>
      <PaletteCard onClick={(e) => e.stopPropagation()}>
        <InputHeader>
          <SearchIcon size={18} fill="var(--color-fg-muted)" />
          <input
            ref={inputRef}
            placeholder="Type a command or search models, packages, people..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>ESC</kbd>
        </InputHeader>

        <ResultsList>
          {allItems.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-fg-muted)" }}>
              No matching commands or entities found for &quot;{query}&quot;
            </div>
          ) : (
            allItems.map((item, index) => {
              const isFirstInCategory = index === 0 || allItems[index - 1].category !== item.category;
              return (
                <React.Fragment key={item.id}>
                  {isFirstInCategory && <CategoryHeader>{item.category}</CategoryHeader>}
                  <ResultItem
                    $active={index === activeIndex}
                    onClick={item.action}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <div className="left">
                      <div className="icon">{item.icon}</div>
                      <div className="info">
                        <span className="title">{item.title}</span>
                        {item.subtitle && <span className="subtitle">{item.subtitle}</span>}
                      </div>
                    </div>
                    <div className="enter-hint">
                      <span>Select</span>
                      <kbd>↵</kbd>
                    </div>
                  </ResultItem>
                </React.Fragment>
              );
            })
          )}
        </ResultsList>

        <Footer>
          <span>ModelScript Omnibar</span>
          <div className="keys">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> select
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </Footer>
      </PaletteCard>
    </Overlay>
  );
};
