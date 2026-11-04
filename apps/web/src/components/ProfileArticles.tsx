// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading, Text } from "@primer/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { getUserPosts } from "../api";
import Box from "./Box";
import Spinner from "./Spinner";

type ViewMode = "list" | "archive" | "topics";
type SortKey = "newest" | "oldest" | "title" | "liked" | "longest";

interface ArticleEntry {
  id: string;
  title: string;
  summary: string;
  topics: string[];
  series?: string | undefined;
  difficulty?: string | undefined;
  readMinutes?: number | undefined;
  likes: number;
  createdAt: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title A–Z",
  liked: "Most liked",
  longest: "Longest read",
};

// ── Styles ───────────────────────────────────────────────────────────────

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
`;

const SearchInput = styled.input`
  flex: 1 1 220px;
  min-width: 0;
  padding: 6px 10px;
  font-size: 14px;
  color: var(--color-fg-default);
  background: var(--color-canvas-default, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  font-family: inherit;
`;

const SelectInput = styled.select`
  padding: 6px 8px;
  font-size: 13px;
  color: var(--color-fg-default);
  background: var(--color-canvas-default, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  font-family: inherit;
`;

const Segmented = styled.div`
  display: inline-flex;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  overflow: hidden;
`;

const SegmentButton = styled.button<{ $active: boolean }>`
  padding: 5px 12px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  border: none;
  color: ${(p) => (p.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  background: ${(p) => (p.$active ? "var(--color-neutral-muted, rgba(128,128,128,0.2))" : "transparent")};
  font-weight: ${(p) => (p.$active ? 600 : 400)};

  & + & {
    border-left: 1px solid var(--color-border-default);
  }
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
`;

const TopicChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$active ? "var(--color-accent-fg, var(--color-accent-emphasis))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-accent-fg, var(--color-accent-emphasis))" : "var(--color-fg-muted)")};
  background: ${(p) =>
    p.$active
      ? "var(--color-accent-subtle, rgba(56,139,253,0.12))"
      : "var(--color-neutral-muted, rgba(128,128,128,0.15))"};

  &:hover {
    border-color: var(--color-border-default);
  }
`;

const ChipCount = styled.span`
  opacity: 0.7;
  font-size: 11px;
`;

const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--color-fg-muted);
`;

const LinkButton = styled.button`
  padding: 0;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  color: var(--color-accent-fg, var(--color-accent-emphasis));
  background: none;
  border: none;

  &:hover {
    text-decoration: underline;
  }
`;

const GroupHeader = styled.h3`
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-fg-muted);
  background: var(--color-canvas-default, var(--bgColor-default, #fff));
  border-bottom: 1px solid var(--color-border-muted, var(--color-border-default));
`;

const GroupToggle = styled.button`
  display: flex;
  width: 100%;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 0;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default);
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border-muted, var(--color-border-default));
  text-align: left;
`;

const Row = styled.article`
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border-muted, var(--color-border-default));
`;

const RowTitle = styled(Link)`
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-fg-default);
  text-decoration: none;

  &:hover {
    color: var(--color-accent-fg, var(--color-accent-emphasis));
    text-decoration: underline;
  }
`;

const RowSummary = styled.p`
  display: -webkit-box;
  margin: 4px 0 6px;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-fg-muted);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;

const RowMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-size: 12px;
  color: var(--color-fg-muted);
`;

// ── Helpers ──────────────────────────────────────────────────────────────

function parseMetadata(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/::artifact[^\n]*/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toEntry(post: any): ArticleEntry | null {
  if (!post || post.id == null) return null;
  const nb = parseMetadata(post.metadata)["notebook"] ?? {};
  const cells: any[] = Array.isArray(nb.cells) ? nb.cells : [];
  const firstMarkdown = cells.find((c) => c?.type === "markdown" && typeof c.content === "string" && c.content.trim());
  const body: string = firstMarkdown?.content ?? (typeof post.content === "string" ? post.content : "");
  const headingMatch = body.match(/^#{1,3}\s+(.+)$/m);

  const title = (typeof nb.title === "string" && nb.title.trim()) || headingMatch?.[1]?.trim() || "Untitled article";
  const summaryText =
    (typeof nb.summary === "string" && nb.summary.trim()) ||
    stripMarkdown(body.replace(/^#{1,3}\s+.+$/m, "")).slice(0, 220);
  const topics: string[] = Array.isArray(nb.topics)
    ? nb.topics.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  const createdAt = new Date(post.created_at ?? post.createdAt ?? 0).getTime();

  return {
    id: String(post.id),
    title,
    summary: summaryText,
    topics,
    series: typeof nb.series === "string" && nb.series.trim() ? nb.series.trim() : undefined,
    difficulty: typeof nb.difficulty === "string" && nb.difficulty ? nb.difficulty : undefined,
    readMinutes: Number.isFinite(Number(nb.estimatedReadMinutes)) ? Number(nb.estimatedReadMinutes) : undefined,
    likes: Number(post.like_count) || 0,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
}

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function compareEntries(sort: SortKey): (a: ArticleEntry, b: ArticleEntry) => number {
  switch (sort) {
    case "oldest":
      return (a, b) => a.createdAt - b.createdAt;
    case "title":
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "liked":
      return (a, b) => b.likes - a.likes || b.createdAt - a.createdAt;
    case "longest":
      return (a, b) => (b.readMinutes ?? 0) - (a.readMinutes ?? 0) || b.createdAt - a.createdAt;
    default:
      return (a, b) => b.createdAt - a.createdAt;
  }
}

// ── Components ───────────────────────────────────────────────────────────

interface ArticleRowProps {
  entry: ArticleEntry;
  activeTopics: Set<string>;
  onToggleTopic: (topic: string) => void;
}

function ArticleRow({ entry, activeTopics, onToggleTopic }: ArticleRowProps) {
  return (
    <Row>
      <RowTitle to={`/posts/${entry.id}`}>{entry.title}</RowTitle>
      {entry.summary && <RowSummary>{entry.summary}</RowSummary>}
      <RowMeta>
        {entry.createdAt > 0 && (
          <time dateTime={new Date(entry.createdAt).toISOString()}>{formatDate(entry.createdAt)}</time>
        )}
        {entry.readMinutes ? <span>{entry.readMinutes} min read</span> : null}
        {entry.difficulty && <span>{entry.difficulty}</span>}
        {entry.series && <span>Series: {entry.series}</span>}
        {entry.likes > 0 && (
          <span>
            {entry.likes} like{entry.likes === 1 ? "" : "s"}
          </span>
        )}
        {entry.topics.map((topic) => (
          <TopicChip key={topic} type="button" $active={activeTopics.has(topic)} onClick={() => onToggleTopic(topic)}>
            {topic}
          </TopicChip>
        ))}
      </RowMeta>
    </Row>
  );
}

export default function ProfileArticles({ username }: { username: string; isOwnProfile?: boolean }) {
  const [entries, setEntries] = useState<ArticleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const viewParam = params.get("view");
  const view: ViewMode = viewParam === "archive" || viewParam === "topics" ? viewParam : "list";
  const setView = (mode: ViewMode) => update({ view: mode === "list" ? null : mode });

  const query = params.get("q") ?? "";
  const setQuery = (value: string) => update({ q: value || null });

  const sortParam = params.get("sort");
  const sort: SortKey = sortParam && sortParam in SORT_LABELS ? (sortParam as SortKey) : "newest";
  const setSort = (value: SortKey) => update({ sort: value === "newest" ? null : value });

  const topicParam = params.get("topic") ?? "";
  const activeTopics = useMemo(() => new Set(topicParam.split(",").filter(Boolean)), [topicParam]);

  const difficulty = params.get("level") ?? "";
  const setDifficulty = (value: string) => update({ level: value || null });
  const year = params.get("year") ?? "";
  const setYear = (value: string) => update({ year: value || null });
  const series = params.get("series") ?? "";
  const setSeries = (value: string) => update({ series: value || null });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getUserPosts(username, "articles", 500)
      .then((data) => {
        if (cancelled) return;
        setEntries((data.posts ?? []).map(toEntry).filter((e): e is ArticleEntry => e !== null));
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  // "/" focuses the search box, like most documentation sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTopic = (topic: string) => {
    const next = new Set(activeTopics);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    update({ topic: next.size > 0 ? [...next].join(",") : null });
  };

  const clearFilters = () => update({ q: null, topic: null, level: null, year: null, series: null });

  const years = useMemo(
    () =>
      [...new Set(entries.filter((e) => e.createdAt > 0).map((e) => new Date(e.createdAt).getFullYear()))].sort(
        (a, b) => b - a,
      ),
    [entries],
  );
  const difficulties = useMemo(
    () => [...new Set(entries.map((e) => e.difficulty).filter(Boolean) as string[])],
    [entries],
  );
  const seriesList = useMemo(
    () => [...new Set(entries.map((e) => e.series).filter(Boolean) as string[])].sort(),
    [entries],
  );

  // Everything except the topic filter, so topic counts reflect the current context.
  const facetBase = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (difficulty && e.difficulty !== difficulty) return false;
      if (series && e.series !== series) return false;
      if (year && new Date(e.createdAt).getFullYear() !== Number(year)) return false;
      if (q && !`${e.title} ${e.summary} ${e.topics.join(" ")} ${e.series ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [entries, query, difficulty, series, year]);

  const filtered = useMemo(
    () =>
      facetBase
        .filter((e) => [...activeTopics].every((t) => e.topics.includes(t)))
        .sort(compareEntries(view === "list" ? sort : sort === "oldest" ? "oldest" : "newest")),
    [facetBase, activeTopics, sort, view],
  );

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of facetBase) for (const t of e.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
    // Keep selected topics visible even if the current context has zero matches.
    for (const t of activeTopics) if (!counts.has(t)) counts.set(t, 0);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [facetBase, activeTopics]);

  const hasActiveFilters = Boolean(query.trim() || activeTopics.size || difficulty || year || series);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4} textAlign="center">
        <Text color="var(--color-fg-muted)">Articles could not be loaded right now.</Text>
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box p={4} textAlign="center">
        <Heading as="h2" style={{ fontSize: "20px" }}>
          No articles yet
        </Heading>
        <Text color="var(--color-fg-muted)">When @{username} publishes articles, they will show up here.</Text>
      </Box>
    );
  }

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderRow = (entry: ArticleEntry) => (
    <ArticleRow key={entry.id} entry={entry} activeTopics={activeTopics} onToggleTopic={toggleTopic} />
  );

  // ── View renderers ──

  const renderList = () => {
    if (sort !== "newest" && sort !== "oldest") return filtered.map(renderRow);
    const groups = new Map<number, ArticleEntry[]>();
    for (const e of filtered) {
      const y = e.createdAt > 0 ? new Date(e.createdAt).getFullYear() : 0;
      groups.set(y, [...(groups.get(y) ?? []), e]);
    }
    return [...groups.entries()].map(([y, items]) => (
      <section key={y}>
        <GroupHeader>
          <span>{y || "Undated"}</span>
          <span>{items.length}</span>
        </GroupHeader>
        {items.map(renderRow)}
      </section>
    ));
  };

  const renderArchive = () => {
    const byYear = new Map<number, Map<number, ArticleEntry[]>>();
    for (const e of filtered) {
      const d = new Date(e.createdAt);
      const y = e.createdAt > 0 ? d.getFullYear() : 0;
      const m = e.createdAt > 0 ? d.getMonth() : 0;
      const months = byYear.get(y) ?? new Map<number, ArticleEntry[]>();
      months.set(m, [...(months.get(m) ?? []), e]);
      byYear.set(y, months);
    }
    const dir = sort === "oldest" ? 1 : -1;
    return [...byYear.entries()]
      .sort((a, b) => (a[0] - b[0]) * dir)
      .map(([y, months]) => {
        const yearKey = `y-${y}`;
        const yearTotal = [...months.values()].reduce((n, items) => n + items.length, 0);
        const yearCollapsed = collapsed.has(yearKey);
        return (
          <section key={yearKey}>
            <GroupToggle type="button" aria-expanded={!yearCollapsed} onClick={() => toggleCollapsed(yearKey)}>
              <span>
                {yearCollapsed ? "▸" : "▾"} {y || "Undated"}
              </span>
              <span style={{ color: "var(--color-fg-muted)", fontWeight: 400 }}>{yearTotal}</span>
            </GroupToggle>
            {!yearCollapsed &&
              [...months.entries()]
                .sort((a, b) => (a[0] - b[0]) * dir)
                .map(([m, items]) => {
                  const monthKey = `${yearKey}-m-${m}`;
                  const monthCollapsed = collapsed.has(monthKey);
                  return (
                    <div key={monthKey} style={{ paddingLeft: 16 }}>
                      <GroupToggle
                        type="button"
                        aria-expanded={!monthCollapsed}
                        onClick={() => toggleCollapsed(monthKey)}
                        style={{ fontWeight: 500, color: "var(--color-fg-muted)" }}
                      >
                        <span>
                          {monthCollapsed ? "▸" : "▾"} {y ? MONTH_NAMES[m] : "Undated"}
                        </span>
                        <span style={{ fontWeight: 400 }}>{items.length}</span>
                      </GroupToggle>
                      {!monthCollapsed && items.map(renderRow)}
                    </div>
                  );
                })}
          </section>
        );
      });
  };

  const renderTopics = () => {
    const groups = new Map<string, ArticleEntry[]>();
    const untagged: ArticleEntry[] = [];
    for (const e of filtered) {
      if (e.topics.length === 0) untagged.push(e);
      for (const t of e.topics) groups.set(t, [...(groups.get(t) ?? []), e]);
    }
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (untagged.length > 0) ordered.push(["Untagged", untagged]);
    return ordered.map(([topic, items]) => {
      const key = `t-${topic}`;
      const isCollapsed = collapsed.has(key);
      return (
        <section key={key}>
          <GroupToggle type="button" aria-expanded={!isCollapsed} onClick={() => toggleCollapsed(key)}>
            <span>
              {isCollapsed ? "▸" : "▾"} {topic}
            </span>
            <span style={{ color: "var(--color-fg-muted)", fontWeight: 400 }}>{items.length}</span>
          </GroupToggle>
          {!isCollapsed && items.map(renderRow)}
        </section>
      );
    });
  };

  return (
    <Box p={3}>
      <Toolbar>
        <SearchInput
          ref={searchRef}
          type="search"
          aria-label="Search articles"
          placeholder={`Search ${entries.length} article${entries.length === 1 ? "" : "s"}…  (press / to focus)`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented role="tablist" aria-label="Article view">
          {(["list", "archive", "topics"] as const).map((mode) => (
            <SegmentButton
              key={mode}
              type="button"
              role="tab"
              aria-selected={view === mode}
              $active={view === mode}
              onClick={() => setView(mode)}
            >
              {mode === "list" ? "List" : mode === "archive" ? "Archive" : "Topics"}
            </SegmentButton>
          ))}
        </Segmented>
      </Toolbar>

      <Toolbar>
        <SelectInput aria-label="Sort articles" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key} disabled={view !== "list" && key !== "newest" && key !== "oldest"}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </SelectInput>
        {years.length > 1 && (
          <SelectInput aria-label="Filter by year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </SelectInput>
        )}
        {difficulties.length > 0 && (
          <SelectInput
            aria-label="Filter by difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="">Any difficulty</option>
            {difficulties.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectInput>
        )}
        {seriesList.length > 0 && (
          <SelectInput aria-label="Filter by series" value={series} onChange={(e) => setSeries(e.target.value)}>
            <option value="">Any series</option>
            {seriesList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectInput>
        )}
      </Toolbar>

      {topicCounts.length > 0 && (
        <ChipRow aria-label="Filter by topic">
          {topicCounts.map(([topic, count]) => (
            <TopicChip key={topic} type="button" $active={activeTopics.has(topic)} onClick={() => toggleTopic(topic)}>
              {topic}
              <ChipCount>{count}</ChipCount>
            </TopicChip>
          ))}
        </ChipRow>
      )}

      <StatusBar>
        <span>
          {hasActiveFilters ? `${filtered.length} of ${entries.length}` : entries.length} article
          {(hasActiveFilters ? filtered.length : entries.length) === 1 ? "" : "s"}
        </span>
        {hasActiveFilters && (
          <LinkButton type="button" onClick={clearFilters}>
            Clear filters
          </LinkButton>
        )}
      </StatusBar>

      {filtered.length === 0 ? (
        <Box p={4} textAlign="center">
          <Text color="var(--color-fg-muted)">No articles match your filters.</Text>
        </Box>
      ) : view === "list" ? (
        renderList()
      ) : view === "archive" ? (
        renderArchive()
      ) : (
        renderTopics()
      )}
    </Box>
  );
}
