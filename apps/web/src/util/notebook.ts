// SPDX-License-Identifier: AGPL-3.0-or-later

export interface NotebookMarkdownCell {
  id: string;
  type: "markdown";
  content: string;
}

export interface NotebookArtifactCell {
  id: string;
  type: "artifact";
  artifactId: number;
  title?: string | undefined;
  caption?: string | undefined;
}

export type NotebookCell = NotebookMarkdownCell | NotebookArtifactCell;

export interface NotebookMetadata {
  isNotebook: boolean;
  title?: string | undefined;
  cells: NotebookCell[];
  artifactIds: number[];
}

let cellCounter = 0;
export function createCellId(prefix = "cell"): string {
  cellCounter += 1;
  return `${prefix}-${Date.now()}-${cellCounter}`;
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
  id?: number | undefined;
  title?: string | undefined;
  caption?: string | undefined;
} {
  const result: { id?: number | undefined; title?: string | undefined; caption?: string | undefined } = {};
  const idMatch = attrString.match(/(?:^|\s)id\s*=\s*["']?(\d+)["']?/);
  if (idMatch && idMatch[1]) {
    result.id = Number(idMatch[1]);
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
  artifactId: number;
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

export function extractArtifactIdsFromCells(cells: NotebookCell[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const cell of cells) {
    if (cell.type === "artifact" && Number.isFinite(cell.artifactId) && cell.artifactId > 0) {
      if (!seen.has(cell.artifactId)) {
        seen.add(cell.artifactId);
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
    } else if (cell.type === "artifact" && Number.isFinite(cell.artifactId) && cell.artifactId > 0) {
      blocks.push(formatArtifactDirective(cell));
    }
  }

  return blocks.join("\n\n");
}

/**
 * Parses a post's Markdown content and optional metadata into structured NotebookCells.
 */
export function parseNotebookFromContent(
  content: string | null | undefined,
  fallbackArtifactId?: number | null,
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
        if (c.type === "artifact" && Number.isFinite(Number(c.artifactId))) {
          return {
            id: c.id || createCellId(`art-${idx}`),
            type: "artifact",
            artifactId: Number(c.artifactId),
            title: c.title,
            caption: c.caption,
          };
        }
        return null;
      })
      .filter((c): c is NotebookCell => c !== null);

    if (validCells.length > 0) {
      const artifactIds = extractArtifactIdsFromCells(validCells);
      return {
        isNotebook: Boolean(existingNotebookMeta.isNotebook ?? validCells.length > 1),
        title: existingNotebookMeta.title,
        cells: validCells,
        artifactIds,
      };
    }
  }

  const raw = content || "";
  let extractedTitle = existingNotebookMeta?.title;
  let workingText = raw;

  // Extract leading H1 as notebook title if present and directives exist
  const leadingH1Match = workingText.match(/^#\s+([^\n]+)\n+/);
  if (leadingH1Match && !extractedTitle && hasArtifactDirectives(workingText)) {
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
    if (attrs.id && Number.isFinite(attrs.id)) {
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
  if (fallbackArtifactId && !artifactIds.includes(fallbackArtifactId)) {
    cells.push({
      id: createCellId("art"),
      type: "artifact",
      artifactId: fallbackArtifactId,
    });
    artifactIds.push(fallbackArtifactId);
  }

  const isNotebook = Boolean(
    existingNotebookMeta?.isNotebook ||
    artifactIds.length > 1 ||
    hasArtifactDirectives(raw) ||
    cells.filter((c) => c.type === "markdown" && c.content.trim()).length > 1,
  );

  return {
    isNotebook,
    title: extractedTitle,
    cells,
    artifactIds,
  };
}

export function isNotebookPost(post: any): boolean {
  if (!post) return false;
  if (post.metadata?.notebook?.isNotebook) return true;
  if (Array.isArray(post.metadata?.notebook?.cells) && post.metadata.notebook.cells.length > 1) return true;
  if (hasArtifactDirectives(post.content)) return true;
  return false;
}
