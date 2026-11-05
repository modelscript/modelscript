// SPDX-License-Identifier: AGPL-3.0-or-later

import { safeJsonParse } from "./json";

export interface NotebookMarkdownCell {
  id: string;
  type: "markdown";
  content: string;
}

export interface NotebookArtifactCell {
  id: string;
  type: "artifact";
  artifactId: number | string;
  title?: string | undefined;
  caption?: string | undefined;
}

export type NotebookCell = NotebookMarkdownCell | NotebookArtifactCell;

export type TutorialDifficulty = "Beginner" | "Intermediate" | "Advanced";
export type ArticleDifficulty = TutorialDifficulty;

export interface NotebookHeading {
  id: string;
  text: string;
  level: 1 | 2 | 3;
  cellId: string;
}

export type ArticleHeading = NotebookHeading;
export type ArticleCell = NotebookCell;
export type ArticleMarkdownCell = NotebookMarkdownCell;
export type ArticleArtifactCell = NotebookArtifactCell;
export type ArticleMetadata = NotebookMetadata;

export interface NotebookMetadata {
  isNotebook: boolean;
  title?: string | undefined;
  summary?: string | undefined;
  difficulty?: TutorialDifficulty | undefined;
  series?: string | undefined;
  seriesPart?: number | undefined;
  dialect?: string | undefined;
  companionRepo?: string | undefined;
  topics?: string[] | undefined;
  estimatedReadMinutes?: number | undefined;
  cells: NotebookCell[];
  artifactIds: (number | string)[];
}

let cellCounter = 0;
export function createCellId(prefix = "cell"): string {
  cellCounter += 1;
  return `${prefix}-${Date.now()}-${cellCounter}`;
}

export function slugifyHeading(rawText: string): string {
  const cleaned = rawText
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~[\]()]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "section";
}

/**
 * Extracts H1/H2/H3 headings across all markdown cells (ignoring fenced code blocks)
 * to build an interactive Table of Contents.
 */
export function extractNotebookHeadings(cells: NotebookCell[]): NotebookHeading[] {
  const headings: NotebookHeading[] = [];
  const seenSlugs = new Map<string, number>();

  for (const cell of cells) {
    if (cell.type !== "markdown" || !cell.content) continue;
    // Strip fenced code blocks before scanning headings
    const withoutCode = cell.content.replace(/```[\s\S]*?```/g, "");
    const lines = withoutCode.split("\n");
    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (!match) continue;
      const hashes = match[1]!;
      const rawHeading = match[2]!.trim();
      if (!rawHeading) continue;
      // Avoid matching hashtag-only lines like "#modelica"
      if (hashes.length === 1 && /^#[a-zA-Z0-9_-]+$/.test(line.trim())) continue;

      const level = Math.min(3, Math.max(1, hashes.length)) as 1 | 2 | 3;
      const baseSlug = slugifyHeading(rawHeading);
      const count = seenSlugs.get(baseSlug) || 0;
      seenSlugs.set(baseSlug, count + 1);
      const id = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

      headings.push({
        id,
        text: rawHeading.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1"),
        level,
        cellId: cell.id,
      });
    }
  }

  return headings;
}

/**
 * Estimates reading time in minutes based on prose word count, code blocks, and interactive artifacts.
 */
export function estimateReadingTimeMinutes(cells: NotebookCell[]): number {
  let words = 0;
  let artifactCount = 0;
  let codeBlockCount = 0;

  for (const cell of cells) {
    if (cell.type === "artifact") {
      artifactCount += 1;
      if (cell.caption) {
        words += cell.caption.trim().split(/\s+/).filter(Boolean).length;
      }
    } else if (cell.type === "markdown" && cell.content) {
      const codeBlocks = cell.content.match(/```[\s\S]*?```/g);
      if (codeBlocks) {
        codeBlockCount += codeBlocks.length;
      }
      const tokens = cell.content.trim().split(/\s+/).filter(Boolean);
      words += tokens.length;
    }
  }

  const proseMinutes = words / 200;
  const interactiveMinutes = artifactCount * 0.75 + codeBlockCount * 0.4;
  return Math.max(1, Math.round(proseMinutes + interactiveMinutes));
}

export function createStarterNotebookCells(): {
  title: string;
  summary: string;
  difficulty: TutorialDifficulty;
  series: string;
  dialect: string;
  companionRepo: string;
  cells: NotebookCell[];
} {
  return {
    title: "Guide to Acausal Physical Modeling in ModelScript",
    summary:
      "Learn how to formulate differential-algebraic equations (DAEs), verify structural index reduction, and simulate physical components.",
    difficulty: "Intermediate",
    series: "Modelica & DAE Fundamentals",
    dialect: "Modelica 4.1",
    companionRepo: "Modelica@4.1.0",
    cells: [
      {
        id: createCellId("md"),
        type: "markdown",
        content: `## 1. Overview

In this article, we'll explore how to build, parameterize, and simulate a continuous-time physical system in **ModelScript**. We'll start from the governing differential equations, implement the acausal model, and inspect its step response.

> [!TIP]
> Every code block in this article can be copied or opened directly in the **ModelScript Web IDE** for live interactive simulation.`,
      },
      {
        id: createCellId("md"),
        type: "markdown",
        content: `## 2. Mathematical Formulation

Consider a damped harmonic oscillator governed by Newton's second law:

$$m \\ddot{x}(t) + c \\dot{x}(t) + k x(t) = F(t)$$

where $m$ is the mass ($\\text{kg}$), $c$ is the viscous damping coefficient ($\\text{N}\\cdot\\text{s/m}$), and $k$ is the spring stiffness ($\\text{N/m}$). The natural frequency $\\omega_n$ and damping ratio $\\zeta$ are defined as:

$$\\omega_n = \\sqrt{\\frac{k}{m}}, \\quad \\zeta = \\frac{c}{2\\sqrt{m k}}$$`,
      },
      {
        id: createCellId("md"),
        type: "markdown",
        content: `## 3. Model Implementation

Let's express this system in Modelica by declaring our parameters, state variables with initial conditions, and the acausal equations:

\`\`\`modelica
// File: MassSpringDamper.mo
model MassSpringDamper "Second-order damped mechanical oscillator"
  parameter Real m = 1.0 "System mass (kg)";
  parameter Real c = 0.4 "Viscous damping (N.s/m)";
  parameter Real k = 25.0 "Spring stiffness (N/m)";

  Real x(start = 1.0, fixed = true) "Position (m)";
  Real v(start = 0.0, fixed = true) "Velocity (m/s)";
  Real E "Total mechanical energy (J)";
equation
  der(x) = v;
  m * der(v) + c * v + k * x = 0.0;
  E = 0.5 * m * v^2 + 0.5 * k * x^2;
end MassSpringDamper;
\`\`\`

> [!NOTE]
> Notice that we don't need to manually rearrange equations into state-space form—the **ModelScript Flattener** lowers equations directly into the linear-memory DAE arena and performs BLT causalization automatically.`,
      },
      {
        id: createCellId("md"),
        type: "markdown",
        content: `## 4. Verification & Key Takeaways

When compiled and simulated with the **SUNDIALS CVODE** integrator, the total mechanical energy $E(t)$ decays monotonically due to viscous dissipation $c \\dot{x}^2 \\ge 0$.

| Parameter | Symbol | Default Value | Unit |
| :--- | :--- | :--- | :--- |
| Mass | \`m\` | \`1.0\` | $\\text{kg}$ |
| Damping | \`c\` | \`0.4\` | $\\text{N}\\cdot\\text{s/m}$ |
| Stiffness | \`k\` | \`25.0\` | $\\text{N/m}$ |

## 5. Conclusion

In this article, we covered how to translate a second-order ODE into an executable ModelScript model, verify its structural properties, and analyze its trajectory.`,
      },
    ],
  };
}

/**
 * Matches inline or block artifact directives:
 *   ::artifact[Optional Title]{id=123 caption="Optional caption"}
 *   ::artifact{id=123}
 */
const ARTIFACT_DIRECTIVE_REGEX = /::artifact(?:\[([^\]]*)\])?\{([^}]*)\}/g;

export function hasArtifactDirectives(text: string | null | undefined): boolean {
  if (!text) return false;
  ARTIFACT_DIRECTIVE_REGEX.lastIndex = 0;
  return ARTIFACT_DIRECTIVE_REGEX.test(text);
}

function parseDirectiveAttributes(attrString: string): {
  id?: number | string | undefined;
  title?: string | undefined;
  caption?: string | undefined;
} {
  const result: { id?: number | string | undefined; title?: string | undefined; caption?: string | undefined } = {};
  const idMatch = attrString.match(/(?:^|\s)id\s*=\s*["']?(\d+)["']?/);
  if (idMatch && idMatch[1]) {
    const raw = idMatch[1];
    result.id = !Number.isSafeInteger(Number(raw)) ? raw : Number(raw);
  }
  const titleMatch = attrString.match(/(?:^|\s)title\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (titleMatch) {
    result.title = titleMatch[1] ?? titleMatch[2];
  }
  const captionMatch = attrString.match(/(?:^|\s)caption\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (captionMatch) {
    result.caption = captionMatch[1] ?? captionMatch[2];
  }
  return result;
}

export function formatArtifactDirective(cell: {
  artifactId: number | string;
  title?: string | undefined;
  caption?: string | undefined;
}): string {
  const safeTitle = (cell.title || "").replace(/\]/g, "");
  const labelPart = safeTitle ? `[${safeTitle}]` : "";
  const attrs: string[] = [`id=${cell.artifactId}`];
  if (cell.caption && cell.caption.trim()) {
    const escapedCaption = cell.caption.trim().replace(/"/g, "'");
    attrs.push(`caption="${escapedCaption}"`);
  }
  return `::artifact${labelPart}{${attrs.join(" ")}}`;
}

export function extractArtifactIdsFromCells(cells: NotebookCell[]): (number | string)[] {
  const seen = new Set<string>();
  const result: (number | string)[] = [];
  for (const cell of cells) {
    if (
      cell.type === "artifact" &&
      cell.artifactId !== undefined &&
      cell.artifactId !== null &&
      String(cell.artifactId).trim() !== ""
    ) {
      const strId = String(cell.artifactId);
      if (!seen.has(strId)) {
        seen.add(strId);
        result.push(cell.artifactId);
      }
    }
  }
  return result;
}

/**
 * Serializes an ordered array of notebook cells into a standard Markdown string
 * containing interspersed `::artifact[Title]{id=...}` directives.
 */
export function serializeCellsToMarkdown(cells: NotebookCell[], notebookTitle?: string): string {
  const blocks: string[] = [];
  const trimmedTitle = notebookTitle?.trim();

  if (trimmedTitle) {
    const firstMd = cells.find((c) => c.type === "markdown") as NotebookMarkdownCell | undefined;
    const startsWithSameHeading =
      firstMd && firstMd.content.trim().toLowerCase().startsWith(`# ${trimmedTitle.toLowerCase()}`);
    if (!startsWithSameHeading) {
      blocks.push(`# ${trimmedTitle}`);
    }
  }

  for (const cell of cells) {
    if (cell.type === "markdown") {
      const text = cell.content.trim();
      if (text) {
        blocks.push(text);
      }
    } else if (
      cell.type === "artifact" &&
      cell.artifactId !== undefined &&
      cell.artifactId !== null &&
      String(cell.artifactId).trim() !== ""
    ) {
      blocks.push(formatArtifactDirective(cell));
    }
  }

  return blocks.join("\n\n");
}

const notebookParseCache = new Map<string, NotebookMetadata>();
const MAX_NOTEBOOK_CACHE_SIZE = 250;

/**
 * Parses a post's Markdown content and optional metadata into structured NotebookCells.
 * Results are cached in an in-memory LRU map to avoid re-parsing regexes on scroll.
 */
export function parseNotebookFromContent(
  content: string | null | undefined,
  fallbackArtifactId?: number | string | null,
  existingNotebookMeta?: Partial<NotebookMetadata> | null,
): NotebookMetadata {
  const cacheKey = `${content || ""}::${fallbackArtifactId ?? ""}::${existingNotebookMeta?.title ?? ""}::${existingNotebookMeta?.cells?.length ?? 0}`;
  const cached = notebookParseCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const result = parseNotebookFromContentUncached(content, fallbackArtifactId, existingNotebookMeta);
  if (notebookParseCache.size >= MAX_NOTEBOOK_CACHE_SIZE) {
    const oldestKey = notebookParseCache.keys().next().value;
    if (oldestKey) notebookParseCache.delete(oldestKey);
  }
  notebookParseCache.set(cacheKey, result);
  return result;
}

function parseNotebookFromContentUncached(
  content: string | null | undefined,
  fallbackArtifactId?: number | string | null,
  existingNotebookMeta?: Partial<NotebookMetadata> | null,
): NotebookMetadata {
  if (existingNotebookMeta && Array.isArray(existingNotebookMeta.cells) && existingNotebookMeta.cells.length > 0) {
    const validCells: NotebookCell[] = existingNotebookMeta.cells
      .map((c: any, idx: number): NotebookCell | null => {
        if (c.type === "markdown") {
          return {
            id: c.id || createCellId(`md-${idx}`),
            type: "markdown",
            content: typeof c.content === "string" ? c.content : "",
          };
        }
        if (
          c.type === "artifact" &&
          c.artifactId !== null &&
          c.artifactId !== undefined &&
          String(c.artifactId).trim() !== ""
        ) {
          const rawId = c.artifactId;
          const id =
            typeof rawId === "string" && /^\d+$/.test(rawId) && !Number.isSafeInteger(Number(rawId))
              ? rawId
              : Number.isFinite(Number(rawId))
                ? Number(rawId)
                : rawId;
          return {
            id: c.id || createCellId(`art-${idx}`),
            type: "artifact",
            artifactId: id,
            title: c.title,
            caption: c.caption,
          };
        }
        return null;
      })
      .filter((c): c is NotebookCell => c !== null);

    if (validCells.length > 0) {
      const artifactIds = extractArtifactIdsFromCells(validCells);
      const estimatedReadMinutes = existingNotebookMeta.estimatedReadMinutes ?? estimateReadingTimeMinutes(validCells);
      return {
        isNotebook: Boolean(existingNotebookMeta.isNotebook ?? validCells.length > 1),
        title: existingNotebookMeta.title,
        summary: existingNotebookMeta.summary,
        difficulty: existingNotebookMeta.difficulty,
        series: existingNotebookMeta.series,
        seriesPart: existingNotebookMeta.seriesPart,
        dialect: existingNotebookMeta.dialect,
        companionRepo: existingNotebookMeta.companionRepo,
        topics: existingNotebookMeta.topics,
        estimatedReadMinutes,
        cells: validCells,
        artifactIds,
      };
    }
  }

  const raw = content || "";
  let extractedTitle = existingNotebookMeta?.title;
  let workingText = raw;

  // Extract leading H1 as notebook title if present and directives or multiple sections exist
  const leadingH1Match = workingText.match(/^#\s+([^\n]+)\n+/);
  if (leadingH1Match && !extractedTitle && (hasArtifactDirectives(workingText) || workingText.includes("\n## "))) {
    extractedTitle = leadingH1Match[1]!.trim();
    workingText = workingText.slice(leadingH1Match[0].length);
  }

  const cells: NotebookCell[] = [];
  ARTIFACT_DIRECTIVE_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ARTIFACT_DIRECTIVE_REGEX.exec(workingText)) !== null) {
    const beforeText = workingText.slice(lastIndex, match.index).trim();
    if (beforeText) {
      cells.push({
        id: createCellId("md"),
        type: "markdown",
        content: beforeText,
      });
    }

    const bracketTitle = match[1]?.trim();
    const attrs = parseDirectiveAttributes(match[2] || "");
    if (attrs.id && (typeof attrs.id === "string" || Number.isFinite(attrs.id))) {
      cells.push({
        id: createCellId("art"),
        type: "artifact",
        artifactId: attrs.id,
        title: bracketTitle || attrs.title,
        caption: attrs.caption,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  const remainingText = workingText.slice(lastIndex).trim();
  if (remainingText) {
    cells.push({
      id: createCellId("md"),
      type: "markdown",
      content: remainingText,
    });
  }

  if (cells.length === 0) {
    cells.push({
      id: createCellId("md"),
      type: "markdown",
      content: raw,
    });
  }

  const artifactIds = extractArtifactIdsFromCells(cells);
  const validFallbackId =
    fallbackArtifactId !== null && fallbackArtifactId !== undefined && String(fallbackArtifactId).trim() !== ""
      ? !Number.isSafeInteger(Number(fallbackArtifactId))
        ? String(fallbackArtifactId)
        : Number(fallbackArtifactId)
      : null;
  if (validFallbackId && !artifactIds.some((id) => String(id) === String(validFallbackId))) {
    cells.push({
      id: createCellId("art"),
      type: "artifact",
      artifactId: validFallbackId,
    });
    artifactIds.push(validFallbackId);
  }

  const isNotebook = Boolean(
    existingNotebookMeta?.isNotebook ||
    artifactIds.length > 1 ||
    hasArtifactDirectives(raw) ||
    cells.filter((c) => c.type === "markdown" && c.content.trim()).length > 1 ||
    (extractedTitle && raw.includes("\n## ")),
  );

  return {
    isNotebook,
    title: extractedTitle,
    summary: existingNotebookMeta?.summary,
    difficulty: existingNotebookMeta?.difficulty,
    series: existingNotebookMeta?.series,
    seriesPart: existingNotebookMeta?.seriesPart,
    dialect: existingNotebookMeta?.dialect,
    companionRepo: existingNotebookMeta?.companionRepo,
    topics: existingNotebookMeta?.topics,
    estimatedReadMinutes: existingNotebookMeta?.estimatedReadMinutes ?? estimateReadingTimeMinutes(cells),
    cells,
    artifactIds,
  };
}

export function isNotebookPost(post: any): boolean {
  if (!post) return false;
  if (post.metadata?.notebook?.isNotebook) return true;
  if (Array.isArray(post.metadata?.notebook?.cells) && post.metadata.notebook.cells.length > 1) return true;
  if (hasArtifactDirectives(post.content)) return true;
  if (typeof post.content === "string" && /^#\s+[^\n]+\n+[\s\S]*\n##\s+/m.test(post.content)) return true;
  return false;
}

export const isArticlePost = isNotebookPost;
export const parseArticleFromContent = parseNotebookFromContent;
export const createStarterArticleCells = createStarterNotebookCells;
export const extractArticleHeadings = extractNotebookHeadings;
export const serializeArticleToMarkdown = serializeCellsToMarkdown;

/**
 * Determines whether a post is a genuine long-form article / notebook
 * rather than a short social post with attached artifacts.
 */
export function isLongFormArticle(post: unknown, notebookData?: unknown): boolean {
  if (!post) return false;
  const p = (typeof post === "object" ? post : {}) as Record<string, unknown>;

  // Heading pattern in content: # Heading \n## Subheading
  if (typeof p["content"] === "string" && /^#\s+[^\n]+\n+[\s\S]*\n##\s+/m.test(p["content"] as string)) {
    return true;
  }

  const meta =
    typeof p["metadata"] === "string"
      ? safeJsonParse<Record<string, unknown>>(p["metadata"] as string, {})
      : ((p["metadata"] && typeof p["metadata"] === "object" ? p["metadata"] : {}) as Record<string, unknown>);
  const nb = (notebookData || meta["notebook"]) as Record<string, unknown> | undefined;
  if (!nb) return false;

  // Explicit title => article
  if (typeof nb["title"] === "string" && (nb["title"] as string).trim().length > 0) return true;
  // Explicit series or difficulty or companion repository => article
  if (nb["series"] || nb["difficulty"] || nb["companionRepo"]) return true;

  // Has headings (H1/H2/H3 sections)
  if (Array.isArray(nb["cells"])) {
    const cells = nb["cells"] as NotebookCell[];
    const headings = extractNotebookHeadings(cells);
    if (headings.length > 0) return true;
    const mdCells = cells.filter((c) => c.type === "markdown") as NotebookMarkdownCell[];
    const totalMdLen = mdCells.reduce(
      (acc: number, c) => acc + (typeof c.content === "string" ? c.content.length : 0),
      0,
    );
    // If it has multiple markdown cells with substantial prose (> 500 chars)
    if (mdCells.length > 1 && totalMdLen > 500) return true;
  }

  return false;
}
