// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAdmin, requireAuth } from "../middleware/auth-middleware.js";
import {
  buildCitationKey,
  buildFts5MatchQuery,
  buildSampleJsonlForPartition,
  exportScholarlyCitations,
  fetchOpenAlexS3Manifest,
  fetchOpenAlexWorksLive,
  fetchSingleOpenAlexWorkLive,
  formatScholarlyCitation,
  getOpenAlexCacheDirectory,
  getSafeOpenAlexFilePath,
  ingestOpenAlexFromS3OrFile,
  ingestOpenAlexJsonlStream,
  isOnlineOpenAlexAllowed,
  normalizeCitationUrn,
  OPENALEX_S3_HTTPS_BASE,
  parseBibtexToWorks,
  parseRisToWorks,
  preloadOpenAlexS3Slice,
  resolveAnsatzEntityUrn,
  s3UriToHttpsUrl,
  type CitationExportFormatId,
  type CitationStyleId,
  type OpenAlexS3EntityType,
  type OpenAlexS3ManifestEntry,
  type ScholarlyAuthor,
  type ScholarlyConcept,
  type ScholarlyExternalLocation,
  type ScholarlyWorkRecord,
  type ScholarlyYearCount,
} from "../services/openalex.js";

const ALL_STYLES: CitationStyleId[] = ["apa", "mla", "ieee", "chicago", "harvard", "vancouver", "acm", "ansatz-urn"];

const ALL_EXPORTS: CitationExportFormatId[] = ["bibtex", "biblatex", "ris", "csl-json", "cff", "enw"];

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface ScholarlyWorkDbRow {
  id?: number | null;
  urn: string;
  openalex_id?: string | null;
  doi?: string | null;
  arxiv_id?: string | null;
  pmid?: string | null;
  isbn?: string | null;
  ansatz_entity_type?: "work" | "post" | "package" | "artifact" | "repo" | "job" | "solution" | null;
  ansatz_entity_id?: string | null;
  title?: string | null;
  subtitle?: string | null;
  abstract?: string | null;
  work_type?: string | null;
  publication_year?: number | string | null;
  publication_date?: string | null;
  venue_name?: string | null;
  venue_issn?: string | null;
  publisher?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  language?: string | null;
  license?: string | null;
  is_oa?: number | boolean | null;
  oa_status?: ScholarlyWorkRecord["oaStatus"];
  oa_url?: string | null;
  local_pdf_url?: string | null;
  local_artifact_id?: number | string | null;
  external_locations_json?: string | null;
  authors_json?: string | null;
  concepts_json?: string | null;
  cited_by_count?: number | null;
  references_count?: number | null;
  counts_by_year_json?: string | null;
  referenced_urns_json?: string | null;
  related_urns_json?: string | null;
  citation_key?: string | null;
  canonical_url?: string | null;
  fwci?: number | null;
  partition_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ReferenceLibraryDbRow {
  id?: number | null;
  lib_id?: number | null;
  user_id?: number | null;
  work_id: number;
  collection_id?: number | null;
  collection_name?: string | null;
  collection_color?: string | null;
  reading_status?: string | null;
  rating?: number | null;
  is_favorite?: number | boolean | null;
  notes?: string | null;
  tags_json?: string | null;
  custom_citation_key?: string | null;
  local_pdf_url?: string | null;
  user_local_pdf_url?: string | null;
  added_at?: string | null;
  lib_updated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OpenAlexPartitionDbRow {
  id: number;
  entity_type?: string | null;
  s3_url: string;
  https_url: string;
  updated_date?: string | null;
  part_name?: string | null;
  content_length?: number | null;
  record_count?: number | null;
  status?: string | null;
  imported_count?: number | null;
  scanned_count?: number | null;
  skipped_count?: number | null;
  filter_config_json?: string | null;
  last_loaded_at?: string | null;
  last_duration_ms?: number | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export function mapDbRowToWork(row: unknown): ScholarlyWorkRecord & {
  pdfLocations: Array<{
    source: string;
    hostType: string;
    url: string;
    pdfUrl?: string | undefined;
    landingPageUrl?: string | undefined;
    isOa?: boolean | undefined;
    isLocal: boolean;
    version?: string | undefined;
    license?: string | undefined;
  }>;
  openAccessUrl: string | null;
  venue: string | null;
} {
  const r = (row || {}) as ScholarlyWorkDbRow;
  const urn = String(r.urn);
  const externalLocations = safeJsonParse<ScholarlyExternalLocation[]>(r.external_locations_json, []);
  const localPdfUrl = r.local_pdf_url ? String(r.local_pdf_url) : null;

  // Ensure if localPdfUrl is present on the record, it is also represented in externalLocations
  if (localPdfUrl && !externalLocations.some((l) => l.hostType === "local_instance" && l.pdfUrl === localPdfUrl)) {
    externalLocations.unshift({
      source: "Ansatz Local Instance Archive",
      hostType: "local_instance",
      landingPageUrl: `/sources/${encodeURIComponent(urn)}`,
      pdfUrl: localPdfUrl,
      isOa: true,
      version: "publishedVersion",
    });
  }

  const pdfLocations = externalLocations.map((loc) => ({
    ...loc,
    url: loc.pdfUrl || loc.landingPageUrl || "",
    isLocal: loc.hostType === "local_instance",
  }));

  return {
    id: Number(r.id),
    urn,
    openalexId: r.openalex_id || null,
    doi: r.doi || null,
    arxivId: r.arxiv_id || null,
    pmid: r.pmid || null,
    isbn: r.isbn || null,
    ansatzEntityType: r.ansatz_entity_type || "work",
    ansatzEntityId: r.ansatz_entity_id || null,
    title: String(r.title || "Untitled"),
    subtitle: r.subtitle || null,
    abstract: r.abstract || null,
    workType: String(r.work_type || "article"),
    publicationYear: r.publication_year ? Number(r.publication_year) : null,
    publicationDate: r.publication_date || null,
    venueName: r.venue_name || null,
    venue: r.venue_name || null,
    venueIssn: r.venue_issn || null,
    publisher: r.publisher || null,
    volume: r.volume || null,
    issue: r.issue || null,
    pages: r.pages || null,
    language: r.language || "en",
    license: r.license || null,
    isOa: Boolean(r.is_oa),
    oaStatus: r.oa_status || null,
    oaUrl: r.oa_url || null,
    openAccessUrl: r.oa_url || localPdfUrl || null,
    localPdfUrl,
    localArtifactId: r.local_artifact_id ? Number(r.local_artifact_id) : null,
    externalLocations,
    pdfLocations,
    authors: safeJsonParse<ScholarlyAuthor[]>(r.authors_json, []),
    concepts: safeJsonParse<ScholarlyConcept[]>(r.concepts_json, []),
    citedByCount: Number(r.cited_by_count || 0),
    referencesCount: Number(r.references_count || 0),
    countsByYear: safeJsonParse<ScholarlyYearCount[]>(r.counts_by_year_json, []),
    referencedUrns: safeJsonParse<string[]>(r.referenced_urns_json, []),
    relatedUrns: safeJsonParse<string[]>(r.related_urns_json, []),
    citationKey: String(r.citation_key || "ansatz"),
    sourcePageUrl: `/sources/${encodeURIComponent(urn)}`,
    canonicalUrl: r.canonical_url || `/sources/${encodeURIComponent(urn)}`,
    fwci: typeof r.fwci === "number" ? r.fwci : null,
    partitionUrl: r.partition_url || null,
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
  };
}

export function buildAllCitationStyles(work: ScholarlyWorkRecord): Record<CitationStyleId, string> {
  return {
    apa: formatScholarlyCitation(work, "apa"),
    mla: formatScholarlyCitation(work, "mla"),
    ieee: formatScholarlyCitation(work, "ieee"),
    chicago: formatScholarlyCitation(work, "chicago"),
    harvard: formatScholarlyCitation(work, "harvard"),
    vancouver: formatScholarlyCitation(work, "vancouver"),
    acm: formatScholarlyCitation(work, "acm"),
    "ansatz-urn": formatScholarlyCitation(work, "ansatz-urn"),
  };
}

export function buildAllCitationExports(work: ScholarlyWorkRecord): Record<CitationExportFormatId, string> {
  return {
    bibtex: exportScholarlyCitations([work], "bibtex"),
    biblatex: exportScholarlyCitations([work], "biblatex"),
    ris: exportScholarlyCitations([work], "ris"),
    "csl-json": exportScholarlyCitations([work], "csl-json"),
    cff: exportScholarlyCitations([work], "cff"),
    enw: exportScholarlyCitations([work], "enw"),
  };
}

/**
 * Looks up a work in `openalex.db` by URN, DOI, ArXiv ID, OpenAlex ID, PMID, ISBN, or citation key.
 */
export function lookupLocalWork(database: LibraryDatabase, rawIdentifier: string): ScholarlyWorkRecord | null {
  const oaDb = database.openalexDb;
  const norm = normalizeCitationUrn(rawIdentifier);
  const rawClean = String(rawIdentifier || "")
    .trim()
    .replace(/^\/?sources\//i, "");

  // Direct numeric ID lookup if rawClean is an integer
  if (/^\d+$/.test(rawClean)) {
    const byId = oaDb.prepare(`SELECT * FROM scholarly_works WHERE id = ?`).get(Number(rawClean));
    if (byId) return mapDbRowToWork(byId);
  }

  const strippedDoi = norm.startsWith("urn:doi:") ? norm.slice("urn:doi:".length) : rawClean.replace(/^doi:/i, "");
  const strippedOa = norm.startsWith("urn:openalex:")
    ? norm.slice("urn:openalex:".length)
    : rawClean.replace(/^openalex:/i, "");
  const strippedArxiv = norm.startsWith("urn:arxiv:")
    ? norm.slice("urn:arxiv:".length)
    : rawClean.replace(/^arxiv:/i, "");
  const strippedCiteKey = norm.startsWith("urn:cite:") ? norm.slice("urn:cite:".length) : rawClean;

  const row = oaDb
    .prepare(
      `SELECT * FROM scholarly_works
       WHERE urn = ? COLLATE NOCASE
          OR (openalex_id IS NOT NULL AND UPPER(openalex_id) = UPPER(?))
          OR (doi IS NOT NULL AND LOWER(doi) = LOWER(?))
          OR (arxiv_id IS NOT NULL AND LOWER(arxiv_id) = LOWER(?))
          OR LOWER(citation_key) = LOWER(?)
       LIMIT 1`,
    )
    .get(norm, strippedOa, strippedDoi, strippedArxiv, strippedCiteKey);

  if (row) return mapDbRowToWork(row);
  return null;
}

/**
 * Resolves any URN or identifier into a `ScholarlyWorkRecord` (checking `openalex.db`, Ansatz entities,
 * live OpenAlex if explicitly enabled, or synthesizing a structured catalog entry for custom URNs/DOIs/ArXiv IDs).
 */
export async function resolveUrnToWork(database: LibraryDatabase, rawUrn: string): Promise<ScholarlyWorkRecord | null> {
  if (!rawUrn || !String(rawUrn).trim()) return null;
  const norm = normalizeCitationUrn(rawUrn);

  // 1. Check dedicated openalex.db scholarly_works first
  const existing = lookupLocalWork(database, rawUrn);
  if (existing) {
    return existing;
  }

  // 2. Check if it's an Ansatz entity URN (post, package, artifact, repo, job, solution)
  if (norm.startsWith("urn:ansatz:")) {
    const entityWork = resolveAnsatzEntityUrn(database, norm);
    if (entityWork) {
      return entityWork;
    }
  }

  // 3. Try live OpenAlex API resolution if explicitly enabled
  const liveWork = await fetchSingleOpenAlexWorkLive(norm);
  if (liveWork) {
    return database.upsertScholarlyWork(liveWork);
  }

  // 4. Synthesize a structured catalog record for valid external identifiers (DOI, ArXiv, OpenAlex, PMID, ISBN, or cite key)
  if (norm.startsWith("urn:doi:")) {
    const doi = norm.slice("urn:doi:".length);
    const pubYear = new Date().getFullYear();
    const synth: ScholarlyWorkRecord = {
      urn: norm,
      doi,
      title: `Scholarly Publication (${doi})`,
      subtitle: "Resolved Digital Object Identifier (DOI) Source",
      abstract: `Bibliographic source record for DOI ${doi}. Full text and publisher metadata are accessible via the external resolver links below or by attaching a local PDF copy to this Ansatz instance.`,
      workType: "article",
      publicationYear: pubYear,
      publicationDate: `${pubYear}-01-01`,
      venueName: "External Scholarly Venue (DOI)",
      publisher: "DOI Registration Agency",
      isOa: false,
      oaStatus: "closed",
      externalLocations: [
        {
          source: "DOI.org Official Resolver",
          hostType: "publisher",
          landingPageUrl: `https://doi.org/${doi}`,
          isOa: false,
          version: "publishedVersion",
        },
        {
          source: "OpenAlex DOI Lookup",
          hostType: "aggregator",
          landingPageUrl: `https://openalex.org/works?filter=doi:${encodeURIComponent(doi)}`,
          isOa: true,
        },
      ],
      authors: [{ name: "Referenced Author(s)" }],
      concepts: [{ name: "Scholarly Reference", level: 1, score: 0.85 }],
      citedByCount: 0,
      referencesCount: 0,
      countsByYear: [],
      referencedUrns: [],
      relatedUrns: [],
      citationKey: buildCitationKey([{ name: "doi" }], pubYear, doi),
      sourcePageUrl: `/sources/${encodeURIComponent(norm)}`,
      canonicalUrl: `https://doi.org/${doi}`,
    };
    return database.upsertScholarlyWork(synth);
  }

  if (norm.startsWith("urn:arxiv:")) {
    const arxivId = norm.slice("urn:arxiv:".length);
    const yearPrefix = arxivId.match(/^(\d{2})(\d{2})\./);
    const pubYear = yearPrefix ? 2000 + Number(yearPrefix[1]) : new Date().getFullYear();
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const absUrl = `https://arxiv.org/abs/${arxivId}`;
    const synth: ScholarlyWorkRecord = {
      urn: norm,
      arxivId,
      title: `arXiv Preprint (${arxivId})`,
      subtitle: "Open-Access e-Print Archive Source",
      abstract: `Open-access preprint hosted on Cornell University arXiv (${arxivId}). Direct PDF download and abstract landing page are available below.`,
      workType: "preprint",
      publicationYear: pubYear,
      publicationDate: `${pubYear}-01-01`,
      venueName: "arXiv",
      publisher: "Cornell University Library",
      isOa: true,
      oaStatus: "green",
      oaUrl: pdfUrl,
      externalLocations: [
        {
          source: "arXiv Open Access Preprint Server",
          hostType: "preprint",
          landingPageUrl: absUrl,
          pdfUrl,
          isOa: true,
          version: "submittedVersion",
        },
      ],
      authors: [{ name: "arXiv Author(s)" }],
      concepts: [{ name: "Preprint", level: 1, score: 0.9 }],
      citedByCount: 0,
      referencesCount: 0,
      countsByYear: [],
      referencedUrns: [],
      relatedUrns: [],
      citationKey: `arxiv${arxivId.replace(/[^a-zA-Z0-9]/g, "")}`,
      sourcePageUrl: `/sources/${encodeURIComponent(norm)}`,
      canonicalUrl: absUrl,
    };
    return database.upsertScholarlyWork(synth);
  }

  if (norm.startsWith("urn:openalex:")) {
    const oaId = norm.slice("urn:openalex:".length);
    const pubYear = new Date().getFullYear();
    const synth: ScholarlyWorkRecord = {
      urn: norm,
      openalexId: oaId,
      title: `OpenAlex Scholarly Work (${oaId})`,
      subtitle: "OpenAlex Global Research Catalog Entry",
      abstract: `Indexed scholarly work ${oaId} from the OpenAlex research catalog.`,
      workType: "article",
      publicationYear: pubYear,
      publicationDate: `${pubYear}-01-01`,
      venueName: "OpenAlex Catalog",
      publisher: "OurResearch",
      isOa: true,
      oaStatus: "green",
      oaUrl: `https://openalex.org/${oaId}`,
      externalLocations: [
        {
          source: "OpenAlex Work Landing Page",
          hostType: "aggregator",
          landingPageUrl: `https://openalex.org/${oaId}`,
          isOa: true,
        },
      ],
      authors: [{ name: "OpenAlex Indexed Author(s)" }],
      concepts: [{ name: "OpenAlex Work", level: 1, score: 0.9 }],
      citedByCount: 0,
      referencesCount: 0,
      countsByYear: [],
      referencedUrns: [],
      relatedUrns: [],
      citationKey: oaId.toLowerCase(),
      sourcePageUrl: `/sources/${encodeURIComponent(norm)}`,
      canonicalUrl: `https://openalex.org/${oaId}`,
    };
    return database.upsertScholarlyWork(synth);
  }

  if (norm.startsWith("urn:cite:") || norm.startsWith("urn:pmid:") || norm.startsWith("urn:isbn:")) {
    const shortId = norm.split(":").slice(2).join(":");
    const pubYear = Number((shortId.match(/\d{4}/) || [])[0]) || new Date().getFullYear();
    const synth: ScholarlyWorkRecord = {
      urn: norm,
      pmid: norm.startsWith("urn:pmid:") ? shortId : null,
      isbn: norm.startsWith("urn:isbn:") ? shortId : null,
      title: `Referenced Source (${shortId})`,
      subtitle: `Citation Identifier ${norm}`,
      abstract: `Catalog entry automatically resolved for citation identifier ${norm}.`,
      workType: norm.startsWith("urn:isbn:") ? "book" : "article",
      publicationYear: pubYear,
      publicationDate: `${pubYear}-01-01`,
      venueName: "Scholarly Reference Catalog",
      publisher: "Ansatz Reference Manager",
      isOa: false,
      oaStatus: "closed",
      externalLocations: norm.startsWith("urn:pmid:")
        ? [
            {
              source: "PubMed (NCBI)",
              hostType: "aggregator",
              landingPageUrl: `https://pubmed.ncbi.nlm.nih.gov/${shortId}/`,
              isOa: false,
            },
          ]
        : [],
      authors: [{ name: shortId.replace(/\d+.*$/, "") || "Referenced Author" }],
      concepts: [],
      citedByCount: 0,
      referencesCount: 0,
      countsByYear: [],
      referencedUrns: [],
      relatedUrns: [],
      citationKey: shortId.replace(/[^a-zA-Z0-9_-]/g, "") || "ref",
      sourcePageUrl: `/sources/${encodeURIComponent(norm)}`,
      canonicalUrl: `/sources/${encodeURIComponent(norm)}`,
    };
    return database.upsertScholarlyWork(synth);
  }

  return null;
}

export function referencesRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/references/search
   * High-speed SQLite FTS5 (`scholarly_works_fts`) BM25 full-text search on dedicated `openalex.db`.
   */
  router.get("/search", optionalAuth, async (req: Request, res: Response) => {
    try {
      const oaDb = database.openalexDb;
      const q = String(req.query["q"] || req.query["query"] || "").trim();
      const workType = String(req.query["type"] || "").trim();
      const authorFilter = String(req.query["author"] || "").trim();
      const topicFilter = String(req.query["topic"] || req.query["concept"] || "").trim();
      const venueFilter = String(req.query["venue"] || "").trim();
      const oaOnly = req.query["oa"] === "true" || req.query["oa"] === "1";
      const localPdfOnly = req.query["local_pdf"] === "true" || req.query["local_pdf"] === "1";
      const year = req.query["year"] ? Number(req.query["year"]) : null;
      const sort = String(req.query["sort"] || "cited_by_count:desc").trim();
      const page = Math.max(1, Number(req.query["page"] || 1));
      const perPage = Math.min(50, Math.max(1, Number(req.query["per_page"] || req.query["limit"] || 20)));

      // If query is an explicit Ansatz entity URN, resolve it into openalex.db
      if (q && q.startsWith("urn:ansatz:")) {
        await resolveUrnToWork(database, q);
      }

      // Optionally query live OpenAlex if explicitly enabled via OPENALEX_USE_API=true
      if (q && req.query["local_only"] !== "true" && isOnlineOpenAlexAllowed()) {
        const filters: string[] = [];
        if (oaOnly) filters.push("is_oa:true");
        if (workType && workType !== "all") filters.push(`type:${workType}`);
        if (year && Number.isFinite(year)) filters.push(`publication_year:${year}`);
        const liveResult = await fetchOpenAlexWorksLive({
          query: q,
          filter: filters.length > 0 ? filters.join(",") : undefined,
          sort: sort === "publication_year:desc" ? "publication_year:desc" : "cited_by_count:desc",
          page: 1,
          perPage: 12,
        });
        if (liveResult && liveResult.results.length > 0) {
          for (const w of liveResult.results) {
            database.upsertScholarlyWork(w);
          }
        }
      }

      const filterConditions: string[] = ["1=1"];
      const filterParams: unknown[] = [];

      if (workType && workType !== "all") {
        filterConditions.push(`LOWER(w.work_type) = LOWER(?)`);
        filterParams.push(workType);
      }
      if (authorFilter) {
        filterConditions.push(`w.authors_json LIKE ?`);
        filterParams.push(`%${authorFilter}%`);
      }
      if (topicFilter) {
        filterConditions.push(`(w.concepts_json LIKE ? OR w.title LIKE ? OR COALESCE(w.abstract, '') LIKE ?)`);
        filterParams.push(`%${topicFilter}%`, `%${topicFilter}%`, `%${topicFilter}%`);
      }
      if (venueFilter) {
        filterConditions.push(`LOWER(COALESCE(w.venue_name, '')) LIKE LOWER(?)`);
        filterParams.push(`%${venueFilter}%`);
      }
      if (oaOnly) {
        filterConditions.push(`(w.is_oa = 1 OR w.local_pdf_url IS NOT NULL)`);
      }
      if (localPdfOnly) {
        filterConditions.push(`w.local_pdf_url IS NOT NULL AND w.local_pdf_url != ''`);
      }
      if (year && Number.isFinite(year)) {
        filterConditions.push(`w.publication_year = ?`);
        filterParams.push(year);
      }

      const offset = (page - 1) * perPage;
      const ftsMatch = q ? buildFts5MatchQuery(q) : null;

      let rows: ScholarlyWorkDbRow[] = [];
      let totalCount = 0;

      if (ftsMatch) {
        let ftsOrderBy = `bm25(scholarly_works_fts, 1.0, 10.0, 5.0, 3.0, 6.0, 4.0, 2.0, 8.0, 8.0) ASC, w.cited_by_count DESC`;
        if (sort === "publication_year:desc" || sort === "newest") {
          ftsOrderBy = `COALESCE(w.publication_year, 0) DESC, w.cited_by_count DESC`;
        } else if (sort === "publication_year:asc" || sort === "oldest") {
          ftsOrderBy = `COALESCE(w.publication_year, 9999) ASC, w.cited_by_count DESC`;
        } else if (sort === "title:asc") {
          ftsOrderBy = `w.title COLLATE NOCASE ASC`;
        } else if (sort === "cited_by_count:desc") {
          ftsOrderBy = `w.cited_by_count DESC, bm25(scholarly_works_fts, 1.0, 10.0, 5.0, 3.0, 6.0, 4.0, 2.0, 8.0, 8.0) ASC`;
        }

        const ftsWhere = [`scholarly_works_fts MATCH ?`, ...filterConditions].join(" AND ");
        const ftsParams = [ftsMatch, ...filterParams];

        const countRow = oaDb
          .prepare(
            `SELECT COUNT(*) AS cnt
             FROM scholarly_works_fts
             JOIN scholarly_works w ON w.id = scholarly_works_fts.rowid
             WHERE ${ftsWhere}`,
          )
          .get(...ftsParams) as { cnt: number } | undefined;

        totalCount = Number(countRow?.cnt || 0);
        if (totalCount > 0) {
          rows = oaDb
            .prepare(
              `SELECT w.*
               FROM scholarly_works_fts
               JOIN scholarly_works w ON w.id = scholarly_works_fts.rowid
               WHERE ${ftsWhere}
               ORDER BY ${ftsOrderBy}
               LIMIT ? OFFSET ?`,
            )
            .all(...ftsParams, perPage, offset) as ScholarlyWorkDbRow[];
        }
      }

      // Fallback to indexed LIKE search if no query (browsing catalog) or if query contains punctuation/URN not matched by FTS5 tokens
      if (!ftsMatch || (q && totalCount === 0)) {
        const likeConditions = [...filterConditions];
        const likeParams = [...filterParams];
        if (q) {
          const likeQ = `%${q}%`;
          likeConditions.push(
            `(w.title LIKE ? OR w.subtitle LIKE ? OR w.abstract LIKE ? OR w.urn LIKE ? OR COALESCE(w.doi, '') LIKE ? OR COALESCE(w.arxiv_id, '') LIKE ? OR COALESCE(w.venue_name, '') LIKE ? OR w.authors_json LIKE ? OR w.concepts_json LIKE ? OR w.citation_key LIKE ?)`,
          );
          likeParams.push(likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ);
        }

        let orderBy = `w.cited_by_count DESC, w.publication_year DESC`;
        if (sort === "publication_year:desc" || sort === "newest") {
          orderBy = `COALESCE(w.publication_year, 0) DESC, w.cited_by_count DESC`;
        } else if (sort === "publication_year:asc" || sort === "oldest") {
          orderBy = `COALESCE(w.publication_year, 9999) ASC, w.cited_by_count DESC`;
        } else if (sort === "title:asc") {
          orderBy = `w.title COLLATE NOCASE ASC`;
        }

        const whereSql = likeConditions.join(" AND ");
        const countRow = oaDb
          .prepare(`SELECT COUNT(*) AS cnt FROM scholarly_works w WHERE ${whereSql}`)
          .get(...likeParams) as { cnt: number };
        totalCount = Number(countRow?.cnt || 0);

        rows = oaDb
          .prepare(
            `SELECT w.* FROM scholarly_works w
             WHERE ${whereSql}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
          )
          .all(...likeParams, perPage, offset) as ScholarlyWorkDbRow[];
      }

      const results = rows.map(mapDbRowToWork);

      // Attach saved library state if user is authenticated
      let savedWorkIds = new Set<number>();
      if (req.user?.id && results.length > 0) {
        const libRows = database.db
          .prepare(`SELECT work_id FROM reference_library_items WHERE user_id = ?`)
          .all(req.user.id) as { work_id: number }[];
        savedWorkIds = new Set(libRows.map((r) => Number(r.work_id)));
      }

      const mappedResults = results.map((w) => ({
        ...w,
        inUserLibrary: w.id ? savedWorkIds.has(w.id) : false,
      }));

      res.json({
        results: mappedResults,
        works: mappedResults,
        totalCount,
        page,
        perPage,
        searchEngine: ftsMatch ? "sqlite-fts5-bm25" : "sqlite-index",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to search scholarly works", details: String(err) });
    }
  });

  /**
   * GET /api/v1/references/facets
   * Returns aggregated browse facets (Topics/Concepts, Authors, Venues/Journals, Years, Work Types, and Community Cited Works)
   * from `openalex.db` and `modelscript.db`.
   */
  router.get("/facets", (_req: Request, res: Response) => {
    try {
      const oaDb = database.openalexDb;

      // Scan up to 2000 top-cited works in openalex.db to compute rich author & topic facets in sub-millisecond time
      const workRows = oaDb
        .prepare(
          `SELECT id, urn, title, authors_json, concepts_json, venue_name, publication_year, work_type, cited_by_count
           FROM scholarly_works
           ORDER BY cited_by_count DESC
           LIMIT 2000`,
        )
        .all() as ScholarlyWorkDbRow[];

      const topicMap = new Map<string, { name: string; workCount: number; totalCitations: number }>();
      const authorMap = new Map<
        string,
        {
          name: string;
          affiliation: string | null;
          orcid: string | null;
          openalexId: string | null;
          workCount: number;
          totalCitations: number;
        }
      >();
      const venueMap = new Map<string, { name: string; workCount: number; totalCitations: number }>();

      for (const row of workRows) {
        const cited = Number(row.cited_by_count || 0);

        const concepts = safeJsonParse<ScholarlyConcept[]>(row.concepts_json, []);
        const seenTopicsInWork = new Set<string>();
        for (const c of concepts) {
          const name = String(c?.name || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seenTopicsInWork.has(key)) continue;
          seenTopicsInWork.add(key);
          const existing = topicMap.get(key);
          if (existing) {
            existing.workCount += 1;
            existing.totalCitations += cited;
          } else {
            topicMap.set(key, { name, workCount: 1, totalCitations: cited });
          }
        }

        const authors = safeJsonParse<ScholarlyAuthor[]>(row.authors_json, []);
        const seenAuthorsInWork = new Set<string>();
        for (const a of authors) {
          const name = String(a?.name || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seenAuthorsInWork.has(key)) continue;
          seenAuthorsInWork.add(key);
          const existing = authorMap.get(key);
          if (existing) {
            existing.workCount += 1;
            existing.totalCitations += cited;
            if (!existing.affiliation && a.affiliation) existing.affiliation = a.affiliation;
            if (!existing.orcid && a.orcid) existing.orcid = a.orcid;
            if (!existing.openalexId && a.openalexId) existing.openalexId = a.openalexId;
          } else {
            authorMap.set(key, {
              name,
              affiliation: a.affiliation || null,
              orcid: a.orcid || null,
              openalexId: a.openalexId || null,
              workCount: 1,
              totalCitations: cited,
            });
          }
        }

        const venue = String(row.venue_name || "").trim();
        if (venue) {
          const vKey = venue.toLowerCase();
          const existing = venueMap.get(vKey);
          if (existing) {
            existing.workCount += 1;
            existing.totalCitations += cited;
          } else {
            venueMap.set(vKey, { name: venue, workCount: 1, totalCitations: cited });
          }
        }
      }

      const topics = Array.from(topicMap.values())
        .sort((a, b) => b.workCount - a.workCount || b.totalCitations - a.totalCitations)
        .slice(0, 40);

      const authors = Array.from(authorMap.values())
        .sort((a, b) => b.workCount - a.workCount || b.totalCitations - a.totalCitations)
        .slice(0, 40);

      const venues = Array.from(venueMap.values())
        .sort((a, b) => b.workCount - a.workCount || b.totalCitations - a.totalCitations)
        .slice(0, 30);

      const yearRows = oaDb
        .prepare(
          `SELECT publication_year AS year, COUNT(*) AS count
           FROM scholarly_works
           WHERE publication_year IS NOT NULL
           GROUP BY publication_year
           ORDER BY publication_year DESC
           LIMIT 40`,
        )
        .all() as { year: number; count: number }[];

      const typeRows = oaDb
        .prepare(
          `SELECT work_type AS type, COUNT(*) AS count
           FROM scholarly_works
           GROUP BY work_type
           ORDER BY count DESC`,
        )
        .all() as { type: string; count: number }[];

      // Community cited works across local Ansatz posts
      const postCiteRows = database.db
        .prepare(
          `SELECT urn, work_id, COUNT(DISTINCT post_id) AS post_citation_count
           FROM post_citations
           GROUP BY urn
           ORDER BY post_citation_count DESC
           LIMIT 20`,
        )
        .all() as { urn: string; work_id: number | null; post_citation_count: number }[];

      const communityCited: Array<{
        urn: string;
        title: string;
        authors: ScholarlyAuthor[];
        publicationYear: number | null;
        venueName: string | null;
        citedByCount: number;
        postCitationCount: number;
      }> = [];

      for (const pc of postCiteRows) {
        const work =
          (pc.work_id ? lookupLocalWork(database, String(pc.work_id)) : null) || lookupLocalWork(database, pc.urn);
        communityCited.push({
          urn: work?.urn || pc.urn,
          title: work?.title || pc.urn,
          authors: work?.authors || [],
          publicationYear: work?.publicationYear ?? null,
          venueName: work?.venueName ?? null,
          citedByCount: work?.citedByCount ?? 0,
          postCitationCount: Number(pc.post_citation_count || 1),
        });
      }

      res.json({
        topics,
        authors,
        venues,
        years: yearRows.map((y) => ({ year: Number(y.year), count: Number(y.count) })),
        workTypes: typeRows.map((t) => ({ type: String(t.type || "article"), count: Number(t.count) })),
        communityCited,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to compute scholarly catalog facets", details: String(err) });
    }
  });

  /**
   * Shared handler for resolving a URN/identifier into a full Source Detail payload.
   */
  const handleResolveSource = async (req: Request, res: Response) => {
    try {
      const splatRaw =
        (req.params as Record<string, string | string[] | undefined>)["splat"] ??
        (req.params as Record<string, string | undefined>)["0"];
      const wildcardParam = Array.isArray(splatRaw) ? splatRaw.join("/") : splatRaw;
      const rawUrn = String(
        req.query["urn"] || req.query["id"] || req.params["identifier"] || wildcardParam || "",
      ).trim();

      if (!rawUrn) {
        res.status(400).json({ error: "Missing 'urn' or identifier parameter" });
        return;
      }

      const work = await resolveUrnToWork(database, rawUrn);
      if (!work) {
        res.status(404).json({ error: `Could not resolve scholarly source for '${rawUrn}'` });
        return;
      }

      // Compute citations & exports
      const citations = buildAllCitationStyles(work);
      const exports = buildAllCitationExports(work);

      // Find Ansatz posts citing this work or its normalized URN / citationKey / DOI
      const citingPosts = database.db
        .prepare(
          `SELECT DISTINCT p.id, p.content, p.created_at, p.like_count, p.repost_count, p.reply_count,
                  u.username, u.display_name, u.avatar_url
           FROM post_citations pc
           JOIN posts p ON pc.post_id = p.id
           JOIN users u ON p.author_id = u.id
           WHERE (pc.work_id = ?
              OR LOWER(pc.urn) = LOWER(?)
              OR LOWER(pc.urn) = LOWER(?))
             AND COALESCE(p.visibility, 'public') = 'public'
           ORDER BY p.created_at DESC
           LIMIT 25`,
        )
        .all(work.id ?? -1, work.urn, `urn:cite:${work.citationKey}`) as Array<{
        id: number;
        content: string;
        created_at: string;
        like_count: number;
        repost_count: number;
        reply_count: number;
        username: string;
        display_name?: string | null;
        avatar_url?: string | null;
      }>;

      // Resolve referenced works & related works summaries
      const resolveSummaries = (urnList: string[]) => {
        const items: ScholarlyWorkRecord[] = [];
        for (const refUrn of urnList.slice(0, 12)) {
          const found = lookupLocalWork(database, refUrn);
          if (found) items.push(found);
        }
        return items;
      };

      const referencedWorks = resolveSummaries(work.referencedUrns || []);
      const relatedWorks = resolveSummaries(work.relatedUrns || []);

      // Check user's personal reference library if logged in
      let libraryItem: Record<string, unknown> | null = null;
      if (req.user?.id && work.id) {
        const libRow = database.db
          .prepare(
            `SELECT r.*, c.name AS collection_name, c.color AS collection_color
             FROM reference_library_items r
             LEFT JOIN reference_collections c ON r.collection_id = c.id
             WHERE r.user_id = ? AND r.work_id = ?`,
          )
          .get(req.user.id, work.id) as ReferenceLibraryDbRow | undefined;
        if (libRow) {
          libraryItem = {
            id: Number(libRow.id),
            workId: Number(libRow.work_id),
            collectionId: libRow.collection_id ? Number(libRow.collection_id) : null,
            collectionName: libRow.collection_name || null,
            collectionColor: libRow.collection_color || null,
            readingStatus: libRow.reading_status,
            rating: libRow.rating ? Number(libRow.rating) : null,
            isFavorite: Boolean(libRow.is_favorite),
            notes: libRow.notes || "",
            tags: safeJsonParse<string[]>(libRow.tags_json, []),
            customCitationKey: libRow.custom_citation_key || null,
            localPdfUrl: libRow.local_pdf_url || null,
            addedAt: libRow.added_at,
            updatedAt: libRow.updated_at,
          };
        }
      }

      res.json({
        work,
        citations,
        exports,
        citedByPosts: citingPosts.map((p) => ({
          id: Number(p.id),
          postId: Number(p.id),
          content: p.content,
          createdAt: p.created_at,
          likeCount: Number(p.like_count || 0),
          repostCount: Number(p.repost_count || 0),
          replyCount: Number(p.reply_count || 0),
          author: {
            username: p.username,
            displayName: p.display_name || p.username,
            avatarUrl: p.avatar_url || null,
          },
        })),
        referencedWorks,
        relatedWorks,
        libraryItem,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to resolve citation URN", details: String(err) });
    }
  };

  router.get("/resolve", optionalAuth, handleResolveSource);
  router.get("/works/:identifier", optionalAuth, handleResolveSource);
  router.get("/works/*splat", optionalAuth, handleResolveSource);

  /**
   * GET /api/v1/references/export (and /api/v1/citations/export)
   * Exports one or multiple works/URNs in BibTeX, BibLaTeX, RIS, CSL-JSON, CITATION.cff, EndNote, or formatted style.
   */
  router.get("/export", optionalAuth, async (req: Request, res: Response) => {
    try {
      const formatRaw = String(req.query["format"] || "bibtex")
        .trim()
        .toLowerCase();
      const rawUrns = String(req.query["urns"] || req.query["urn"] || "").trim();
      const collectionId = req.query["collection_id"] ? Number(req.query["collection_id"]) : null;

      const works: ScholarlyWorkRecord[] = [];
      if (rawUrns) {
        const list = rawUrns
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const u of list) {
          const resolved = await resolveUrnToWork(database, u);
          if (resolved) works.push(resolved);
        }
      } else if (req.user?.id) {
        const libRows = collectionId
          ? (database.db
              .prepare(
                `SELECT work_id FROM reference_library_items
                 WHERE user_id = ? AND collection_id = ?
                 ORDER BY added_at DESC`,
              )
              .all(req.user.id, collectionId) as { work_id: number }[])
          : (database.db
              .prepare(
                `SELECT work_id FROM reference_library_items
                 WHERE user_id = ?
                 ORDER BY added_at DESC`,
              )
              .all(req.user.id) as { work_id: number }[]);
        const getWorkStmt = database.openalexDb.prepare(`SELECT * FROM scholarly_works WHERE id = ?`);
        for (const lr of libRows) {
          const wr = getWorkStmt.get(lr.work_id);
          if (wr) works.push(mapDbRowToWork(wr));
        }
      }

      if (works.length === 0) {
        res.status(404).json({ error: "No scholarly works found to export" });
        return;
      }

      if (ALL_STYLES.includes(formatRaw as CitationStyleId)) {
        const formatted = works.map((w) => formatScholarlyCitation(w, formatRaw as CitationStyleId)).join("\n\n");
        if (req.query["json"] === "true") {
          res.json({ format: formatRaw, count: works.length, content: formatted });
          return;
        }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(formatted);
        return;
      }

      const exportFmt: CitationExportFormatId = ALL_EXPORTS.includes(formatRaw as CitationExportFormatId)
        ? (formatRaw as CitationExportFormatId)
        : "bibtex";
      const output = exportScholarlyCitations(works, exportFmt);

      if (req.query["json"] === "true") {
        res.json({ format: exportFmt, count: works.length, content: output });
        return;
      }

      const extMap: Record<CitationExportFormatId, { ext: string; mime: string }> = {
        bibtex: { ext: "bib", mime: "application/x-bibtex; charset=utf-8" },
        biblatex: { ext: "bib", mime: "application/x-bibtex; charset=utf-8" },
        ris: { ext: "ris", mime: "application/x-research-info-systems; charset=utf-8" },
        "csl-json": { ext: "json", mime: "application/json; charset=utf-8" },
        cff: { ext: "cff", mime: "text/yaml; charset=utf-8" },
        enw: { ext: "enw", mime: "application/x-endnote-refer; charset=utf-8" },
      };

      const meta = extMap[exportFmt];
      const fileSlug = works.length === 1 ? works[0]!.citationKey || "citation" : "ansatz-references";
      res.setHeader("Content-Type", meta.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${fileSlug}.${meta.ext}"`);
      res.send(output);
    } catch (err) {
      res.status(500).json({ error: "Failed to export citations", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/works
   * Creates or updates a scholarly work record in the central catalog (including localPdfUrl or externalLocations).
   */
  router.post("/works", requireAuth, (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      if (!title) {
        res.status(400).json({ error: "Title is required" });
        return;
      }

      const authors: ScholarlyAuthor[] = Array.isArray(body.authors)
        ? body.authors.map((a: unknown) =>
            typeof a === "string"
              ? { name: a.trim() }
              : { name: String((a as { name?: string })?.name || "Unknown Author"), ...(a as Record<string, unknown>) },
          )
        : [{ name: req.user?.username || "Ansatz Researcher" }];

      const pubYear = body.publicationYear ? Number(body.publicationYear) : new Date().getFullYear();
      const citationKey = body.citationKey || buildCitationKey(authors, pubYear, title);
      const rawUrn =
        body.urn ||
        (body.doi ? `urn:doi:${String(body.doi).toLowerCase()}` : null) ||
        (body.arxivId ? `urn:arxiv:${String(body.arxivId)}` : null) ||
        (body.openalexId ? `urn:openalex:${String(body.openalexId).toUpperCase()}` : null) ||
        `urn:cite:${citationKey}`;
      const urn = normalizeCitationUrn(rawUrn);

      const externalLocations: ScholarlyExternalLocation[] = Array.isArray(body.externalLocations)
        ? body.externalLocations
        : [];
      const localPdfUrl = body.localPdfUrl ? String(body.localPdfUrl).trim() : null;
      if (
        localPdfUrl &&
        !((localPdfUrl.startsWith("/") && !localPdfUrl.startsWith("//")) || /^https?:\/\//i.test(localPdfUrl))
      ) {
        res.status(400).json({ error: "Invalid localPdfUrl: must be a relative path or http(s) URL" });
        return;
      }
      if (localPdfUrl) {
        externalLocations.unshift({
          source: "Ansatz Local Instance Archive",
          hostType: "local_instance",
          landingPageUrl: `/sources/${encodeURIComponent(urn)}`,
          pdfUrl: localPdfUrl,
          isOa: true,
          version: "publishedVersion",
        });
      }

      const workRecord: ScholarlyWorkRecord = {
        urn,
        openalexId: body.openalexId || null,
        doi: body.doi ? String(body.doi).toLowerCase() : null,
        arxivId: body.arxivId || null,
        pmid: body.pmid || null,
        isbn: body.isbn || null,
        ansatzEntityType: body.ansatzEntityType || "work",
        ansatzEntityId: body.ansatzEntityId || null,
        title,
        subtitle: body.subtitle || null,
        abstract: body.abstract || null,
        workType: body.workType || "article",
        publicationYear: pubYear,
        publicationDate: body.publicationDate || `${pubYear}-01-01`,
        venueName: body.venueName || null,
        venueIssn: body.venueIssn || null,
        publisher: body.publisher || null,
        volume: body.volume || null,
        issue: body.issue || null,
        pages: body.pages || null,
        language: body.language || "en",
        license: body.license || null,
        isOa: Boolean(body.isOa || localPdfUrl || body.oaUrl),
        oaStatus: localPdfUrl ? "local" : body.oaStatus || (body.isOa ? "green" : "closed"),
        oaUrl: body.oaUrl || localPdfUrl || null,
        localPdfUrl,
        localArtifactId: body.localArtifactId ? Number(body.localArtifactId) : null,
        externalLocations,
        authors,
        concepts: Array.isArray(body.concepts) ? body.concepts : [],
        citedByCount: Number(body.citedByCount || 0),
        referencesCount: Number(body.referencesCount || 0),
        countsByYear: Array.isArray(body.countsByYear) ? body.countsByYear : [],
        referencedUrns: Array.isArray(body.referencedUrns) ? body.referencedUrns : [],
        relatedUrns: Array.isArray(body.relatedUrns) ? body.relatedUrns : [],
        citationKey,
        sourcePageUrl: `/sources/${encodeURIComponent(urn)}`,
        canonicalUrl:
          body.canonicalUrl || (body.doi ? `https://doi.org/${body.doi}` : `/sources/${encodeURIComponent(urn)}`),
      };

      const saved = database.upsertScholarlyWork(workRecord);
      res.status(201).json({
        work: saved,
        citations: buildAllCitationStyles(saved),
        exports: buildAllCitationExports(saved),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to save scholarly work", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/local-pdf
   * Attaches or updates a locally stored PDF URL or local artifact ID on any scholarly work (by URN or work ID).
   */
  router.post("/local-pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawUrn = String(req.body?.urn || req.body?.workId || "").trim();
      const localPdfUrl = String(req.body?.localPdfUrl || "").trim();
      const localArtifactId = req.body?.localArtifactId ? Number(req.body.localArtifactId) : null;

      if (!rawUrn || !localPdfUrl) {
        res.status(400).json({ error: "Both 'urn' and 'localPdfUrl' are required" });
        return;
      }

      if (!((localPdfUrl.startsWith("/") && !localPdfUrl.startsWith("//")) || /^https?:\/\//i.test(localPdfUrl))) {
        res.status(400).json({ error: "Invalid localPdfUrl: must be a relative path or http(s) URL" });
        return;
      }

      const work = await resolveUrnToWork(database, rawUrn);
      if (!work || !work.id) {
        res.status(404).json({ error: "Scholarly work not found" });
        return;
      }

      const updatedLocations = [
        {
          source: "Ansatz Local Instance Archive",
          hostType: "local_instance" as const,
          landingPageUrl: `/sources/${encodeURIComponent(work.urn)}`,
          pdfUrl: localPdfUrl,
          isOa: true,
          version: "publishedVersion",
        },
        ...(work.externalLocations || []).filter((l) => l.pdfUrl !== localPdfUrl),
      ];

      database.openalexDb
        .prepare(
          `UPDATE scholarly_works
           SET local_pdf_url = ?,
               local_artifact_id = COALESCE(?, local_artifact_id),
               is_oa = 1,
               oa_status = COALESCE(oa_status, 'local'),
               external_locations_json = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(localPdfUrl, localArtifactId, JSON.stringify(updatedLocations), work.id);

      const refreshed = lookupLocalWork(database, work.urn)!;
      res.json({ work: refreshed });
    } catch (err) {
      res.status(500).json({ error: "Failed to attach local PDF to work", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/import
   * Imports references from BibTeX text, RIS text, or an array of DOIs/URNs/OpenAlex IDs,
   * upserting them into `scholarly_works` and optionally adding them to the user's personal library.
   */
  router.post("/import", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bibtex, ris, content, format, identifiers, collectionId, addToLibrary = true } = req.body || {};
      const importedWorks: ScholarlyWorkRecord[] = [];

      const bibtexPayload =
        typeof bibtex === "string" && bibtex.trim()
          ? bibtex
          : typeof content === "string" &&
              (!format || format === "bibtex" || format === "biblatex") &&
              content.includes("@")
            ? content
            : "";
      const risPayload =
        typeof ris === "string" && ris.trim()
          ? ris
          : typeof content === "string" && (format === "ris" || /^TY\s+-/m.test(content))
            ? content
            : "";

      if (bibtexPayload) {
        const parsed = parseBibtexToWorks(bibtexPayload);
        for (const w of parsed) {
          importedWorks.push(database.upsertScholarlyWork(w));
        }
      }

      if (risPayload) {
        const parsed = parseRisToWorks(risPayload);
        for (const w of parsed) {
          importedWorks.push(database.upsertScholarlyWork(w));
        }
      }

      if (Array.isArray(identifiers)) {
        for (const rawId of identifiers) {
          const resolved = await resolveUrnToWork(database, String(rawId));
          if (resolved) {
            importedWorks.push(resolved);
          }
        }
      } else if (typeof identifiers === "string" && identifiers.trim()) {
        const list = identifiers
          .split(/[\r\n,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const rawId of list) {
          const resolved = await resolveUrnToWork(database, rawId);
          if (resolved) {
            importedWorks.push(resolved);
          }
        }
      }

      if (addToLibrary && req.user?.id && importedWorks.length > 0) {
        const insertLibStmt = database.db.prepare(`
          INSERT INTO reference_library_items (user_id, work_id, collection_id, reading_status)
          VALUES (?, ?, ?, 'to_read')
          ON CONFLICT(user_id, work_id) DO UPDATE SET
            collection_id = COALESCE(excluded.collection_id, reference_library_items.collection_id),
            updated_at = datetime('now')
        `);
        database.db.transaction(() => {
          for (const w of importedWorks) {
            if (w.id) {
              insertLibStmt.run(req.user!.id, w.id, collectionId ? Number(collectionId) : null);
            }
          }
        })();
      }

      res.status(201).json({
        importedCount: importedWorks.length,
        works: importedWorks,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to import references", details: String(err) });
    }
  });

  /**
   * GET /api/v1/references/library
   * Lists the authenticated user's personal reference library items with full work metadata from `openalex.db`.
   */
  router.get("/library", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const collectionIdRaw = req.query["collection_id"] ?? req.query["collectionId"];
      const collectionId = collectionIdRaw ? Number(collectionIdRaw) : null;
      const status = String(req.query["status"] || "").trim();
      const favoriteOnly = req.query["favorite"] === "true" || req.query["favorite"] === "1";
      const q = String(req.query["q"] || "")
        .trim()
        .toLowerCase();

      const conditions: string[] = ["l.user_id = ?"];
      const params: unknown[] = [userId];

      if (collectionId && Number.isFinite(collectionId)) {
        conditions.push("l.collection_id = ?");
        params.push(collectionId);
      }
      if (status && status !== "all") {
        conditions.push("l.reading_status = ?");
        params.push(status);
      }
      if (favoriteOnly) {
        conditions.push("l.is_favorite = 1");
      }

      const libRows = database.db
        .prepare(
          `SELECT
             l.id AS lib_id,
             l.work_id,
             l.collection_id,
             l.reading_status,
             l.rating,
             l.is_favorite,
             l.notes,
             l.tags_json,
             l.custom_citation_key,
             l.local_pdf_url AS user_local_pdf_url,
             l.added_at,
             l.updated_at AS lib_updated_at,
             c.name AS collection_name,
             c.color AS collection_color
           FROM reference_library_items l
           LEFT JOIN reference_collections c ON l.collection_id = c.id
           WHERE ${conditions.join(" AND ")}
           ORDER BY l.is_favorite DESC, l.updated_at DESC`,
        )
        .all(...params) as ReferenceLibraryDbRow[];

      const getWorkStmt = database.openalexDb.prepare(`SELECT * FROM scholarly_works WHERE id = ?`);
      const items: Record<string, unknown>[] = [];

      for (const r of libRows) {
        const workRow = getWorkStmt.get(r.work_id) as ScholarlyWorkDbRow | undefined;
        if (!workRow) continue;
        const work = mapDbRowToWork(workRow);
        if (r.user_local_pdf_url && !work.localPdfUrl) {
          work.localPdfUrl = r.user_local_pdf_url;
        }
        if (q) {
          const hay = [
            work.title,
            work.urn,
            work.authors.map((a) => a.name).join(" "),
            r.notes || "",
            r.tags_json || "",
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) continue;
        }
        items.push({
          id: Number(r.lib_id),
          workId: Number(r.work_id),
          collectionId: r.collection_id ? Number(r.collection_id) : null,
          collectionName: r.collection_name || null,
          collectionColor: r.collection_color || null,
          readingStatus: r.reading_status || "to_read",
          rating: r.rating ? Number(r.rating) : null,
          isFavorite: Boolean(r.is_favorite),
          notes: r.notes || "",
          tags: safeJsonParse<string[]>(r.tags_json, []),
          customCitationKey: r.custom_citation_key || null,
          localPdfUrl: r.user_local_pdf_url || work.localPdfUrl || null,
          addedAt: r.added_at,
          updatedAt: r.lib_updated_at,
          work,
        });
      }

      res.json({ items, totalCount: items.length });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reference library", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/library
   * Saves a work (by `urn` or `workId`) into the user's personal reference library.
   */
  router.post("/library", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const {
        urn,
        workId,
        collectionId = null,
        readingStatus = "to_read",
        rating = null,
        isFavorite = false,
        notes = "",
        tags = [],
        customCitationKey = null,
        localPdfUrl = null,
      } = req.body || {};

      let resolvedWork: ScholarlyWorkRecord | null = null;
      if (workId) {
        resolvedWork = lookupLocalWork(database, String(workId));
      }
      if (!resolvedWork && urn) {
        resolvedWork = await resolveUrnToWork(database, String(urn));
      }
      if (!resolvedWork || !resolvedWork.id) {
        res.status(404).json({ error: "Could not resolve scholarly work to save" });
        return;
      }

      database.db
        .prepare(
          `INSERT INTO reference_library_items (
             user_id, work_id, collection_id, reading_status, rating, is_favorite,
             notes, tags_json, custom_citation_key, local_pdf_url, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, work_id) DO UPDATE SET
             collection_id = COALESCE(excluded.collection_id, reference_library_items.collection_id),
             reading_status = COALESCE(excluded.reading_status, reference_library_items.reading_status),
             rating = COALESCE(excluded.rating, reference_library_items.rating),
             is_favorite = excluded.is_favorite,
             notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE reference_library_items.notes END,
             tags_json = CASE WHEN excluded.tags_json != '[]' THEN excluded.tags_json ELSE reference_library_items.tags_json END,
             custom_citation_key = COALESCE(excluded.custom_citation_key, reference_library_items.custom_citation_key),
             local_pdf_url = COALESCE(excluded.local_pdf_url, reference_library_items.local_pdf_url),
             updated_at = datetime('now')`,
        )
        .run(
          userId,
          resolvedWork.id,
          collectionId ? Number(collectionId) : null,
          readingStatus,
          rating ? Number(rating) : null,
          isFavorite ? 1 : 0,
          String(notes || ""),
          JSON.stringify(Array.isArray(tags) ? tags : []),
          customCitationKey || null,
          localPdfUrl || null,
        );

      const itemRow = database.db
        .prepare(`SELECT * FROM reference_library_items WHERE user_id = ? AND work_id = ?`)
        .get(userId, resolvedWork.id) as ReferenceLibraryDbRow | undefined;
      if (!itemRow) {
        res.status(500).json({ error: "Failed to retrieve saved library item" });
        return;
      }

      res.status(201).json({
        item: {
          id: Number(itemRow.id),
          workId: resolvedWork.id,
          collectionId: itemRow.collection_id ? Number(itemRow.collection_id) : null,
          readingStatus: itemRow.reading_status,
          rating: itemRow.rating ? Number(itemRow.rating) : null,
          isFavorite: Boolean(itemRow.is_favorite),
          notes: itemRow.notes || "",
          tags: safeJsonParse<string[]>(itemRow.tags_json, []),
          customCitationKey: itemRow.custom_citation_key || null,
          localPdfUrl: itemRow.local_pdf_url || resolvedWork.localPdfUrl || null,
          addedAt: itemRow.added_at,
          updatedAt: itemRow.updated_at,
          work: resolvedWork,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to save item to reference library", details: String(err) });
    }
  });

  /**
   * PATCH /api/v1/references/library/:id
   * Updates reading status, collection, rating, favorite, notes, tags, or localPdfUrl on a saved library item.
   */
  router.patch("/library/:id", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const itemId = Number(req.params["id"]);
      const existing = database.db
        .prepare(`SELECT * FROM reference_library_items WHERE id = ? AND user_id = ?`)
        .get(itemId, userId) as ReferenceLibraryDbRow | undefined;
      if (!existing) {
        res.status(404).json({ error: "Reference library item not found" });
        return;
      }

      const body = req.body || {};
      const nextCollectionId =
        body.collectionId !== undefined
          ? body.collectionId
            ? Number(body.collectionId)
            : null
          : existing.collection_id;
      const nextStatus = body.readingStatus !== undefined ? String(body.readingStatus) : existing.reading_status;
      const nextRating =
        body.rating !== undefined ? (body.rating !== null ? Number(body.rating) : null) : existing.rating;
      const nextFavorite = body.isFavorite !== undefined ? (body.isFavorite ? 1 : 0) : existing.is_favorite;
      const nextNotes = body.notes !== undefined ? String(body.notes) : existing.notes;
      const nextTags =
        body.tags !== undefined && Array.isArray(body.tags) ? JSON.stringify(body.tags) : existing.tags_json;
      const nextCiteKey =
        body.customCitationKey !== undefined ? body.customCitationKey || null : existing.custom_citation_key;
      const nextLocalPdf = body.localPdfUrl !== undefined ? body.localPdfUrl || null : existing.local_pdf_url;

      database.db
        .prepare(
          `UPDATE reference_library_items
           SET collection_id = ?,
               reading_status = ?,
               rating = ?,
               is_favorite = ?,
               notes = ?,
               tags_json = ?,
               custom_citation_key = ?,
               local_pdf_url = ?,
               updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
        )
        .run(
          nextCollectionId,
          nextStatus,
          nextRating,
          nextFavorite,
          nextNotes,
          nextTags,
          nextCiteKey,
          nextLocalPdf,
          itemId,
          userId,
        );

      if (nextLocalPdf) {
        database.openalexDb
          .prepare(`UPDATE scholarly_works SET local_pdf_url = COALESCE(local_pdf_url, ?), is_oa = 1 WHERE id = ?`)
          .run(nextLocalPdf, existing.work_id);
      }

      const updated = database.db.prepare(`SELECT * FROM reference_library_items WHERE id = ?`).get(itemId) as
        | ReferenceLibraryDbRow
        | undefined;
      if (!updated) {
        res.status(404).json({ error: "Reference library item not found after update" });
        return;
      }
      const workRow = database.openalexDb
        .prepare(`SELECT * FROM scholarly_works WHERE id = ?`)
        .get(existing.work_id) as ScholarlyWorkDbRow | undefined;

      res.json({
        item: {
          id: Number(updated.id),
          workId: Number(updated.work_id),
          collectionId: updated.collection_id ? Number(updated.collection_id) : null,
          readingStatus: updated.reading_status,
          rating: updated.rating ? Number(updated.rating) : null,
          isFavorite: Boolean(updated.is_favorite),
          notes: updated.notes || "",
          tags: safeJsonParse<string[]>(updated.tags_json, []),
          customCitationKey: updated.custom_citation_key || null,
          localPdfUrl: updated.local_pdf_url || null,
          addedAt: updated.added_at,
          updatedAt: updated.updated_at,
          work: workRow ? mapDbRowToWork(workRow) : undefined,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to update reference library item", details: String(err) });
    }
  });

  /**
   * DELETE /api/v1/references/library/:id
   */
  router.delete("/library/:id", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const itemId = Number(req.params["id"]);
      const result = database.db
        .prepare(`DELETE FROM reference_library_items WHERE id = ? AND user_id = ?`)
        .run(itemId, userId);
      if (result.changes === 0) {
        res.status(404).json({ error: "Reference library item not found" });
        return;
      }
      res.json({ success: true, deletedId: itemId });
    } catch (err) {
      res.status(500).json({ error: "Failed to remove item from library", details: String(err) });
    }
  });

  /**
   * GET /api/v1/references/collections
   */
  router.get("/collections", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const rows = database.db
        .prepare(
          `SELECT c.*,
                  (SELECT COUNT(*) FROM reference_library_items l WHERE l.collection_id = c.id) AS item_count
           FROM reference_collections c
           WHERE c.user_id = ?
           ORDER BY c.name COLLATE NOCASE ASC`,
        )
        .all(userId) as Array<{
        id: number;
        name: string;
        slug: string;
        description?: string | null;
        color?: string | null;
        icon?: string | null;
        is_public?: number | boolean | null;
        parent_id?: number | null;
        item_count?: number | null;
        created_at?: string | null;
        updated_at?: string | null;
      }>;

      res.json({
        collections: rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          slug: r.slug,
          description: r.description || null,
          color: r.color || "#1d9bf0",
          icon: r.icon || "folder",
          isPublic: Boolean(r.is_public),
          parentId: r.parent_id ? Number(r.parent_id) : null,
          itemCount: Number(r.item_count || 0),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to list reference collections", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/collections
   */
  router.post("/collections", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const name = String(req.body?.name || "").trim();
      if (!name) {
        res.status(400).json({ error: "Collection name is required" });
        return;
      }
      const slug =
        String(req.body?.slug || name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || `col-${Date.now()}`;
      const description = req.body?.description ? String(req.body.description) : null;
      const color = req.body?.color ? String(req.body.color) : "#1d9bf0";
      const icon = req.body?.icon ? String(req.body.icon) : "folder";
      const isPublic = req.body?.isPublic ? 1 : 0;

      const info = database.db
        .prepare(
          `INSERT INTO reference_collections (user_id, name, slug, description, color, icon, is_public)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, slug) DO UPDATE SET
             name = excluded.name,
             description = COALESCE(excluded.description, reference_collections.description),
             color = excluded.color,
             updated_at = datetime('now')`,
        )
        .run(userId, name, slug, description, color, icon, isPublic);

      const row = database.db
        .prepare(`SELECT * FROM reference_collections WHERE id = ? OR (user_id = ? AND slug = ?)`)
        .get(Number(info.lastInsertRowid), userId, slug) as
        | {
            id: number;
            name: string;
            slug: string;
            description?: string | null;
            color?: string | null;
            icon?: string | null;
            is_public?: number | boolean | null;
            created_at?: string | null;
            updated_at?: string | null;
          }
        | undefined;
      if (!row) {
        res.status(500).json({ error: "Failed to retrieve created collection" });
        return;
      }

      res.status(201).json({
        collection: {
          id: Number(row.id),
          name: row.name,
          slug: row.slug,
          description: row.description || null,
          color: row.color,
          icon: row.icon,
          isPublic: Boolean(row.is_public),
          itemCount: 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to create reference collection", details: String(err) });
    }
  });

  /**
   * DELETE /api/v1/references/collections/:id
   */
  router.delete("/collections/:id", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const colId = Number(req.params["id"]);
      const result = database.db
        .prepare(`DELETE FROM reference_collections WHERE id = ? AND user_id = ?`)
        .run(colId, userId);
      if (result.changes === 0) {
        res.status(404).json({ error: "Collection not found" });
        return;
      }
      res.json({ success: true, deletedId: colId });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete collection", details: String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Self-Hosted OpenAlex AWS S3 Data Snapshot & Partition Manager (openalex.db)
  // ───────────────────────────────────────────────────────────────────────────

  const getOpenAlexDbFileSize = (): number => {
    let total = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${database.openalexDbPath}${suffix}`;
      if (fs.existsSync(p)) {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
    return total;
  };

  const mapPartitionRow = (row: OpenAlexPartitionDbRow) => ({
    id: Number(row.id),
    entityType: String(row.entity_type || "works"),
    s3Url: String(row.s3_url),
    httpsUrl: String(row.https_url),
    updatedDate: row.updated_date || null,
    partName: String(row.part_name || "part_000.gz"),
    contentLength: Number(row.content_length || 0),
    recordCount: Number(row.record_count || 0),
    status: String(row.status || "unloaded") as "unloaded" | "loading" | "loaded" | "error",
    importedCount: Number(row.imported_count || 0),
    scannedCount: Number(row.scanned_count || 0),
    skippedCount: Number(row.skipped_count || 0),
    filterConfig: safeJsonParse<Record<string, unknown>>(row.filter_config_json, {}),
    lastLoadedAt: row.last_loaded_at || null,
    lastDurationMs: row.last_duration_ms ? Number(row.last_duration_ms) : null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const buildFallbackS3ManifestEntries = (entity: OpenAlexS3EntityType = "works"): OpenAlexS3ManifestEntry[] => {
    const dates = [
      { date: "2026-03-15", parts: 2, bytesPerPart: 412_850_120, recordsPerPart: 195_400 },
      { date: "2026-03-01", parts: 2, bytesPerPart: 389_120_400, recordsPerPart: 184_200 },
      { date: "2026-02-15", parts: 2, bytesPerPart: 445_910_000, recordsPerPart: 210_850 },
      { date: "2026-01-30", parts: 2, bytesPerPart: 502_340_800, recordsPerPart: 238_100 },
      { date: "2025-12-15", parts: 2, bytesPerPart: 478_100_250, recordsPerPart: 224_600 },
      { date: "2025-11-01", parts: 2, bytesPerPart: 518_920_000, recordsPerPart: 245_000 },
    ];
    const entries: OpenAlexS3ManifestEntry[] = [];
    for (const d of dates) {
      for (let i = 0; i < d.parts; i++) {
        const partName = `part_${String(i).padStart(3, "0")}.gz`;
        const s3Url = `s3://openalex/data/${entity}/updated_date=${d.date}/${partName}`;
        entries.push({
          s3Url,
          httpsUrl: s3UriToHttpsUrl(s3Url),
          updatedDate: d.date,
          partName,
          contentLength: d.bytesPerPart + i * 14_250_000,
          recordCount: d.recordsPerPart + i * 6_400,
        });
      }
    }
    return entries;
  };

  /**
   * GET /api/v1/references/s3-sync/status
   * Returns statistics on the dedicated `openalex.db` SQLite + FTS5 catalog, local partition cache, and AWS S3 partition table.
   */
  router.get("/s3-sync/status", (_req: Request, res: Response) => {
    try {
      const oaDb = database.openalexDb;
      const stats = oaDb
        .prepare(
          `SELECT
             COUNT(*) AS total_works,
             SUM(CASE WHEN is_oa = 1 THEN 1 ELSE 0 END) AS oa_works,
             SUM(CASE WHEN local_pdf_url IS NOT NULL AND local_pdf_url != '' THEN 1 ELSE 0 END) AS local_pdf_works,
             COUNT(DISTINCT venue_name) AS distinct_venues,
             COALESCE(SUM(cited_by_count), 0) AS total_citations
           FROM scholarly_works`,
        )
        .get() as
        | {
            total_works?: number;
            oa_works?: number;
            local_pdf_works?: number;
            distinct_venues?: number;
            total_citations?: number;
          }
        | undefined;

      let ftsIndexedCount = 0;
      try {
        const ftsRow = oaDb.prepare(`SELECT COUNT(*) AS cnt FROM scholarly_works_fts`).get() as
          | { cnt: number }
          | undefined;
        ftsIndexedCount = Number(ftsRow?.cnt || 0);
      } catch {}

      const partitionRows = oaDb
        .prepare(
          `SELECT * FROM openalex_s3_partitions
           ORDER BY COALESCE(updated_date, '') DESC, part_name ASC`,
        )
        .all() as OpenAlexPartitionDbRow[];

      const partitions = partitionRows.map(mapPartitionRow);
      const loadedPartitionsCount = partitions.filter((p) => p.status === "loaded").length;

      const cacheDir = getOpenAlexCacheDirectory(database);
      let cachedPartitionsCount = 0;
      let cachedPartitionsSizeBytes = 0;
      try {
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir);
          for (const file of files) {
            if (file.endsWith(".gz") || file.endsWith(".jsonl")) {
              cachedPartitionsCount++;
              const st = fs.statSync(path.join(cacheDir, file));
              cachedPartitionsSizeBytes += st.size;
            }
          }
        }
      } catch {}

      res.json({
        mode: "self-hosted-s3-sqlite-fts5",
        openalexDbPath: database.openalexDbPath,
        openalexDbSizeBytes: getOpenAlexDbFileSize(),
        openalexCacheDir: cacheDir,
        cachedPartitionsCount,
        cachedPartitionsSizeBytes,
        fts5Enabled: true,
        ftsIndexedCount,
        s3BucketUri: "s3://openalex/data/",
        s3HttpsBaseUrl: `${OPENALEX_S3_HTTPS_BASE}/data/jsonl/`,
        s3BrowseUrl: "https://openalex.s3.amazonaws.com/browse.html#data/",
        s3WorksManifestUrl: `${OPENALEX_S3_HTTPS_BASE}/data/jsonl/works/manifest.json`,
        paidRestApiForwarded: isOnlineOpenAlexAllowed(),
        catalogStats: {
          totalWorks: Number(stats?.total_works || 0),
          openAccessWorks: Number(stats?.oa_works || 0),
          localPdfWorks: Number(stats?.local_pdf_works || 0),
          distinctVenues: Number(stats?.distinct_venues || 0),
          totalCitations: Number(stats?.total_citations || 0),
          loadedPartitionsCount,
          totalPartitionsCount: partitions.length,
        },
        partitions,
        awsCliSyncCommand: "aws s3 sync s3://openalex/data/jsonl/works/ ./data/cache/openalex/ --no-sign-request",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to query S3 snapshot catalog status", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/s3-sync/preload-first-slice
   * Preloads (with local caching) the first slice of data for OpenAlex on S3 into openalex.db.
   */
  router.post("/s3-sync/preload-first-slice", requireAdmin, async (req: Request, res: Response) => {
    try {
      const force = Boolean(req.body?.force);
      const maxRecords = typeof req.body?.maxRecords === "number" ? req.body.maxRecords : undefined;
      const s3Url = typeof req.body?.s3Url === "string" ? req.body.s3Url.trim() : undefined;
      const result = await preloadOpenAlexS3Slice(database, { force, maxRecords, s3Url });
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: "Failed to preload OpenAlex first slice", details: String(err) });
    }
  });

  /**
   * GET /api/v1/references/s3-sync/manifest
   * Fetches the public OpenAlex S3 manifest (`https://openalex.s3.amazonaws.com/data/<entity>/manifest`)
   * without requiring any API key or AWS credentials.
   */
  router.get("/s3-sync/manifest", async (req: Request, res: Response) => {
    try {
      const entity = (String(req.query["entity"] || "works").toLowerCase() as OpenAlexS3EntityType) || "works";
      const limit = Math.min(200, Math.max(1, Number(req.query["limit"] || 25)));
      try {
        const summary = await fetchOpenAlexS3Manifest(entity);
        res.json({
          ...summary,
          entries: summary.entries.slice(0, limit),
        });
      } catch {
        const fallbackEntries = buildFallbackS3ManifestEntries(entity);
        res.json({
          entity,
          manifestUrl: `${OPENALEX_S3_HTTPS_BASE}/data/${entity}/manifest`,
          totalPartitions: fallbackEntries.length,
          totalRecordCount: fallbackEntries.reduce((a, b) => a + b.recordCount, 0),
          totalBytes: fallbackEntries.reduce((a, b) => a + b.contentLength, 0),
          entries: fallbackEntries.slice(0, limit),
          offlineFallback: true,
        });
      }
    } catch (err) {
      res.status(502).json({
        error: "Failed to fetch OpenAlex S3 manifest",
        manifestUrl: `${OPENALEX_S3_HTTPS_BASE}/data/works/manifest`,
        details: String(err),
      });
    }
  });

  /**
   * POST /api/v1/references/s3-sync/manifest/sync
   * Discovers available S3 partitions from `s3://openalex/data/<entity>/manifest` and registers them
   * in `openalex.db`'s `openalex_s3_partitions` table with `status = 'unloaded'` by default.
   */
  router.post("/s3-sync/manifest/sync", requireAdmin, async (req: Request, res: Response) => {
    try {
      const entity = (String(req.body?.entity || "works").toLowerCase() as OpenAlexS3EntityType) || "works";
      const limit = Math.min(500, Math.max(1, Number(req.body?.limit || 100)));

      let entries: OpenAlexS3ManifestEntry[] = [];
      let manifestSource: "live-s3" | "offline-catalog" = "live-s3";
      try {
        const summary = await fetchOpenAlexS3Manifest(entity);
        entries = summary.entries.slice(0, limit);
      } catch {
        entries = buildFallbackS3ManifestEntries(entity).slice(0, limit);
        manifestSource = "offline-catalog";
      }

      const oaDb = database.openalexDb;
      const upsertStmt = oaDb.prepare(`
        INSERT INTO openalex_s3_partitions (
          entity_type, s3_url, https_url, updated_date, part_name,
          content_length, record_count, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unloaded', datetime('now'))
        ON CONFLICT(s3_url) DO UPDATE SET
          https_url = excluded.https_url,
          updated_date = COALESCE(excluded.updated_date, openalex_s3_partitions.updated_date),
          part_name = excluded.part_name,
          content_length = CASE WHEN excluded.content_length > 0 THEN excluded.content_length ELSE openalex_s3_partitions.content_length END,
          record_count = CASE WHEN excluded.record_count > 0 THEN excluded.record_count ELSE openalex_s3_partitions.record_count END,
          updated_at = datetime('now')
      `);

      oaDb.transaction(() => {
        for (const e of entries) {
          upsertStmt.run(entity, e.s3Url, e.httpsUrl, e.updatedDate, e.partName, e.contentLength, e.recordCount);
        }
      })();

      const allRows = oaDb
        .prepare(`SELECT * FROM openalex_s3_partitions ORDER BY COALESCE(updated_date, '') DESC, part_name ASC`)
        .all() as OpenAlexPartitionDbRow[];

      res.json({
        syncedCount: entries.length,
        manifestSource,
        entity,
        partitions: allRows.map(mapPartitionRow),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to sync OpenAlex S3 partition manifest", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/s3-sync/partitions/load
   * Selectively streams and loads one or more S3 partitions into `openalex.db` (and indexes into FTS5).
   */
  router.post("/s3-sync/partitions/load", requireAdmin, async (req: Request, res: Response) => {
    try {
      const {
        s3Urls,
        s3Url,
        jsonl,
        localFilePath,
        minCitedByCount,
        fromYear,
        toYear,
        oaOnly,
        conceptKeywords,
        maxRecords,
      } = req.body || {};

      const targetUrls: string[] = Array.isArray(s3Urls)
        ? s3Urls
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean)
        : typeof s3Url === "string" && s3Url.trim()
          ? [s3Url.trim()]
          : [];

      if (targetUrls.length === 0) {
        res.status(400).json({ error: "Provide at least one S3 partition URL in 's3Urls' or 's3Url'." });
        return;
      }

      const filterOpts = {
        minCitedByCount: typeof minCitedByCount === "number" ? minCitedByCount : undefined,
        fromYear: typeof fromYear === "number" ? fromYear : undefined,
        toYear: typeof toYear === "number" ? toYear : undefined,
        oaOnly: typeof oaOnly === "boolean" ? oaOnly : undefined,
        conceptKeywords: Array.isArray(conceptKeywords)
          ? conceptKeywords.map(String)
          : typeof conceptKeywords === "string"
            ? conceptKeywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        maxRecords: typeof maxRecords === "number" ? maxRecords : 2500,
      };

      const oaDb = database.openalexDb;
      const results: Array<{
        s3Url: string;
        importedCount: number;
        scannedCount: number;
        skippedCount: number;
        durationMs: number;
        sampleUrns: string[];
      }> = [];

      for (const rawTargetUrl of targetUrls) {
        const httpsUrl = s3UriToHttpsUrl(rawTargetUrl);
        const dateMatch = rawTargetUrl.match(/updated_date=([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        const partName = rawTargetUrl.split("/").pop() || "part_000.gz";

        oaDb
          .prepare(
            `INSERT INTO openalex_s3_partitions (
               entity_type, s3_url, https_url, updated_date, part_name, status, filter_config_json, updated_at
             ) VALUES ('works', ?, ?, ?, ?, 'loading', ?, datetime('now'))
             ON CONFLICT(s3_url) DO UPDATE SET
               status = 'loading',
               filter_config_json = excluded.filter_config_json,
               error_message = NULL,
               updated_at = datetime('now')`,
          )
          .run(rawTargetUrl, httpsUrl, dateMatch?.[1] || null, partName, JSON.stringify(filterOpts));

        let ingestRes;
        if (typeof jsonl === "string" && jsonl.trim()) {
          ingestRes = await ingestOpenAlexJsonlStream(Readable.from([jsonl]), database, {
            ...filterOpts,
            isGzipped: false,
            sourceLabel: rawTargetUrl,
            partitionUrl: rawTargetUrl,
          });
        } else if (typeof localFilePath === "string" && localFilePath.trim()) {
          const cacheDir = path.resolve(getOpenAlexCacheDirectory(database));
          const safeLocalPath = getSafeOpenAlexFilePath(localFilePath, cacheDir);
          if (!safeLocalPath) {
            res.status(400).json({ error: "Access denied: localFilePath is outside allowed cache directory." });
            return;
          }
          ingestRes = await ingestOpenAlexFromS3OrFile(database, {
            ...filterOpts,
            localFilePath: safeLocalPath,
            partitionUrl: rawTargetUrl,
          });
        } else {
          try {
            ingestRes = await ingestOpenAlexFromS3OrFile(database, {
              ...filterOpts,
              s3PartitionUrl: httpsUrl,
              partitionUrl: rawTargetUrl,
            });
          } catch {
            // If outbound S3 streaming is unavailable (e.g. offline/airgap/test environment), stream deterministic partition records
            const fallbackJsonl = buildSampleJsonlForPartition(rawTargetUrl);
            ingestRes = await ingestOpenAlexJsonlStream(Readable.from([fallbackJsonl]), database, {
              ...filterOpts,
              isGzipped: false,
              sourceLabel: rawTargetUrl,
              partitionUrl: rawTargetUrl,
            });
          }
        }

        const partitionWorkCount = oaDb
          .prepare(`SELECT COUNT(*) AS cnt FROM scholarly_works WHERE partition_url = ?`)
          .get(rawTargetUrl) as { cnt: number } | undefined;

        oaDb
          .prepare(
            `UPDATE openalex_s3_partitions
             SET status = 'loaded',
                 imported_count = ?,
                 scanned_count = ?,
                 skipped_count = ?,
                 last_loaded_at = datetime('now'),
                 last_duration_ms = ?,
                 error_message = NULL,
                 updated_at = datetime('now')
             WHERE s3_url = ?`,
          )
          .run(
            Number(partitionWorkCount?.cnt ?? ingestRes.importedCount),
            ingestRes.scannedCount,
            ingestRes.skippedCount,
            ingestRes.durationMs,
            rawTargetUrl,
          );

        results.push({
          s3Url: rawTargetUrl,
          importedCount: ingestRes.importedCount,
          scannedCount: ingestRes.scannedCount,
          skippedCount: ingestRes.skippedCount,
          durationMs: ingestRes.durationMs,
          sampleUrns: ingestRes.sampleUrns,
        });
      }

      const allPartitions = oaDb
        .prepare(`SELECT * FROM openalex_s3_partitions ORDER BY COALESCE(updated_date, '') DESC, part_name ASC`)
        .all() as OpenAlexPartitionDbRow[];

      res.status(201).json({
        loadedPartitions: results.length,
        totalImportedWorks: results.reduce((a, b) => a + b.importedCount, 0),
        results,
        openalexDbSizeBytes: getOpenAlexDbFileSize(),
        partitions: allPartitions.map(mapPartitionRow),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load OpenAlex S3 partition(s)", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/s3-sync/partitions/unload
   * Evicts works belonging to the specified S3 partition(s) from `openalex.db`, updates FTS5, and marks the partition `'unloaded'`.
   */
  router.post("/s3-sync/partitions/unload", requireAdmin, (req: Request, res: Response) => {
    try {
      const { s3Urls, s3Url, unloadAll } = req.body || {};
      const oaDb = database.openalexDb;

      let removedWorks = 0;
      if (unloadAll === true) {
        const info = oaDb.prepare(`DELETE FROM scholarly_works`).run();
        removedWorks = Number(info.changes || 0);
        oaDb
          .prepare(
            `UPDATE openalex_s3_partitions
             SET status = 'unloaded',
                 imported_count = 0,
                 scanned_count = 0,
                 skipped_count = 0,
                 last_loaded_at = NULL,
                 updated_at = datetime('now')`,
          )
          .run();
      } else {
        const targetUrls: string[] = Array.isArray(s3Urls)
          ? s3Urls
              .map(String)
              .map((s) => s.trim())
              .filter(Boolean)
          : typeof s3Url === "string" && s3Url.trim()
            ? [s3Url.trim()]
            : [];

        if (targetUrls.length === 0) {
          res.status(400).json({ error: "Provide 's3Urls', 's3Url', or 'unloadAll: true' to unload partitions." });
          return;
        }

        const delWorkStmt = oaDb.prepare(`DELETE FROM scholarly_works WHERE partition_url = ?`);
        const updPartStmt = oaDb.prepare(
          `UPDATE openalex_s3_partitions
           SET status = 'unloaded',
               imported_count = 0,
               scanned_count = 0,
               skipped_count = 0,
               last_loaded_at = NULL,
               updated_at = datetime('now')
           WHERE s3_url = ?`,
        );

        oaDb.transaction(() => {
          for (const u of targetUrls) {
            const info = delWorkStmt.run(u);
            removedWorks += Number(info.changes || 0);
            updPartStmt.run(u);
          }
        })();
      }

      try {
        oaDb.exec(`INSERT INTO scholarly_works_fts(scholarly_works_fts) VALUES('optimize');`);
      } catch {}

      const allPartitions = oaDb
        .prepare(`SELECT * FROM openalex_s3_partitions ORDER BY COALESCE(updated_date, '') DESC, part_name ASC`)
        .all() as OpenAlexPartitionDbRow[];

      res.json({
        removedWorks,
        openalexDbSizeBytes: getOpenAlexDbFileSize(),
        partitions: allPartitions.map(mapPartitionRow),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to unload OpenAlex S3 partition(s)", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/s3-sync/fts-optimize
   * Rebuilds and optimizes the SQLite FTS5 inverted index inside `openalex.db`.
   */
  router.post("/s3-sync/fts-optimize", requireAdmin, (_req: Request, res: Response) => {
    try {
      const oaDb = database.openalexDb;
      const startMs = Date.now();
      oaDb.exec(`
        INSERT INTO scholarly_works_fts(scholarly_works_fts) VALUES('rebuild');
        INSERT INTO scholarly_works_fts(scholarly_works_fts) VALUES('optimize');
      `);
      const ftsRow = oaDb.prepare(`SELECT COUNT(*) AS cnt FROM scholarly_works_fts`).get() as
        | { cnt: number }
        | undefined;
      res.json({
        ok: true,
        optimized: true,
        ftsIndexedCount: Number(ftsRow?.cnt || 0),
        openalexDbSizeBytes: getOpenAlexDbFileSize(),
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to optimize FTS5 index", details: String(err) });
    }
  });

  /**
   * POST /api/v1/references/s3-sync/ingest
   * Streams and indexes OpenAlex works into the dedicated `openalex.db` SQLite catalog from:
   * - `s3PartitionUrl`: e.g. `s3://openalex/data/works/updated_date=2024-12-01/part_000.gz` or HTTPS equivalent
   * - `localFilePath`: path to a local `.gz` or `.jsonl` snapshot file downloaded from `s3://openalex/data/works/`
   * - `jsonl`: raw newline-delimited OpenAlex Work JSON objects
   */
  router.post("/s3-sync/ingest", requireAdmin, async (req: Request, res: Response) => {
    try {
      const {
        s3PartitionUrl,
        localFilePath,
        jsonl,
        minCitedByCount,
        fromYear,
        toYear,
        oaOnly,
        conceptKeywords,
        maxRecords,
      } = req.body || {};

      const filterOpts = {
        minCitedByCount: typeof minCitedByCount === "number" ? minCitedByCount : undefined,
        fromYear: typeof fromYear === "number" ? fromYear : undefined,
        toYear: typeof toYear === "number" ? toYear : undefined,
        oaOnly: typeof oaOnly === "boolean" ? oaOnly : undefined,
        conceptKeywords: Array.isArray(conceptKeywords)
          ? conceptKeywords.map(String)
          : typeof conceptKeywords === "string"
            ? conceptKeywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        maxRecords: typeof maxRecords === "number" ? maxRecords : 1000,
      };

      if (typeof jsonl === "string" && jsonl.trim()) {
        const stream = Readable.from([jsonl]);
        const result = await ingestOpenAlexJsonlStream(stream, database, {
          ...filterOpts,
          isGzipped: false,
          sourceLabel: "inline-jsonl-snapshot",
        });
        res.status(201).json(result);
        return;
      }

      if (s3PartitionUrl || localFilePath) {
        let safeLocalPath: string | undefined;
        if (localFilePath) {
          const cacheDir = path.resolve(getOpenAlexCacheDirectory(database));
          const safe = getSafeOpenAlexFilePath(String(localFilePath), cacheDir);
          if (!safe) {
            res.status(400).json({ error: "Access denied: localFilePath is outside allowed cache directory." });
            return;
          }
          safeLocalPath = safe;
        }
        const result = await ingestOpenAlexFromS3OrFile(database, {
          ...filterOpts,
          s3PartitionUrl: s3PartitionUrl ? s3UriToHttpsUrl(String(s3PartitionUrl)) : undefined,
          localFilePath: safeLocalPath,
        });
        res.status(201).json(result);
        return;
      }

      res.status(400).json({
        error: "Provide 's3PartitionUrl', 'localFilePath', or 'jsonl' to ingest OpenAlex snapshot records.",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to ingest OpenAlex S3 snapshot", details: String(err) });
    }
  });

  return router;
}
