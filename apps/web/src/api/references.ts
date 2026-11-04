// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CitationExportFormatId, CitationStyleId } from "../util/citations";
import { api } from "./client";

export interface ScholarlyAuthorDto {
  name: string;
  given?: string;
  family?: string;
  openalexId?: string;
  orcid?: string;
  affiliation?: string;
  country?: string;
  username?: string;
}

export interface ScholarlyExternalLocationDto {
  source: string;
  hostType: "publisher" | "repository" | "preprint" | "aggregator" | "local_instance";
  landingPageUrl?: string;
  pdfUrl?: string;
  isOa?: boolean;
  version?: string;
  license?: string;
}

export interface ScholarlyConceptDto {
  name: string;
  openalexId?: string;
  level?: number;
  score?: number;
}

export interface ScholarlyWorkDto {
  id?: number;
  urn: string;
  openalexId?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  pmid?: string | null;
  isbn?: string | null;
  ansatzEntityType?: "work" | "post" | "package" | "artifact" | "repo" | "job" | "solution" | null;
  ansatzEntityId?: string | null;
  title: string;
  subtitle?: string | null;
  abstract?: string | null;
  workType: string;
  publicationYear?: number | null;
  publicationDate?: string | null;
  venueName?: string | null;
  venueIssn?: string | null;
  publisher?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  language?: string | null;
  license?: string | null;
  isOa: boolean;
  oaStatus?: "gold" | "green" | "hybrid" | "bronze" | "closed" | "local" | null;
  oaUrl?: string | null;
  localPdfUrl?: string | null;
  localArtifactId?: number | null;
  externalLocations: ScholarlyExternalLocationDto[];
  authors: ScholarlyAuthorDto[];
  concepts: ScholarlyConceptDto[];
  citedByCount: number;
  referencesCount: number;
  countsByYear: Array<{ year: number; cited_by_count: number }>;
  referencedUrns: string[];
  relatedUrns: string[];
  citationKey: string;
  sourcePageUrl: string;
  canonicalUrl?: string | null;
  fwci?: number | null;
  inUserLibrary?: boolean;
}

export interface ReferenceLibraryItemDto {
  id: number;
  workId: number;
  collectionId: number | null;
  collectionName?: string | null;
  collectionColor?: string | null;
  readingStatus: "to_read" | "reading" | "read" | "archived";
  rating: number | null;
  isFavorite: boolean;
  notes: string;
  tags: string[];
  customCitationKey?: string | null;
  localPdfUrl?: string | null;
  addedAt: string;
  updatedAt: string;
  work: ScholarlyWorkDto;
}

export interface ReferenceCollectionDto {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  color: string;
  icon: string;
  isPublic: boolean;
  parentId?: number | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedSourceResponseDto {
  work: ScholarlyWorkDto;
  citations: Record<CitationStyleId, string>;
  exports: Record<CitationExportFormatId, string>;
  citedByPosts: Array<{
    id: number;
    content: string;
    createdAt: string;
    likeCount: number;
    repostCount: number;
    replyCount: number;
    author: {
      username: string;
      displayName: string;
      avatarUrl?: string | null;
    };
  }>;
  referencedWorks: ScholarlyWorkDto[];
  relatedWorks: ScholarlyWorkDto[];
  libraryItem?: ReferenceLibraryItemDto | null;
}

export interface ScholarlyFacetsDto {
  topics: Array<{
    name: string;
    workCount: number;
    totalCitations: number;
  }>;
  authors: Array<{
    name: string;
    affiliation: string | null;
    orcid: string | null;
    openalexId: string | null;
    workCount: number;
    totalCitations: number;
  }>;
  venues: Array<{
    name: string;
    workCount: number;
    totalCitations: number;
  }>;
  years: Array<{
    year: number;
    count: number;
  }>;
  workTypes: Array<{
    type: string;
    count: number;
  }>;
  communityCited: Array<{
    urn: string;
    title: string;
    authors: ScholarlyAuthorDto[];
    publicationYear: number | null;
    venueName: string | null;
    citedByCount: number;
    postCitationCount: number;
  }>;
}

export async function searchScholarlyReferences(params: {
  q?: string | undefined;
  type?: string | undefined;
  author?: string | undefined;
  topic?: string | undefined;
  venue?: string | undefined;
  oa?: boolean | undefined;
  local_pdf?: boolean | undefined;
  year?: number | undefined;
  sort?: string | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
}): Promise<{
  results: ScholarlyWorkDto[];
  totalCount: number;
  page: number;
  perPage: number;
  searchEngine?: string;
}> {
  const { data } = await api.get("/references/search", { params });
  return data;
}

export async function fetchScholarlyFacets(): Promise<ScholarlyFacetsDto> {
  const { data } = await api.get("/references/facets");
  return data;
}

export async function resolveCitationSource(urnOrId: string): Promise<ResolvedSourceResponseDto> {
  const { data } = await api.get("/sources/resolve", {
    params: { urn: urnOrId },
  });
  return data;
}

export async function saveToReferenceLibrary(payload: {
  urn?: string;
  workId?: number;
  collectionId?: number | null;
  readingStatus?: "to_read" | "reading" | "read" | "archived";
  rating?: number | null;
  isFavorite?: boolean;
  notes?: string;
  tags?: string[];
  localPdfUrl?: string | null;
}): Promise<{ item: ReferenceLibraryItemDto }> {
  const { data } = await api.post("/references/library", payload);
  return data;
}

export async function fetchReferenceLibrary(params?: {
  collection_id?: number | null;
  status?: string;
  favorite?: boolean;
  q?: string;
}): Promise<{ items: ReferenceLibraryItemDto[]; totalCount: number }> {
  const { data } = await api.get("/references/library", { params });
  return data;
}

export async function updateReferenceLibraryItem(
  itemId: number,
  payload: Partial<{
    collectionId: number | null;
    readingStatus: "to_read" | "reading" | "read" | "archived";
    rating: number | null;
    isFavorite: boolean;
    notes: string;
    tags: string[];
    customCitationKey: string | null;
    localPdfUrl: string | null;
  }>,
): Promise<{ item: ReferenceLibraryItemDto }> {
  const { data } = await api.patch(`/references/library/${itemId}`, payload);
  return data;
}

export async function removeReferenceLibraryItem(itemId: number): Promise<{ success: boolean }> {
  const { data } = await api.delete(`/references/library/${itemId}`);
  return data;
}

export async function fetchReferenceCollections(): Promise<{ collections: ReferenceCollectionDto[] }> {
  const { data } = await api.get("/references/collections");
  return data;
}

export async function createReferenceCollection(payload: {
  name: string;
  description?: string;
  color?: string;
  isPublic?: boolean;
}): Promise<{ collection: ReferenceCollectionDto }> {
  const { data } = await api.post("/references/collections", payload);
  return data;
}

export async function deleteReferenceCollection(collectionId: number): Promise<{ success: boolean }> {
  const { data } = await api.delete(`/references/collections/${collectionId}`);
  return data;
}

export async function importScholarlyReferences(payload: {
  bibtex?: string;
  ris?: string;
  identifiers?: string[] | string;
  collectionId?: number | null;
  addToLibrary?: boolean;
}): Promise<{ importedCount: number; works: ScholarlyWorkDto[] }> {
  const { data } = await api.post("/references/import", payload);
  return data;
}

export async function attachLocalPdfToWork(payload: {
  urn: string;
  localPdfUrl: string;
  localArtifactId?: number | null;
}): Promise<{ work: ScholarlyWorkDto }> {
  const { data } = await api.post("/references/local-pdf", payload);
  return data;
}

export async function createCustomScholarlyWork(payload: Partial<ScholarlyWorkDto> & { title: string }): Promise<{
  work: ScholarlyWorkDto;
  citations: Record<CitationStyleId, string>;
  exports: Record<CitationExportFormatId, string>;
}> {
  const { data } = await api.post("/references/works", payload);
  return data;
}

export async function exportBatchReferences(params: {
  format: CitationExportFormatId | CitationStyleId;
  urns?: string[];
  collection_id?: number | null;
}): Promise<{ format: string; count: number; content: string }> {
  const { data } = await api.get("/references/export", {
    params: {
      format: params.format,
      urns: params.urns?.join(","),
      collection_id: params.collection_id ?? undefined,
      json: "true",
    },
  });
  return data;
}

export type ScholarlyWork = ScholarlyWorkDto;
export type ReferenceLibraryEntry = ReferenceLibraryItemDto;

export async function searchScholarlyWorks(
  query: string,
  opts?: { limit?: number; type?: string; oa?: boolean; localPdf?: boolean },
): Promise<{ works: ScholarlyWorkDto[]; results: ScholarlyWorkDto[]; totalCount: number }> {
  const res = await searchScholarlyReferences({
    q: query,
    per_page: opts?.limit ?? 15,
    type: opts?.type,
    oa: opts?.oa,
    local_pdf: opts?.localPdf,
  });
  return {
    works: res.results || [],
    results: res.results || [],
    totalCount: res.totalCount || 0,
  };
}

export async function getReferenceLibrary(
  _token?: string | null,
  params?: { collection_id?: number | null; status?: string; favorite?: boolean; q?: string },
): Promise<{ items: ReferenceLibraryItemDto[]; totalCount: number }> {
  return fetchReferenceLibrary(params);
}

export interface OpenAlexS3PartitionDto {
  id: number;
  entityType: string;
  s3Url: string;
  httpsUrl: string;
  updatedDate: string | null;
  partName: string;
  contentLength: number;
  recordCount: number;
  status: "unloaded" | "loading" | "loaded" | "error";
  importedCount: number;
  scannedCount: number;
  skippedCount: number;
  filterConfig: Record<string, unknown>;
  lastLoadedAt: string | null;
  lastDurationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenAlexS3SyncStatusDto {
  mode: string;
  openalexDbPath: string;
  openalexDbSizeBytes: number;
  fts5Enabled: boolean;
  ftsIndexedCount: number;
  s3BucketUri: string;
  s3HttpsBaseUrl: string;
  s3BrowseUrl: string;
  s3WorksManifestUrl: string;
  paidRestApiForwarded: boolean;
  openalexCacheDir?: string;
  cachedPartitionsCount?: number;
  cachedPartitionsSizeBytes?: number;
  catalogStats: {
    totalWorks: number;
    openAccessWorks: number;
    localPdfWorks: number;
    distinctVenues: number;
    totalCitations: number;
    loadedPartitionsCount: number;
    totalPartitionsCount: number;
  };
  partitions: OpenAlexS3PartitionDto[];
  awsCliSyncCommand: string;
}

export async function fetchOpenAlexS3SyncStatus(): Promise<OpenAlexS3SyncStatusDto> {
  const { data } = await api.get("/references/s3-sync/status");
  return data;
}

export async function preloadOpenAlexFirstSlice(payload?: {
  force?: boolean;
  maxRecords?: number;
  s3Url?: string;
}): Promise<{
  status: "already_loaded" | "preloaded" | "fallback_loaded";
  s3Url: string;
  importedCount: number;
  totalWorks: number;
  durationMs: number;
  cachedFilePath?: string;
  fromCache?: boolean;
  sampleUrns: string[];
}> {
  const { data } = await api.post("/references/s3-sync/preload-first-slice", payload || {});
  return data;
}

export async function syncOpenAlexS3Manifest(payload?: { entity?: string; limit?: number }): Promise<{
  syncedCount: number;
  manifestSource: "live-s3" | "offline-catalog";
  entity: string;
  partitions: OpenAlexS3PartitionDto[];
}> {
  const { data } = await api.post("/references/s3-sync/manifest/sync", payload || {});
  return data;
}

export async function loadOpenAlexS3Partitions(payload: {
  s3Urls: string[];
  minCitedByCount?: number;
  fromYear?: number;
  toYear?: number;
  oaOnly?: boolean;
  conceptKeywords?: string[];
  maxRecords?: number;
  jsonl?: string;
  localFilePath?: string;
}): Promise<{
  loadedPartitions: number;
  totalImportedWorks: number;
  openalexDbSizeBytes: number;
  partitions: OpenAlexS3PartitionDto[];
}> {
  const { data } = await api.post("/references/s3-sync/partitions/load", payload);
  return data;
}

export async function unloadOpenAlexS3Partitions(payload: { s3Urls?: string[]; unloadAll?: boolean }): Promise<{
  removedWorks: number;
  openalexDbSizeBytes: number;
  partitions: OpenAlexS3PartitionDto[];
}> {
  const { data } = await api.post("/references/s3-sync/partitions/unload", payload);
  return data;
}

export async function optimizeOpenAlexFts5(): Promise<{
  optimized: boolean;
  ftsIndexedCount: number;
  openalexDbSizeBytes: number;
  durationMs: number;
}> {
  const { data } = await api.post("/references/s3-sync/fts-optimize", {});
  return data;
}
