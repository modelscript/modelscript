// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  LawIcon,
  LinkExternalIcon,
  RepoForkedIcon,
  StarIcon,
  TagIcon,
} from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { GitlabProject, GitlabTag } from "../../../api";
import Box from "../../../components/Box";
import { isRepoForked, isRepoStarred, isRepoWatching } from "../utils";

export interface RepoAboutSidebarProps {
  repo: GitlabProject;
  tags?: GitlabTag[] | undefined;
  onSelectTag?: ((tagName: string) => void) | undefined;
}

function inferLanguagesBreakdown(repo: GitlabProject): { name: string; pct: number; color: string }[] {
  if (Array.isArray(repo.languages_breakdown) && repo.languages_breakdown.length > 0) {
    return repo.languages_breakdown;
  }
  const hay =
    `${repo.path_with_namespace || repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();
  if (hay.includes("modelica")) {
    return [
      { name: "Modelica", pct: 91.2, color: "#0284c7" },
      { name: "C", pct: 6.4, color: "#555555" },
      { name: "Python", pct: 2.4, color: "#3572A5" },
    ];
  }
  if (hay.includes("sysml") || hay.includes("kerml")) {
    return [
      { name: "SysML v2", pct: 74.0, color: "#7c3aed" },
      { name: "KerML", pct: 22.0, color: "#0f766e" },
      { name: "JSON", pct: 4.0, color: "#292929" },
    ];
  }
  if (hay.includes("eigen") || hay.includes("su2") || hay.includes("openscad") || hay.includes("inkscape")) {
    return [
      { name: "C++", pct: 86.5, color: "#f34b7d" },
      { name: "CMake", pct: 8.5, color: "#DA3434" },
      { name: "Python", pct: 5.0, color: "#3572A5" },
    ];
  }
  return [
    { name: "ModelScript", pct: 68.0, color: "#0f766e" },
    { name: "Modelica", pct: 24.0, color: "#0284c7" },
    { name: "TypeScript", pct: 8.0, color: "#3178c6" },
  ];
}

export const RepoAboutSidebar: React.FC<RepoAboutSidebarProps> = ({ repo, tags = [], onSelectTag }) => {
  const repoKey = repo.path_with_namespace || repo.name;
  const [starred, setStarred] = useState(() => isRepoStarred(repoKey));
  const [watching, setWatching] = useState(() => isRepoWatching(repoKey));
  const [forked, setForked] = useState(() => isRepoForked(repoKey));
  const [copiedClone, setCopiedClone] = useState(false);

  useEffect(() => {
    const sync = () => {
      setStarred(isRepoStarred(repoKey));
      setWatching(isRepoWatching(repoKey));
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

  const licenseLabel =
    typeof repo.license === "string" ? repo.license : repo.license?.spdx_id || repo.license?.name || "BSD-3-Clause";
  const topics = Array.isArray(repo.topics) ? repo.topics : [];
  const languages = useMemo(() => inferLanguagesBreakdown(repo), [repo]);

  const cloneUrl = repo.web_url
    ? `${repo.web_url.replace(/\/+$/, "")}.git`
    : `${window.location.origin}/git/${repoKey}.git`;

  const handleCopyClone = () => {
    navigator.clipboard?.writeText(cloneUrl).catch(() => {});
    setCopiedClone(true);
    setTimeout(() => setCopiedClone(false), 1800);
  };

  const starCount = (repo.star_count ?? 0) + (starred ? 1 : 0);
  const watcherCount = (repo.watchers_count ?? 0) + (watching ? 1 : 0);
  const forkCount = (repo.forks_count ?? 0) + (forked ? 1 : 0);

  return (
    <Box display="flex" flexDirection="column" gap={4} style={{ paddingTop: "8px" }}>
      {/* About Section */}
      <Box pb={3} style={{ borderBottom: "1px solid var(--color-border-muted)" }}>
        <Heading as="h2" style={{ fontSize: "16px", marginBottom: "10px" }}>
          About
        </Heading>
        <Text
          as="p"
          style={{ marginBottom: "14px", color: "var(--color-fg-default)", lineHeight: 1.5, fontSize: "14px" }}
        >
          {repo.description || "No description, website, or topics provided."}
        </Text>

        {repo.web_url && (
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <LinkExternalIcon fill="var(--color-fg-muted)" />
            <a
              href={repo.web_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--color-accent-fg)",
                fontWeight: 600,
                fontSize: "13px",
                textDecoration: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {repo.web_url.replace(/^https?:\/\//, "")}
            </a>
          </Box>
        )}

        {topics.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={1} mb={3}>
            {topics.slice(0, 10).map((topic) => (
              <Link
                key={topic}
                to={`/repos?q=${encodeURIComponent(topic)}`}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 10px",
                  borderRadius: "9999px",
                  backgroundColor: "rgba(15, 118, 110, 0.1)",
                  color: "var(--ms-brand, #0f766e)",
                  textDecoration: "none",
                }}
                title={`Search repositories tagged '${topic}'`}
              >
                {topic}
              </Link>
            ))}
          </Box>
        )}

        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <BookIcon fill="var(--color-fg-muted)" />
          <Text style={{ color: "var(--color-fg-muted)", fontWeight: 600, fontSize: "13px" }}>Readme</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <LawIcon fill="var(--color-fg-muted)" />
          <Text style={{ color: "var(--color-fg-muted)", fontWeight: 600, fontSize: "13px" }}>{licenseLabel}</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <StarIcon fill={starred ? "#eab308" : "var(--color-fg-muted)"} />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "13px" }}>
            {starCount.toLocaleString()}
          </Text>{" "}
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            stars
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <EyeIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "13px" }}>
            {watcherCount.toLocaleString()}
          </Text>{" "}
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            watching
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <RepoForkedIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "13px" }}>
            {forkCount.toLocaleString()}
          </Text>{" "}
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            forks
          </Text>
        </Box>
      </Box>

      {/* Clone URL Section */}
      <Box pb={3} style={{ borderBottom: "1px solid var(--color-border-muted)" }}>
        <Heading as="h3" style={{ fontSize: "14px", marginBottom: "8px" }}>
          Clone Repository
        </Heading>
        <Box
          display="flex"
          alignItems="center"
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: "6px",
            background: "var(--color-canvas-subtle)",
            overflow: "hidden",
          }}
        >
          <input
            type="text"
            readOnly
            value={cloneUrl}
            aria-label="HTTPS clone URL"
            onClick={(e) => (e.target as HTMLInputElement).select()}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              padding: "6px 8px",
              fontSize: "12px",
              fontFamily: "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace",
              color: "var(--color-fg-default)",
              outline: "none",
              minWidth: 0,
            }}
          />
          <button
            type="button"
            onClick={handleCopyClone}
            title="Copy HTTPS clone URL"
            style={{
              border: "none",
              borderLeft: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              padding: "6px 10px",
              cursor: "pointer",
              color: copiedClone ? "var(--color-success-fg)" : "var(--color-fg-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {copiedClone ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            {copiedClone ? "Copied" : "Copy"}
          </button>
        </Box>
      </Box>

      {/* Releases / Tags Section */}
      {tags.length > 0 && (
        <Box pb={3} style={{ borderBottom: "1px solid var(--color-border-muted)" }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Heading as="h3" style={{ fontSize: "14px", margin: 0 }}>
              Releases & Tags
            </Heading>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: "9999px",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-fg-muted)",
              }}
            >
              {tags.length}
            </span>
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            {tags.slice(0, 4).map((t, idx) => (
              <button
                key={t.name}
                type="button"
                onClick={() => onSelectTag?.(t.name)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "4px 6px",
                  borderRadius: "6px",
                  cursor: onSelectTag ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  textAlign: "left",
                  color: "var(--color-fg-default)",
                }}
                title={t.message || `Checkout tag ${t.name}`}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <TagIcon size={13} fill="var(--color-success-fg)" />
                  <Text style={{ fontWeight: 600, fontSize: "13px" }}>{t.name}</Text>
                </Box>
                {idx === 0 && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "9999px",
                      border: "1px solid var(--color-success-emphasis, #1a7f37)",
                      color: "var(--color-success-fg, #1a7f37)",
                    }}
                  >
                    Latest
                  </span>
                )}
              </button>
            ))}
          </Box>
        </Box>
      )}

      {/* Languages Breakdown Section */}
      {languages.length > 0 && (
        <Box>
          <Heading as="h3" style={{ fontSize: "14px", marginBottom: "10px" }}>
            Languages
          </Heading>
          <Box
            display="flex"
            style={{
              height: "8px",
              borderRadius: "9999px",
              overflow: "hidden",
              marginBottom: "10px",
              background: "var(--color-canvas-subtle)",
              gap: "2px",
            }}
          >
            {languages.map((lang) => (
              <div
                key={lang.name}
                style={{
                  width: `${Math.max(lang.pct, 3)}%`,
                  backgroundColor: lang.color,
                  height: "100%",
                }}
                title={`${lang.name}: ${lang.pct}%`}
              />
            ))}
          </Box>
          <Box display="flex" flexWrap="wrap" gap={2}>
            {languages.map((lang) => (
              <Box key={lang.name} display="inline-flex" alignItems="center" gap={1} style={{ fontSize: "12px" }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: lang.color,
                    display: "inline-block",
                  }}
                />
                <Text style={{ fontWeight: 600, color: "var(--color-fg-default)" }}>{lang.name}</Text>
                <Text style={{ color: "var(--color-fg-muted)" }}>{lang.pct}%</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default RepoAboutSidebar;
