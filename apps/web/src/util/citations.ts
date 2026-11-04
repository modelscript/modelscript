// SPDX-License-Identifier: AGPL-3.0-or-later

export type CitationStyleId = "apa" | "mla" | "ieee" | "chicago" | "harvard" | "vancouver" | "acm" | "ansatz-urn";

export type CitationExportFormatId = "bibtex" | "biblatex" | "ris" | "csl-json" | "cff" | "enw";

export interface CitationAuthor {
  name: string;
  given?: string | undefined;
  family?: string | undefined;
  username?: string | undefined;
  orcid?: string | undefined;
  affiliation?: string | undefined;
}

export interface CitationTarget {
  urn: string;
  entityType: "post" | "package" | "artifact" | "repo" | "work" | "solution" | "job";
  entityId: string;
  title: string;
  subtitle?: string | null | undefined;
  abstract?: string | null | undefined;
  authors: CitationAuthor[];
  publicationYear: number;
  publicationDate?: string | null | undefined;
  venueName: string;
  publisher?: string | null | undefined;
  volume?: string | null | undefined;
  issue?: string | null | undefined;
  pages?: string | null | undefined;
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  openalexId?: string | null | undefined;
  license?: string | null | undefined;
  url: string;
  sourcePageUrl: string;
  localPdfUrl?: string | null | undefined;
  citationKey: string;
}

export const CITATION_STYLES: Array<{ id: CitationStyleId; label: string; description: string }> = [
  { id: "apa", label: "APA (7th ed.)", description: "American Psychological Association" },
  { id: "ieee", label: "IEEE", description: "Institute of Electrical and Electronics Engineers" },
  { id: "mla", label: "MLA (9th ed.)", description: "Modern Language Association" },
  { id: "chicago", label: "Chicago", description: "Chicago Manual of Style (Author-Date)" },
  { id: "harvard", label: "Harvard", description: "Harvard Reference Style" },
  { id: "vancouver", label: "Vancouver", description: "ICMJE / Biomedical & Engineering" },
  { id: "acm", label: "ACM", description: "Association for Computing Machinery" },
  { id: "ansatz-urn", label: "Ansatz URN", description: "In-post inline citation syntax" },
];

export const CITATION_EXPORT_FORMATS: Array<{
  id: CitationExportFormatId;
  label: string;
  ext: string;
  mime: string;
  description: string;
}> = [
  {
    id: "bibtex",
    label: "BibTeX",
    ext: "bib",
    mime: "application/x-bibtex;charset=utf-8",
    description: "LaTeX / Overleaf / JabRef (.bib)",
  },
  {
    id: "biblatex",
    label: "BibLaTeX",
    ext: "bib",
    mime: "application/x-bibtex;charset=utf-8",
    description: "Modern Biber / BibLaTeX (.bib)",
  },
  {
    id: "ris",
    label: "RIS",
    ext: "ris",
    mime: "application/x-research-info-systems;charset=utf-8",
    description: "Zotero / Mendeley / EndNote (.ris)",
  },
  {
    id: "csl-json",
    label: "CSL-JSON",
    ext: "json",
    mime: "application/json;charset=utf-8",
    description: "Pandoc / Citeproc JSON (.json)",
  },
  {
    id: "cff",
    label: "CITATION.cff",
    ext: "cff",
    mime: "text/yaml;charset=utf-8",
    description: "Citation File Format 1.2.0 (.cff)",
  },
  {
    id: "enw",
    label: "EndNote",
    ext: "enw",
    mime: "application/x-endnote-refer;charset=utf-8",
    description: "Clarivate EndNote Tagged (.enw)",
  },
];

/**
 * Normalizes any raw citation identifier, DOI, OpenAlex ID, ArXiv ID, or URN into a canonical Ansatz URN.
 */
export function normalizeCitationUrn(raw: string): string {
  let cleaned = String(raw || "").trim();
  if (!cleaned) return "urn:ansatz:unknown";

  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // keep raw if malformed URI encoding
  }

  cleaned = cleaned
    .replace(/^\[@?cite:/i, "")
    .replace(/^\[@/, "")
    .replace(/\]$/, "")
    .replace(/^\\cite\{/i, "")
    .replace(/\}$/, "")
    .trim();

  cleaned = cleaned.replace(/^\/?sources\//i, "").trim();

  const oaMatch = cleaned.match(/^(?:https?:\/\/openalex\.org\/|urn:openalex:|openalex:)?(W\d{5,15})$/i);
  if (oaMatch && oaMatch[1]) {
    return `urn:openalex:${oaMatch[1].toUpperCase()}`;
  }

  const doiMatch = cleaned.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|urn:doi:|doi:)(10\.\d{4,9}\/[^\s\]>]+)$/i);
  if (doiMatch && doiMatch[1]) {
    return `urn:doi:${doiMatch[1].toLowerCase()}`;
  }
  if (/^10\.\d{4,9}\/[^\s\]>]+$/.test(cleaned)) {
    return `urn:doi:${cleaned.toLowerCase()}`;
  }

  const arxivMatch = cleaned.match(
    /^(?:https?:\/\/arxiv\.org\/(?:abs|pdf)\/|urn:arxiv:|arxiv:)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7})$/i,
  );
  if (arxivMatch && arxivMatch[1]) {
    return `urn:arxiv:${arxivMatch[1].replace(/\.pdf$/i, "")}`;
  }

  const pmidMatch = cleaned.match(/^(?:urn:pmid:|pmid:)(\d+)$/i);
  if (pmidMatch && pmidMatch[1]) {
    return `urn:pmid:${pmidMatch[1]}`;
  }

  const isbnMatch = cleaned.match(/^(?:urn:isbn:|isbn:)([0-9Xx-]+)$/i);
  if (isbnMatch && isbnMatch[1]) {
    return `urn:isbn:${isbnMatch[1].replace(/[^0-9Xx]/g, "").toUpperCase()}`;
  }

  if (/^urn:[a-z0-9_-]+:/i.test(cleaned)) {
    const parts = cleaned.split(":");
    const prefix = parts.slice(0, 2).join(":").toLowerCase();
    const rest = parts.slice(2).join(":");
    if (prefix === "urn:openalex") return `urn:openalex:${rest.toUpperCase()}`;
    if (prefix === "urn:doi") return `urn:doi:${rest.toLowerCase()}`;
    return `${prefix}:${rest}`;
  }

  return `urn:cite:${cleaned}`;
}

/**
 * Builds the canonical Ansatz source page URL for any URN or identifier.
 */
export function buildSourcePageUrl(urnOrId: string): string {
  const norm = normalizeCitationUrn(urnOrId);
  if (norm.startsWith("urn:ansatz:post:")) {
    const postId = norm.slice("urn:ansatz:post:".length);
    return `/posts/${encodeURIComponent(postId)}`;
  }
  return `/sources/${encodeURIComponent(norm)}`;
}

export function generateCitationKey(
  authors: CitationAuthor[],
  year: number,
  title: string,
  fallbackId?: string,
): string {
  const firstAuthor = authors[0]?.family || authors[0]?.name?.replace(/^@/, "").split(/\s+/).pop() || "ansatz";
  const cleanAuthor = firstAuthor.toLowerCase().replace(/[^a-z0-9]/g, "") || "source";
  const stopWords = new Set(["the", "a", "an", "of", "for", "in", "on", "and", "to", "with", "by", "from"]);
  const firstWord =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .find((w) => w.length > 2 && !stopWords.has(w)) ||
    (fallbackId ? fallbackId.toLowerCase().replace(/[^a-z0-9]/g, "") : "work");
  return `${cleanAuthor}${year}${firstWord}`;
}

/**
 * Formats a `CitationTarget` in any of the 8 supported academic styles.
 */
export function formatCitation(target: CitationTarget, style: CitationStyleId = "apa"): string {
  const year = target.publicationYear || new Date().getFullYear();
  const title = target.title || "Untitled";
  const venue = target.venueName || target.publisher || "Ansatz";
  const vol = target.volume ? String(target.volume) : "";
  const iss = target.issue ? String(target.issue) : "";
  const pages = target.pages ? String(target.pages) : "";
  const linkUrl = target.doi
    ? `https://doi.org/${target.doi}`
    : target.url.startsWith("http")
      ? target.url
      : `${typeof window !== "undefined" ? window.location.origin : "https://ansatz.social"}${target.url}`;

  const authors = target.authors && target.authors.length > 0 ? target.authors : [{ name: "Ansatz Contributors" }];

  const formatApaAuthor = (a: CitationAuthor) => {
    const cleanName = a.name.replace(/^@/, "").trim();
    const parts = cleanName.split(/\s+/);
    if (parts.length === 1) return parts[0]!;
    const family = a.family || parts[parts.length - 1]!;
    const given = a.given || parts.slice(0, -1).join(" ");
    const initials = given
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => `${p[0]!.toUpperCase()}.`)
      .join(" ");
    return `${family}, ${initials}`;
  };

  if (style === "ansatz-urn") {
    return `[@${target.urn}]`;
  }

  if (style === "apa") {
    const apaAuthors =
      authors.length === 1
        ? formatApaAuthor(authors[0]!)
        : authors.length === 2
          ? `${formatApaAuthor(authors[0]!)} & ${formatApaAuthor(authors[1]!)}`
          : `${authors.slice(0, -1).map(formatApaAuthor).join(", ")}, & ${formatApaAuthor(authors[authors.length - 1]!)}`;
    const volIssue = vol ? `, ${vol}${iss ? `(${iss})` : ""}` : "";
    const pagePart = pages ? `, ${pages}` : "";
    return `${apaAuthors} (${year}). ${title}. ${venue}${volIssue}${pagePart}. ${linkUrl}`;
  }

  if (style === "mla") {
    const first = authors[0]!;
    const cleanFirst = first.name.replace(/^@/, "").trim();
    const parts = cleanFirst.split(/\s+/);
    const firstFormatted =
      parts.length > 1
        ? `${first.family || parts[parts.length - 1]}, ${first.given || parts.slice(0, -1).join(" ")}`
        : cleanFirst;
    const mlaAuthors =
      authors.length === 1
        ? firstFormatted
        : authors.length === 2
          ? `${firstFormatted}, and ${authors[1]!.name.replace(/^@/, "")}`
          : `${firstFormatted}, et al.`;
    const volPart = vol ? `, vol. ${vol}` : "";
    const issPart = iss ? `, no. ${iss}` : "";
    const pagePart = pages ? `, pp. ${pages}` : "";
    return `${mlaAuthors.replace(/\.$/, "")}. "${title}." ${venue}${volPart}${issPart}, ${year}${pagePart}, ${linkUrl}.`;
  }

  if (style === "ieee") {
    const ieeeAuthors = authors
      .map((a) => {
        const cleanName = a.name.replace(/^@/, "").trim();
        const parts = cleanName.split(/\s+/);
        if (parts.length === 1) return parts[0]!;
        const family = a.family || parts[parts.length - 1]!;
        const initials = parts
          .slice(0, -1)
          .map((p) => `${p[0]!.toUpperCase()}.`)
          .join(" ");
        return `${initials} ${family}`;
      })
      .join(", ");
    const volPart = vol ? `, vol. ${vol}` : "";
    const issPart = iss ? `, no. ${iss}` : "";
    const pagePart = pages ? `, pp. ${pages}` : "";
    const doiPart = target.doi ? `, doi: ${target.doi}` : `, [Online]. Available: ${linkUrl}`;
    return `[1] ${ieeeAuthors}, "${title}," ${venue}${volPart}${issPart}${pagePart}, ${year}${doiPart}.`;
  }

  if (style === "chicago") {
    const first = authors[0]!;
    const cleanFirst = first.name.replace(/^@/, "").trim();
    const parts = cleanFirst.split(/\s+/);
    const firstFormatted =
      parts.length > 1
        ? `${first.family || parts[parts.length - 1]}, ${first.given || parts.slice(0, -1).join(" ")}`
        : cleanFirst;
    const chicagoAuthors =
      authors.length === 1
        ? firstFormatted
        : `${firstFormatted}, and ${authors
            .slice(1)
            .map((a) => a.name.replace(/^@/, ""))
            .join(", ")}`;
    const volIssue = vol ? ` ${vol}${iss ? `, no. ${iss}` : ""}` : "";
    const pagePart = pages ? `: ${pages}` : "";
    return `${chicagoAuthors.replace(/\.$/, "")}. ${year}. "${title}." ${venue}${volIssue}${pagePart}. ${linkUrl}.`;
  }

  if (style === "harvard") {
    const harvardAuthors = authors.map(formatApaAuthor).join(", ");
    const volIssue = vol ? `, ${vol}${iss ? `(${iss})` : ""}` : "";
    const pagePart = pages ? `, pp. ${pages}` : "";
    return `${harvardAuthors} (${year}) '${title}', ${venue}${volIssue}${pagePart}. Available at: ${linkUrl}.`;
  }

  if (style === "vancouver") {
    const vanAuthors = authors
      .slice(0, 6)
      .map((a) => {
        const cleanName = a.name.replace(/^@/, "").trim();
        const parts = cleanName.split(/\s+/);
        if (parts.length === 1) return parts[0]!;
        const family = a.family || parts[parts.length - 1]!;
        const initials = parts
          .slice(0, -1)
          .map((p) => p[0]!.toUpperCase())
          .join("");
        return `${family} ${initials}`;
      })
      .join(", ");
    const volIssue = vol ? `;${vol}${iss ? `(${iss})` : ""}` : "";
    const pagePart = pages ? `:${pages}` : "";
    return `${vanAuthors}. ${title}. ${venue}. ${year}${volIssue}${pagePart}. Available from: ${linkUrl}`;
  }

  const acmAuthors = authors.map((a) => a.name.replace(/^@/, "")).join(", ");
  const volIssue = vol ? `, Vol. ${vol}${iss ? `, No. ${iss}` : ""}` : "";
  const pagePart = pages ? `, ${pages}` : "";
  return `${acmAuthors}. ${year}. ${title}. ${venue}${volIssue} (${year})${pagePart}. ${linkUrl}`;
}

/**
 * Generates machine-readable citation export content (`bibtex`, `biblatex`, `ris`, `csl-json`, `cff`, `enw`).
 */
export function exportCitation(target: CitationTarget, format: CitationExportFormatId = "bibtex"): string {
  const year = target.publicationYear || new Date().getFullYear();
  const linkUrl = target.doi
    ? `https://doi.org/${target.doi}`
    : target.url.startsWith("http")
      ? target.url
      : `${typeof window !== "undefined" ? window.location.origin : "https://ansatz.social"}${target.url}`;
  const authors = target.authors && target.authors.length > 0 ? target.authors : [{ name: "Ansatz Contributors" }];

  if (format === "csl-json") {
    return JSON.stringify(
      [
        {
          id: target.urn || target.citationKey,
          citationKey: target.citationKey,
          URN: target.urn,
          type:
            target.entityType === "package" || target.entityType === "repo"
              ? "software"
              : target.entityType === "artifact"
                ? "dataset"
                : "article-journal",
          title: target.title,
          abstract: target.abstract || undefined,
          author: authors.map((a) => {
            const clean = a.name.replace(/^@/, "").trim();
            const parts = clean.split(/\s+/);
            return {
              family: a.family || parts[parts.length - 1] || clean,
              given: a.given || (parts.length > 1 ? parts.slice(0, -1).join(" ") : ""),
            };
          }),
          issued: { "date-parts": [[year]] },
          "container-title": target.venueName,
          publisher: target.publisher || "Ansatz",
          volume: target.volume || undefined,
          issue: target.issue || undefined,
          page: target.pages || undefined,
          DOI: target.doi || undefined,
          URL: linkUrl,
        },
      ],
      null,
      2,
    );
  }

  if (format === "ris") {
    const ty =
      target.entityType === "package" || target.entityType === "repo"
        ? "COMP"
        : target.entityType === "artifact"
          ? "DATA"
          : "JOUR";
    const lines: string[] = [`TY  - ${ty}`, `ID  - ${target.citationKey || target.urn}`, `TI  - ${target.title}`];
    for (const a of authors) {
      lines.push(`AU  - ${a.name.replace(/^@/, "")}`);
    }
    lines.push(`PY  - ${year}`);
    if (target.venueName) lines.push(`JO  - ${target.venueName}`);
    if (target.publisher) lines.push(`PB  - ${target.publisher}`);
    if (target.volume) lines.push(`VL  - ${target.volume}`);
    if (target.issue) lines.push(`IS  - ${target.issue}`);
    if (target.pages) lines.push(`SP  - ${target.pages}`);
    if (target.doi) lines.push(`DO  - ${target.doi}`);
    lines.push(`UR  - ${linkUrl}`);
    lines.push(`N1  - URN: ${target.urn}`);
    if (target.abstract) lines.push(`AB  - ${target.abstract.replace(/\r?\n/g, " ")}`);
    lines.push("ER  - ");
    return lines.join("\n");
  }

  if (format === "enw") {
    const lines: string[] = [
      `%0 ${target.entityType === "package" || target.entityType === "repo" ? "Computer Program" : "Journal Article"}`,
      `%T ${target.title}`,
    ];
    for (const a of authors) {
      lines.push(`%A ${a.name.replace(/^@/, "")}`);
    }
    lines.push(`%D ${year}`);
    if (target.venueName) lines.push(`%J ${target.venueName}`);
    if (target.publisher) lines.push(`%I ${target.publisher}`);
    if (target.volume) lines.push(`%V ${target.volume}`);
    if (target.issue) lines.push(`%N ${target.issue}`);
    if (target.pages) lines.push(`%P ${target.pages}`);
    if (target.doi) lines.push(`%R ${target.doi}`);
    lines.push(`%U ${linkUrl}`);
    lines.push(`%Z URN: ${target.urn}`);
    return lines.join("\n");
  }

  if (format === "cff") {
    const lines: string[] = [
      "cff-version: 1.2.0",
      'message: "If you use this work, please cite it as below."',
      `type: ${target.entityType === "package" || target.entityType === "repo" ? "software" : "article"}`,
      `title: "${target.title.replace(/"/g, '\\"')}"`,
      "authors:",
    ];
    for (const a of authors) {
      const clean = a.name.replace(/^@/, "").trim();
      const parts = clean.split(/\s+/);
      const family = a.family || parts[parts.length - 1] || clean;
      const given = a.given || (parts.length > 1 ? parts.slice(0, -1).join(" ") : "");
      lines.push(`  - family-names: "${family.replace(/"/g, '\\"')}"`);
      if (given) lines.push(`    given-names: "${given.replace(/"/g, '\\"')}"`);
      if (a.orcid) lines.push(`    orcid: "https://orcid.org/${a.orcid}"`);
    }
    if (target.doi) lines.push(`doi: "${target.doi}"`);
    lines.push(`date-released: "${(target.publicationDate || `${year}-01-01`).slice(0, 10)}"`);
    if (target.license) lines.push(`license: "${target.license}"`);
    lines.push(`url: "${linkUrl}"`);
    lines.push("identifiers:");
    lines.push("  - type: other");
    lines.push(`    value: "${target.urn}"`);
    return lines.join("\n");
  }

  // BibTeX & BibLaTeX
  const entryType =
    target.entityType === "package" || target.entityType === "repo"
      ? "software"
      : target.entityType === "post" || target.entityType === "artifact"
        ? "misc"
        : "article";
  const authorStr = authors.map((a) => a.name.replace(/^@/, "")).join(" and ");
  const fields: Array<[string, string]> = [
    ["author", authorStr],
    ["title", `{${target.title}}`],
    ["journal", target.venueName || "Ansatz"],
    ["publisher", target.publisher || "Ansatz"],
  ];
  if (format === "biblatex" && target.publicationDate) {
    fields.push(["date", target.publicationDate.slice(0, 10)]);
  } else {
    fields.push(["year", String(year)]);
  }
  if (target.volume) fields.push(["volume", String(target.volume)]);
  if (target.issue) fields.push(["number", String(target.issue)]);
  if (target.pages) fields.push(["pages", String(target.pages)]);
  if (target.doi) fields.push(["doi", target.doi]);
  if (target.arxivId) {
    fields.push(["eprint", target.arxivId]);
    fields.push(["archivePrefix", "arXiv"]);
  }
  fields.push(["url", linkUrl]);
  fields.push(["note", `Ansatz URN: ${target.urn}`]);

  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${entryType}{${target.citationKey},\n${body}\n}`;
}

/**
 * Builds a `CitationTarget` from an Ansatz Post object.
 */
export function buildCitationFromPost(post: {
  id: number | string;
  content?: string | null | undefined;
  author_username?: string | undefined;
  author_display_name?: string | null | undefined;
  created_at?: string | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}): CitationTarget {
  const postIdStr = String(post.id);
  const urn = `urn:ansatz:post:${postIdStr}`;
  const rawContent = String(post.content || "").trim();
  const firstLine = rawContent
    .split("\n")[0]
    ?.replace(/^#+\s*/, "")
    .replace(/\[@(?:urn:|doi:|arxiv:|cite:)[^\]]+\]/g, "")
    .trim();
  const metaObj = post.metadata as { notebook?: { title?: string } } | null | undefined;
  const notebookTitle = metaObj?.notebook?.title;
  const title =
    notebookTitle ||
    (firstLine && firstLine.length >= 4
      ? firstLine.length > 110
        ? `${firstLine.slice(0, 107)}...`
        : firstLine
      : `Engineering Post #${postIdStr}`);
  const pubDate = post.created_at ? String(post.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const pubYear = Number(pubDate.slice(0, 4)) || new Date().getFullYear();
  const authorName = post.author_display_name || post.author_username || "Ansatz Author";
  const username = post.author_username || "user";
  const authors: CitationAuthor[] = [{ name: authorName, username }];
  const postUrl = `/@${username}/status/${postIdStr}`;

  return {
    urn,
    entityType: "post",
    entityId: postIdStr,
    title,
    abstract: rawContent || undefined,
    authors,
    publicationYear: pubYear,
    publicationDate: pubDate,
    venueName: "Ansatz Scientific & Engineering Network",
    publisher: "Ansatz",
    url: postUrl,
    sourcePageUrl: postUrl,
    citationKey: generateCitationKey(authors, pubYear, title, `post${postIdStr}`),
  };
}

/**
 * Builds a `CitationTarget` from an Ansatz Package / Library release.
 */
export function buildCitationFromPackage(pkg: {
  name: string;
  version?: string | null | undefined;
  description?: string | null | undefined;
  author?: string | null | undefined;
  license?: string | null | undefined;
  publishedAt?: string | null | undefined;
  repositoryUrl?: string | null | undefined;
}): CitationTarget {
  const version = pkg.version || "1.0.0";
  const urn = `urn:ansatz:package:${pkg.name}@${version}`;
  const pubDate = pkg.publishedAt ? String(pkg.publishedAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const pubYear = Number(pubDate.slice(0, 4)) || new Date().getFullYear();
  const authorName = pkg.author || pkg.name.split(".")[0] || "Ansatz Maintainer";
  const authors: CitationAuthor[] = [{ name: authorName }];
  const title = `${pkg.name} (v${version})`;

  return {
    urn,
    entityType: "package",
    entityId: `${pkg.name}@${version}`,
    title,
    subtitle: "Engineering Model & Simulation Library Package",
    abstract: pkg.description || `Version ${version} of the ${pkg.name} engineering package on Ansatz.`,
    authors,
    publicationYear: pubYear,
    publicationDate: pubDate,
    venueName: "Ansatz Package Registry",
    publisher: "Ansatz",
    volume: version,
    license: pkg.license || "MIT / Modelica-2",
    url: `/packages/${encodeURIComponent(pkg.name)}/${encodeURIComponent(version)}`,
    sourcePageUrl: buildSourcePageUrl(urn),
    citationKey: generateCitationKey(authors, pubYear, pkg.name, version),
  };
}

/**
 * Builds a `CitationTarget` from an Ansatz Artifact View.
 */
export function buildCitationFromArtifact(artifact: {
  id: number;
  title?: string | null | undefined;
  viewType?: string | null | undefined;
  type?: string | null | undefined;
  authorUsername?: string | null | undefined;
  authorDisplayName?: string | null | undefined;
  authorName?: string | null | undefined;
  createdAt?: string | null | undefined;
  description?: string | null | undefined;
  localPdfUrl?: string | null | undefined;
}): CitationTarget {
  const urn = `urn:ansatz:artifact:${artifact.id}`;
  const viewTypeLabel = String(artifact.viewType || artifact.type || "engineering").toUpperCase();
  const title = artifact.title || `${viewTypeLabel} Reproducible Artifact #${artifact.id}`;
  const pubDate = artifact.createdAt ? String(artifact.createdAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const pubYear = Number(pubDate.slice(0, 4)) || new Date().getFullYear();
  const authorName = artifact.authorDisplayName || artifact.authorName || artifact.authorUsername || "Ansatz Creator";
  const authors: CitationAuthor[] = [{ name: authorName, username: artifact.authorUsername || undefined }];

  return {
    urn,
    entityType: "artifact",
    entityId: String(artifact.id),
    title,
    subtitle: `${viewTypeLabel} Interactive Engineering Artifact`,
    abstract: artifact.description || `${title} archived on Ansatz.`,
    authors,
    publicationYear: pubYear,
    publicationDate: pubDate,
    venueName: "Ansatz Reproducible Artifact Archive",
    publisher: "Ansatz",
    url: `/render-artifact/${artifact.id}`,
    sourcePageUrl: buildSourcePageUrl(urn),
    localPdfUrl: artifact.localPdfUrl || null,
    citationKey: generateCitationKey(authors, pubYear, title, `artifact${artifact.id}`),
  };
}

/**
 * Builds a `CitationTarget` from an Ansatz Repository card/entity.
 */
export function buildCitationFromRepo(repo: {
  provider: string;
  namespace: string;
  project: string;
  description?: string | null | undefined;
  defaultBranch?: string | null | undefined;
}): CitationTarget {
  const fullPath = `${repo.provider}/${repo.namespace}/${repo.project}`;
  const urn = `urn:ansatz:repo:${fullPath}`;
  const pubYear = new Date().getFullYear();
  const authors: CitationAuthor[] = [{ name: repo.namespace || "Ansatz Maintainer" }];
  const title = `${repo.namespace}/${repo.project}`;

  return {
    urn,
    entityType: "repo",
    entityId: fullPath,
    title,
    subtitle: "Version-Controlled Engineering Repository",
    abstract: repo.description || `Engineering repository ${title} hosted on Ansatz.`,
    authors,
    publicationYear: pubYear,
    publicationDate: `${pubYear}-01-01`,
    venueName: "Ansatz Git Server",
    publisher: "Ansatz",
    volume: repo.defaultBranch || "main",
    url: `/repos/${fullPath}`,
    sourcePageUrl: buildSourcePageUrl(urn),
    citationKey: generateCitationKey(authors, pubYear, repo.project),
  };
}

/**
 * Builds a `CitationTarget` from a backend `ScholarlyWorkRecord`.
 */
export function buildCitationFromScholarlyWork(work: {
  urn: string;
  title: string;
  subtitle?: string | null | undefined;
  abstract?: string | null | undefined;
  authors?: CitationAuthor[] | undefined;
  publicationYear?: number | null | undefined;
  publicationDate?: string | null | undefined;
  venueName?: string | null | undefined;
  venue?: string | null | undefined;
  publisher?: string | null | undefined;
  volume?: string | null | undefined;
  issue?: string | null | undefined;
  pages?: string | null | undefined;
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  openalexId?: string | null | undefined;
  license?: string | null | undefined;
  canonicalUrl?: string | null | undefined;
  sourcePageUrl?: string | undefined;
  localPdfUrl?: string | null | undefined;
  citationKey?: string | undefined;
  ansatzEntityType?: string | null | undefined;
  ansatzEntityId?: string | null | undefined;
}): CitationTarget {
  const pubYear = work.publicationYear || new Date().getFullYear();
  const authors = work.authors && work.authors.length > 0 ? work.authors : [{ name: "Unknown Author" }];
  const sourcePageUrl = work.sourcePageUrl || buildSourcePageUrl(work.urn);
  return {
    urn: work.urn,
    entityType: (work.ansatzEntityType as CitationTarget["entityType"]) || "work",
    entityId: work.ansatzEntityId || work.openalexId || work.urn,
    title: work.title,
    subtitle: work.subtitle,
    abstract: work.abstract,
    authors,
    publicationYear: pubYear,
    publicationDate: work.publicationDate,
    venueName: work.venueName || work.venue || work.publisher || "Scholarly Publication",
    publisher: work.publisher,
    volume: work.volume,
    issue: work.issue,
    pages: work.pages,
    doi: work.doi,
    arxivId: work.arxivId,
    openalexId: work.openalexId,
    license: work.license,
    url: work.canonicalUrl || sourcePageUrl,
    sourcePageUrl,
    localPdfUrl: work.localPdfUrl,
    citationKey: work.citationKey || generateCitationKey(authors, pubYear, work.title),
  };
}

/**
 * Formats a human-readable badge label for a normalized citation URN.
 */
export function formatShortCitationLabel(urn: string): string {
  const norm = normalizeCitationUrn(urn);
  if (norm.startsWith("urn:openalex:")) {
    return `OpenAlex:${norm.slice("urn:openalex:".length)}`;
  }
  if (norm.startsWith("urn:doi:")) {
    const doi = norm.slice("urn:doi:".length);
    return `DOI:${doi.length > 24 ? `${doi.slice(0, 22)}…` : doi}`;
  }
  if (norm.startsWith("urn:arxiv:")) {
    return `arXiv:${norm.slice("urn:arxiv:".length)}`;
  }
  if (norm.startsWith("urn:ansatz:post:")) {
    return `Post #${norm.slice("urn:ansatz:post:".length)}`;
  }
  if (norm.startsWith("urn:ansatz:package:")) {
    return `Pkg:${norm.slice("urn:ansatz:package:".length)}`;
  }
  if (norm.startsWith("urn:ansatz:artifact:")) {
    return `Artifact #${norm.slice("urn:ansatz:artifact:".length)}`;
  }
  if (norm.startsWith("urn:cite:")) {
    return norm.slice("urn:cite:".length);
  }
  return norm.replace(/^urn:/, "");
}

/**
 * Automatically transforms textual citations inside post Markdown into clickable Markdown links
 * that resolve to Ansatz Source Pages (`/sources/<encoded_urn>`), while preserving fenced code blocks,
 * inline code spans, and existing Markdown links.
 *
 * Supported textual citation syntaxes:
 * - `[@urn:openalex:W2108598243]` or `[@W2108598243]`
 * - `[@urn:doi:10.1016/...]` or `[@doi:10.1016/...]`
 * - `[@urn:arxiv:2104.08682]` or `[@arxiv:2104.08682]`
 * - `[@urn:ansatz:post:42]`, `[@urn:ansatz:package:Modelica@4.0.0]`, `[@urn:ansatz:artifact:7]`
 * - `[@elmqvist2000modelica]` or `[cite:elmqvist2000modelica]`
 * - `\cite{elmqvist2000modelica}`
 * - Bare URNs in prose: `urn:openalex:W2108598243`, `urn:doi:10.1016/...`, `urn:arxiv:...`, `urn:ansatz:...`
 */
export function transformTextualCitationsToMarkdownLinks(markdown: string): string {
  if (!markdown || typeof markdown !== "string") return markdown;

  // Quick bailout if no citation markers exist
  if (
    !markdown.includes("[@") &&
    !markdown.includes("[cite:") &&
    !markdown.includes("\\cite{") &&
    !markdown.includes("urn:")
  ) {
    return markdown;
  }

  // Split by fenced code blocks, inline code, and existing markdown links `[label](url)` so we never corrupt them
  const protectedPattern = /(```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;
  const segments = markdown.split(protectedPattern);

  return segments
    .map((segment, index) => {
      // Odd indices are matched protected blocks
      if (index % 2 === 1) return segment;

      let out = segment;

      // 1. Bracketed citations: [@urn:...], [@doi:...], [@arxiv:...], [@openalex:...], [cite:...], [@author2020key]
      out = out.replace(
        /\[(?:@cite:|cite:|@)((?:urn:[a-z0-9_-]+:|doi:|arxiv:|openalex:|pmid:|isbn:)[^\s\])]+|W\d{5,15}|10\.\d{4,9}\/[^\s\])]+|[a-zA-Z][a-zA-Z0-9_-]*\d{4}[a-zA-Z0-9_-]*)\]/gi,
        (_full, rawId: string) => {
          const norm = normalizeCitationUrn(rawId);
          const label = formatShortCitationLabel(norm);
          return `[📄 ${label}](${buildSourcePageUrl(norm)})`;
        },
      );

      // 2. LaTeX \cite{key1, key2}
      out = out.replace(/\\cite\{([^{}\n]+)\}/gi, (_full, rawKeys: string) => {
        const links = rawKeys
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
          .map((k) => {
            const norm = normalizeCitationUrn(k);
            const label = formatShortCitationLabel(norm);
            return `[📄 ${label}](${buildSourcePageUrl(norm)})`;
          });
        return links.join(" ");
      });

      // 3. Bare URNs in prose (not preceded by `(` or `/` or `@`)
      out = out.replace(
        /(^|[\s(>])(urn:(?:openalex|doi|arxiv|pmid|isbn|cite|ansatz:(?:post|package|artifact|repo|job|solution|work)):[^\s\])"'>]+)/gi,
        (_full, prefix: string, rawUrn: string) => {
          const trailingMatch = rawUrn.match(/([.,;:!?]+)$/);
          const trailing = trailingMatch ? trailingMatch[1]! : "";
          const cleanUrn = trailing ? rawUrn.slice(0, -trailing.length) : rawUrn;
          const norm = normalizeCitationUrn(cleanUrn);
          const label = formatShortCitationLabel(norm);
          return `${prefix}[📄 ${label}](${buildSourcePageUrl(norm)})${trailing}`;
        },
      );

      return out;
    })
    .join("");
}
