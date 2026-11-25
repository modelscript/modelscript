// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractCitationUrnsFromText,
  normalizeCitationUrn,
  type ScholarlyWorkRecord,
} from "../../services/openalex.js";
import { BaseRepository } from "./base.js";

export class ScholarlyCitationRepository extends BaseRepository {
  /**
   * Synchronizes `post_citations` rows for a given post by extracting all citation URNs from its content.
   */
  syncPostCitations(postId: number | string, content: string | null | undefined): void {
    try {
      const urns = extractCitationUrnsFromText(content);
      this.db.prepare(`DELETE FROM post_citations WHERE post_id = ?`).run(postId);
      if (urns.length === 0) return;

      const findWorkStmt = this.facade.openalexDb.prepare(`
        SELECT id, urn FROM scholarly_works
        WHERE urn = ? COLLATE NOCASE
           OR (doi IS NOT NULL AND 'urn:doi:' || LOWER(doi) = LOWER(?))
           OR (arxiv_id IS NOT NULL AND 'urn:arxiv:' || LOWER(arxiv_id) = LOWER(?))
           OR (openalex_id IS NOT NULL AND 'urn:openalex:' || UPPER(openalex_id) = UPPER(?))
           OR ('urn:cite:' || LOWER(citation_key) = LOWER(?))
        LIMIT 1
      `);
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO post_citations (post_id, work_id, urn)
        VALUES (?, ?, ?)
      `);

      this.db.transaction(() => {
        for (const rawUrn of urns) {
          const norm = normalizeCitationUrn(rawUrn);
          const match = findWorkStmt.get(norm, norm, norm, norm, norm) as { id: number; urn: string } | undefined;
          insertStmt.run(postId, match?.id ?? null, match?.urn ?? norm);
        }
      })();
    } catch {
      // Non-fatal citation sync failure; post creation still succeeds
    }
  }

  /**
   * Upserts a `ScholarlyWorkRecord` into `openalex.db`'s `scholarly_works` (automatically indexed in FTS5)
   * and returns the hydrated record with `id`.
   */
  upsertScholarlyWork(work: ScholarlyWorkRecord): ScholarlyWorkRecord {
    const normUrn = normalizeCitationUrn(work.urn);
    if (normUrn.startsWith("urn:ansatz:")) {
      return work;
    }
    this.facade.openalexDb
      .prepare(
        `
      INSERT INTO scholarly_works (
        urn, openalex_id, doi, arxiv_id, pmid, isbn, ansatz_entity_type, ansatz_entity_id,
        title, subtitle, abstract, work_type, publication_year, publication_date,
        venue_name, venue_issn, publisher, volume, issue, pages, language, license,
        is_oa, oa_status, oa_url, local_pdf_url, local_artifact_id,
        external_locations_json, authors_json, concepts_json,
        cited_by_count, references_count, counts_by_year_json,
        referenced_urns_json, related_urns_json, citation_key, canonical_url, fwci, partition_url, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, datetime('now')
      )
      ON CONFLICT(urn) DO UPDATE SET
        openalex_id = COALESCE(excluded.openalex_id, scholarly_works.openalex_id),
        doi = COALESCE(excluded.doi, scholarly_works.doi),
        arxiv_id = COALESCE(excluded.arxiv_id, scholarly_works.arxiv_id),
        pmid = COALESCE(excluded.pmid, scholarly_works.pmid),
        isbn = COALESCE(excluded.isbn, scholarly_works.isbn),
        title = excluded.title,
        subtitle = COALESCE(excluded.subtitle, scholarly_works.subtitle),
        abstract = COALESCE(excluded.abstract, scholarly_works.abstract),
        work_type = excluded.work_type,
        publication_year = COALESCE(excluded.publication_year, scholarly_works.publication_year),
        publication_date = COALESCE(excluded.publication_date, scholarly_works.publication_date),
        venue_name = COALESCE(excluded.venue_name, scholarly_works.venue_name),
        publisher = COALESCE(excluded.publisher, scholarly_works.publisher),
        volume = COALESCE(excluded.volume, scholarly_works.volume),
        issue = COALESCE(excluded.issue, scholarly_works.issue),
        pages = COALESCE(excluded.pages, scholarly_works.pages),
        is_oa = MAX(excluded.is_oa, scholarly_works.is_oa),
        oa_status = COALESCE(excluded.oa_status, scholarly_works.oa_status),
        oa_url = COALESCE(excluded.oa_url, scholarly_works.oa_url),
        local_pdf_url = COALESCE(excluded.local_pdf_url, scholarly_works.local_pdf_url),
        local_artifact_id = COALESCE(excluded.local_artifact_id, scholarly_works.local_artifact_id),
        external_locations_json = excluded.external_locations_json,
        authors_json = excluded.authors_json,
        concepts_json = excluded.concepts_json,
        cited_by_count = MAX(excluded.cited_by_count, scholarly_works.cited_by_count),
        references_count = MAX(excluded.references_count, scholarly_works.references_count),
        counts_by_year_json = CASE WHEN excluded.counts_by_year_json != '[]' THEN excluded.counts_by_year_json ELSE scholarly_works.counts_by_year_json END,
        referenced_urns_json = CASE WHEN excluded.referenced_urns_json != '[]' THEN excluded.referenced_urns_json ELSE scholarly_works.referenced_urns_json END,
        related_urns_json = CASE WHEN excluded.related_urns_json != '[]' THEN excluded.related_urns_json ELSE scholarly_works.related_urns_json END,
        citation_key = excluded.citation_key,
        canonical_url = COALESCE(excluded.canonical_url, scholarly_works.canonical_url),
        fwci = COALESCE(excluded.fwci, scholarly_works.fwci),
        partition_url = COALESCE(excluded.partition_url, scholarly_works.partition_url),
        updated_at = datetime('now')
    `,
      )
      .run(
        normUrn,
        work.openalexId ?? null,
        work.doi ? work.doi.toLowerCase() : null,
        work.arxivId ?? null,
        work.pmid ?? null,
        work.isbn ?? null,
        work.ansatzEntityType ?? "work",
        work.ansatzEntityId ?? work.openalexId ?? null,
        work.title,
        work.subtitle ?? null,
        work.abstract ?? null,
        work.workType || "article",
        work.publicationYear ?? null,
        work.publicationDate ?? null,
        work.venueName ?? null,
        work.venueIssn ?? null,
        work.publisher ?? null,
        work.volume ?? null,
        work.issue ?? null,
        work.pages ?? null,
        work.language ?? "en",
        work.license ?? null,
        work.isOa ? 1 : 0,
        work.oaStatus ?? null,
        work.oaUrl ?? null,
        work.localPdfUrl ?? null,
        work.localArtifactId ?? null,
        JSON.stringify(work.externalLocations || []),
        JSON.stringify(work.authors || []),
        JSON.stringify(work.concepts || []),
        work.citedByCount ?? 0,
        work.referencesCount ?? 0,
        JSON.stringify(work.countsByYear || []),
        JSON.stringify(work.referencedUrns || []),
        JSON.stringify(work.relatedUrns || []),
        work.citationKey,
        work.canonicalUrl ?? null,
        work.fwci ?? null,
        work.partitionUrl ?? null,
      );

    const row = this.facade.openalexDb.prepare(`SELECT id FROM scholarly_works WHERE urn = ?`).get(normUrn) as
      { id: number } | undefined;
    return {
      ...work,
      id: row?.id ?? work.id,
      urn: normUrn,
      sourcePageUrl: `/sources/${encodeURIComponent(normUrn)}`,
    };
  }
}
