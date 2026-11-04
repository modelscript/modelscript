// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookmarkFillIcon as BookmarkCheck,
  BookmarkIcon as BookmarkPlus,
  BookIcon as BookOpen,
  CalendarIcon as Calendar,
  CheckIcon as Check,
  ChevronDownIcon,
  CopyIcon as Copy,
  DownloadIcon as Download,
  LinkExternalIcon as ExternalLink,
  FileCheckIcon as FileCheck2,
  FileIcon as FileText,
  FilterIcon as Filter,
  FileDirectoryIcon as FolderPlus,
  GlobeIcon as Globe,
  DesktopDownloadIcon as HardDriveDownload,
  HashIcon as Hash,
  RepoIcon as Library,
  CommentDiscussionIcon as MessageSquareQuote,
  PlusIcon as Plus,
  SearchIcon as Search,
  SortAscIcon,
  StarIcon as Star,
  TagIcon as Tag,
  TrashIcon as Trash2,
  GraphIcon as TrendingUp,
  UploadIcon as Upload,
  PeopleIcon as Users,
  XIcon as X,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  createCustomScholarlyWork,
  createReferenceCollection,
  deleteReferenceCollection,
  exportBatchReferences,
  fetchReferenceCollections,
  fetchReferenceLibrary,
  fetchScholarlyFacets,
  importScholarlyReferences,
  removeReferenceLibraryItem,
  saveToReferenceLibrary,
  searchScholarlyReferences,
  updateReferenceLibraryItem,
  type ReferenceCollectionDto,
  type ReferenceLibraryItemDto,
  type ScholarlyFacetsDto,
  type ScholarlyWorkDto,
} from "../api/references";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CiteButton } from "../components/citations/CiteButton";
import { ToastContext } from "../components/ToastContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import {
  buildCitationFromScholarlyWork,
  buildSourcePageUrl,
  CITATION_EXPORT_FORMATS,
  normalizeCitationUrn,
  type CitationExportFormatId,
} from "../util/citations";
import { usePageTitle } from "../util/title";
import {
  Abstract,
  ActionButton,
  ActionLink,
  Badge,
  BadgeRow,
  Chip,
  CopyTag,
  EmptyActions,
  EmptyState,
  FacetCard,
  FacetGrid,
  FacetStrip,
  FacetText,
  Field,
  FieldLabel,
  FilterPill,
  FilterPillBar,
  FooterGroup,
  FooterMeta,
  FormGrid,
  HeaderActionsGroup,
  HeaderControlsRow,
  HeaderTitle,
  HeaderTitleGroup,
  HeaderTopRow,
  IconButton,
  InlineSelect,
  InlineStat,
  LibraryLayout,
  LibraryMain,
  LibrarySidebar,
  MetaButton,
  MetaLine,
  ModalCard,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  MonoSearchWrapper,
  NewCollectionForm,
  NotesBox,
  ReferencesHeader,
  ResolveForm,
  ResultCount,
  ResultRow,
  RowActions,
  RowMain,
  RowTitle,
  RowTop,
  ScopeSegmentButton,
  ScopeSegmentedControl,
  SearchClearButton,
  SearchFieldWrapper,
  SearchKbdHint,
  Section,
  SectionHeader,
  SidebarItem,
  SidebarLabel,
  SkeletonRow,
  StripLabel,
  TextArea,
  TextButton,
  ToolbarSelectWrapper,
  UrnCode,
} from "./references/styles";

export const ReferencesPage: React.FC = () => {
  usePageTitle("Scholarly References & OpenAlex Catalog — Ansatz");
  const hasReferences = useFeatureFlag(["references", "scientific_references"]);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const toastCtx = useContext(ToastContext);
  const addToast = useCallback(
    (msg: string, type: "success" | "error" | "info" | "warning" = "info") => {
      toastCtx?.showToast(msg, type);
    },
    [toastCtx],
  );

  const rawTabParam = searchParams.get("tab");
  const initialTab: "discover" | "browse" | "library" =
    rawTabParam === "library" ? "library" : rawTabParam === "browse" ? "browse" : "discover";
  const [activeTab, setActiveTab] = useState<"discover" | "browse" | "library">(initialTab);

  // Instant URN / DOI / arXiv Resolver bar state
  const [resolveInput, setResolveInput] = useState("");

  // Discover state + facet filters
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [authorFilter, setAuthorFilter] = useState(searchParams.get("author") || "");
  const [topicFilter, setTopicFilter] = useState(searchParams.get("topic") || "");
  const [venueFilter, setVenueFilter] = useState(searchParams.get("venue") || "");
  const [yearFilter, setYearFilter] = useState<number | null>(
    searchParams.get("year") ? Number(searchParams.get("year")) : null,
  );
  const [workTypeFilter, setWorkTypeFilter] = useState("all");
  const [oaOnly, setOaOnly] = useState(false);
  const [localPdfOnly, setLocalPdfOnly] = useState(false);
  const [sortBy, setSortBy] = useState("cited_by_count:desc");
  const [discoverResults, setDiscoverResults] = useState<ScholarlyWorkDto[]>([]);
  const [discoverTotal, setDiscoverTotal] = useState(0);
  const [discoverLoading, setDiscoverLoading] = useState(true);

  // Facets state (Topics, Authors, Venues, Years, Community Cited)
  const [facets, setFacets] = useState<ScholarlyFacetsDto | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [browseFilterQuery, setBrowseFilterQuery] = useState("");
  const [browseCategory, setBrowseCategory] = useState<"all" | "topics" | "authors" | "venues" | "years">("all");

  // Personal Library state
  const [libraryItems, setLibraryItems] = useState<ReferenceLibraryItemDto[]>([]);
  const [collections, setCollections] = useState<ReferenceCollectionDto[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [expandedNotesId, setExpandedNotesId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});

  // Modals state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<"identifiers" | "bibtex" | "ris">("identifiers");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const [showCreateWorkModal, setShowCreateWorkModal] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customAuthors, setCustomAuthors] = useState("");
  const [customYear, setCustomYear] = useState(String(new Date().getFullYear()));
  const [customVenue, setCustomVenue] = useState("");
  const [customDoi, setCustomDoi] = useState("");
  const [customLocalPdf, setCustomLocalPdf] = useState("");
  const [customAbstract, setCustomAbstract] = useState("");

  const [newCollectionName, setNewCollectionName] = useState("");
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false);
  const [copiedUrn, setCopiedUrn] = useState<string | null>(null);

  const runDiscoverSearch = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const data = await searchScholarlyReferences({
        q: searchQuery.trim() || undefined,
        type: workTypeFilter !== "all" ? workTypeFilter : undefined,
        author: authorFilter.trim() || undefined,
        topic: topicFilter.trim() || undefined,
        venue: venueFilter.trim() || undefined,
        year: yearFilter ?? undefined,
        oa: oaOnly ? true : undefined,
        local_pdf: localPdfOnly ? true : undefined,
        sort: sortBy,
        per_page: 25,
      });
      setDiscoverResults(data.results || []);
      setDiscoverTotal(data.totalCount || 0);
    } catch {
      addToast("Failed to search OpenAlex / scholarly catalog", "error");
    } finally {
      setDiscoverLoading(false);
    }
  }, [
    searchQuery,
    workTypeFilter,
    authorFilter,
    topicFilter,
    venueFilter,
    yearFilter,
    oaOnly,
    localPdfOnly,
    sortBy,
    addToast,
  ]);

  const loadFacets = useCallback(async () => {
    setFacetsLoading(true);
    try {
      const data = await fetchScholarlyFacets();
      setFacets(data);
    } catch {
      // Non-fatal if facets endpoint fails
    } finally {
      setFacetsLoading(false);
    }
  }, []);

  const loadPersonalLibrary = useCallback(async () => {
    if (!token) return;
    setLibraryLoading(true);
    try {
      const [libRes, colRes] = await Promise.all([
        fetchReferenceLibrary({
          collection_id: selectedCollectionId,
          status: statusFilter !== "all" ? statusFilter : undefined,
          favorite: favoritesOnly ? true : undefined,
          q: librarySearch.trim() || undefined,
        }),
        fetchReferenceCollections(),
      ]);
      setLibraryItems(libRes.items || []);
      setCollections(colRes.collections || []);
    } catch {
      addToast("Failed to load personal reference library", "error");
    } finally {
      setLibraryLoading(false);
    }
  }, [token, selectedCollectionId, statusFilter, favoritesOnly, librarySearch, addToast]);

  useEffect(() => {
    if (!hasReferences) return;
    void runDiscoverSearch();
  }, [hasReferences, runDiscoverSearch]);

  useEffect(() => {
    if (!hasReferences) return;
    void loadFacets();
  }, [hasReferences, loadFacets]);

  useEffect(() => {
    if (!hasReferences) return;
    if (activeTab === "library" && token) {
      void loadPersonalLibrary();
    }
  }, [hasReferences, activeTab, token, loadPersonalLibrary]);

  const applyFacetFilter = (patch: {
    topic?: string | null;
    author?: string | null;
    venue?: string | null;
    year?: number | null;
  }) => {
    if (patch.topic !== undefined) setTopicFilter(patch.topic || "");
    if (patch.author !== undefined) setAuthorFilter(patch.author || "");
    if (patch.venue !== undefined) setVenueFilter(patch.venue || "");
    if (patch.year !== undefined) setYearFilter(patch.year ?? null);
    setActiveTab("discover");
    setSearchParams((prev) => {
      prev.set("tab", "discover");
      if (patch.topic !== undefined) {
        if (patch.topic) prev.set("topic", patch.topic);
        else prev.delete("topic");
      }
      if (patch.author !== undefined) {
        if (patch.author) prev.set("author", patch.author);
        else prev.delete("author");
      }
      if (patch.venue !== undefined) {
        if (patch.venue) prev.set("venue", patch.venue);
        else prev.delete("venue");
      }
      if (patch.year !== undefined) {
        if (patch.year) prev.set("year", String(patch.year));
        else prev.delete("year");
      }
      return prev;
    });
  };

  const clearAllFacetFilters = () => {
    setTopicFilter("");
    setAuthorFilter("");
    setVenueFilter("");
    setYearFilter(null);
    setWorkTypeFilter("all");
    setOaOnly(false);
    setLocalPdfOnly(false);
    setSearchParams((prev) => {
      prev.delete("topic");
      prev.delete("author");
      prev.delete("venue");
      prev.delete("year");
      return prev;
    });
  };

  const handleQuickResolveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = resolveInput
      .trim()
      .replace(/^\[@/, "")
      .replace(/\]$/, "")
      .replace(/^\\cite\{/, "")
      .replace(/\}$/, "")
      .trim();
    if (!cleaned) return;
    const normalizedUrn = normalizeCitationUrn(cleaned);
    navigate(buildSourcePageUrl(normalizedUrn));
  };

  const filteredFacets = useMemo(() => {
    const q = browseFilterQuery.trim().toLowerCase();
    const topics = (facets?.topics || []).filter((t) => !q || t.name.toLowerCase().includes(q));
    const authors = (facets?.authors || []).filter(
      (a) => !q || a.name.toLowerCase().includes(q) || (a.affiliation || "").toLowerCase().includes(q),
    );
    const venues = (facets?.venues || []).filter((v) => !q || v.name.toLowerCase().includes(q));
    const years = (facets?.years || []).filter((y) => !q || String(y.year).includes(q));
    return { topics, authors, venues, years };
  }, [facets, browseFilterQuery]);

  const handleSaveWorkToLibrary = async (work: ScholarlyWorkDto) => {
    if (!token) {
      addToast("Sign in to save papers to your Reference Library", "info");
      return;
    }
    try {
      await saveToReferenceLibrary({
        urn: work.urn,
        workId: work.id,
        collectionId: selectedCollectionId,
      });
      setDiscoverResults((prev) => prev.map((w) => (w.urn === work.urn ? { ...w, inUserLibrary: true } : w)));
      addToast(`Saved "${work.title.slice(0, 45)}..." to your Library`, "success");
    } catch {
      addToast("Failed to save to Reference Library", "error");
    }
  };

  const handleUpdateLibraryItem = async (
    item: ReferenceLibraryItemDto,
    patch: Parameters<typeof updateReferenceLibraryItem>[1],
  ) => {
    try {
      const { item: updated } = await updateReferenceLibraryItem(item.id, patch);
      setLibraryItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, ...updated } : it)));
      addToast("Updated reference", "success");
    } catch {
      addToast("Failed to update reference", "error");
    }
  };

  const handleDeleteLibraryItem = async (itemId: number) => {
    try {
      await removeReferenceLibraryItem(itemId);
      setLibraryItems((prev) => prev.filter((it) => it.id !== itemId));
      addToast("Removed from your library", "info");
    } catch {
      addToast("Failed to remove reference", "error");
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    try {
      const { collection } = await createReferenceCollection({ name: newCollectionName.trim() });
      setCollections((prev) => [...prev, collection]);
      setNewCollectionName("");
      setShowNewCollectionInput(false);
      addToast(`Created collection "${collection.name}"`, "success");
    } catch {
      addToast("Failed to create collection", "error");
    }
  };

  const handleDeleteCollection = async (colId: number) => {
    try {
      await deleteReferenceCollection(colId);
      setCollections((prev) => prev.filter((c) => c.id !== colId));
      if (selectedCollectionId === colId) setSelectedCollectionId(null);
      addToast("Deleted collection", "info");
    } catch {
      addToast("Failed to delete collection", "error");
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const payload =
        importMode === "bibtex"
          ? { bibtex: importText, collectionId: selectedCollectionId }
          : importMode === "ris"
            ? { ris: importText, collectionId: selectedCollectionId }
            : { identifiers: importText, collectionId: selectedCollectionId };
      const res = await importScholarlyReferences(payload);
      addToast(`Imported ${res.importedCount} scholarly reference(s)`, "success");
      setShowImportModal(false);
      setImportText("");
      void runDiscoverSearch();
      void loadFacets();
      if (token) void loadPersonalLibrary();
    } catch {
      addToast("Failed to import references", "error");
    } finally {
      setImporting(false);
    }
  };

  const handleCreateCustomWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) return;
    try {
      const authors = customAuthors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }));
      const { work } = await createCustomScholarlyWork({
        title: customTitle.trim(),
        authors: authors.length > 0 ? authors : [{ name: "Ansatz Researcher" }],
        publicationYear: Number(customYear) || new Date().getFullYear(),
        venueName: customVenue.trim() || "Ansatz Scholarly Archive",
        doi: customDoi.trim() || null,
        localPdfUrl: customLocalPdf.trim() || null,
        abstract: customAbstract.trim() || null,
      });
      if (token && work.urn) {
        await saveToReferenceLibrary({ urn: work.urn, workId: work.id });
      }
      addToast(`Registered source "${work.title}"`, "success");
      setShowCreateWorkModal(false);
      setCustomTitle("");
      setCustomAuthors("");
      setCustomVenue("");
      setCustomDoi("");
      setCustomLocalPdf("");
      setCustomAbstract("");
      navigate(buildSourcePageUrl(work.urn));
    } catch {
      addToast("Failed to register scholarly work", "error");
    }
  };

  const handleBatchExport = async (format: CitationExportFormatId) => {
    try {
      const urns =
        activeTab === "library" && libraryItems.length > 0
          ? libraryItems.map((i) => i.work.urn)
          : discoverResults.map((w) => w.urn);
      if (urns.length === 0) {
        addToast("No references available to export", "info");
        return;
      }
      const res = await exportBatchReferences({ format, urns });
      const fmtMeta = CITATION_EXPORT_FORMATS.find((f) => f.id === format) || CITATION_EXPORT_FORMATS[0]!;
      const blob = new Blob([res.content], { type: fmtMeta.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ansatz-references.${fmtMeta.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`Exported ${res.count} reference(s) as ${fmtMeta.label}`, "success");
    } catch {
      addToast("Failed to export references", "error");
    }
  };

  const handleCopyUrnTag = (urn: string) => {
    const tag = `[@${urn}]`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(tag);
    }
    setCopiedUrn(urn);
    addToast(`Copied ${tag} to clipboard`, "success");
    setTimeout(() => setCopiedUrn((prev) => (prev === urn ? null : prev)), 2000);
  };

  const hasActiveFacets = Boolean(topicFilter || authorFilter || venueFilter || yearFilter !== null);
  const hasAnyDiscoverFilter =
    hasActiveFacets || Boolean(searchQuery.trim()) || workTypeFilter !== "all" || oaOnly || localPdfOnly;

  const selectTab = (tab: "discover" | "browse" | "library") => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      prev.set("tab", tab);
      return prev;
    });
  };

  // Write actions need an account: send signed-out users to the login page (same as Packages > Publish).
  const requireAuth = (action: () => void) => () => {
    if (!token) {
      navigate("/login");
      return;
    }
    action();
  };

  // Drop any per-user state when signed out so stale collections/items never show.
  useEffect(() => {
    if (!token) {
      setLibraryItems([]);
      setCollections([]);
      setSelectedCollectionId(null);
      setShowNewCollectionInput(false);
    }
  }, [token]);

  const resetDiscover = () => {
    setSearchQuery("");
    clearAllFacetFilters();
  };

  // Search input is shared across tabs (only one is mounted at a time): `/` focuses, `Esc` clears.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || active?.isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasReferences]);

  const searchValue =
    activeTab === "discover" ? searchQuery : activeTab === "browse" ? browseFilterQuery : librarySearch;
  const setSearchValue =
    activeTab === "discover" ? setSearchQuery : activeTab === "browse" ? setBrowseFilterQuery : setLibrarySearch;
  const searchPlaceholder =
    activeTab === "discover"
      ? "Search works by title, author, DOI, URN, or topic..."
      : activeTab === "browse"
        ? "Filter topics, authors, journals, or years..."
        : "Filter saved references by title, author, notes, or tag...";
  const searchTestId =
    activeTab === "discover"
      ? "references-search-input"
      : activeTab === "browse"
        ? "references-browse-filter-input"
        : undefined;

  const tabCount =
    activeTab === "discover"
      ? discoverLoading
        ? null
        : discoverTotal
      : activeTab === "library"
        ? libraryItems.length
        : null;

  if (!hasReferences) {
    return <Navigate to="/packages" replace />;
  }

  return (
    <Box data-testid="references-page">
      <ReferencesHeader>
        <HeaderTopRow>
          <HeaderTitleGroup>
            <HeaderTitle>References</HeaderTitle>
            {tabCount !== null && <ResultCount>{tabCount.toLocaleString()}</ResultCount>}
          </HeaderTitleGroup>

          <HeaderActionsGroup>
            <ScopeSegmentedControl role="tablist" aria-label="References view">
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "discover"}
                $active={activeTab === "discover"}
                data-testid="references-tab-discover"
                onClick={() => selectTab("discover")}
              >
                <Globe size={13} />
                Search
              </ScopeSegmentButton>
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "browse"}
                $active={activeTab === "browse"}
                data-testid="references-tab-browse"
                onClick={() => selectTab("browse")}
              >
                <Tag size={13} />
                Browse
              </ScopeSegmentButton>
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "library"}
                $active={activeTab === "library"}
                data-testid="references-tab-library"
                onClick={() => selectTab("library")}
              >
                <Library size={13} />
                My Library
                {libraryItems.length > 0 && <span style={{ opacity: 0.7 }}>{libraryItems.length}</span>}
              </ScopeSegmentButton>
            </ScopeSegmentedControl>

            <Button
              size="small"
              leadingVisual={Upload}
              onClick={requireAuth(() => setShowImportModal(true))}
              data-testid="references-open-import-btn"
              style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
            >
              Import
            </Button>
            <Button
              size="small"
              leadingVisual={Download}
              onClick={() => void handleBatchExport("bibtex")}
              data-testid="references-batch-export-bibtex-btn"
              style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
            >
              Export .bib
            </Button>
            <Button
              size="small"
              variant="primary"
              leadingVisual={Plus}
              onClick={requireAuth(() => setShowCreateWorkModal(true))}
              data-testid="references-open-create-btn"
              style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
            >
              Add Source
            </Button>
          </HeaderActionsGroup>
        </HeaderTopRow>

        <HeaderControlsRow>
          <SearchFieldWrapper>
            <Search size={15} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchValue) setSearchValue("");
                  else searchInputRef.current?.blur();
                }
              }}
              placeholder={searchPlaceholder}
              aria-label="Search references"
              data-testid={searchTestId}
            />
            {searchValue ? (
              <SearchClearButton type="button" aria-label="Clear search" onClick={() => setSearchValue("")}>
                <XCircleFillIcon size={14} />
              </SearchClearButton>
            ) : (
              <SearchKbdHint className="search-kbd-hint" aria-hidden="true">
                /
              </SearchKbdHint>
            )}
          </SearchFieldWrapper>

          {activeTab === "discover" && (
            <>
              <ToolbarSelectWrapper $active={workTypeFilter !== "all"}>
                <span className="select-leading" aria-hidden="true">
                  <FileText size={14} />
                </span>
                <select
                  value={workTypeFilter}
                  onChange={(e) => setWorkTypeFilter(e.target.value)}
                  aria-label="Filter by work type"
                >
                  <option value="all">All Types</option>
                  <option value="article">Journal Articles</option>
                  <option value="preprint">Preprints (arXiv)</option>
                  <option value="software">Software &amp; Packages</option>
                  <option value="book">Books &amp; Standards</option>
                  <option value="report">Technical Reports</option>
                </select>
                <span className="select-trailing" aria-hidden="true">
                  <ChevronDownIcon size={13} />
                </span>
              </ToolbarSelectWrapper>

              <ToolbarSelectWrapper $active={sortBy !== "cited_by_count:desc"}>
                <span className="select-leading" aria-hidden="true">
                  <SortAscIcon size={14} />
                </span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort references">
                  <option value="cited_by_count:desc">Most Cited</option>
                  <option value="publication_year:desc">Newest First</option>
                  <option value="publication_year:asc">Oldest First</option>
                  <option value="title:asc">Title (A–Z)</option>
                </select>
                <span className="select-trailing" aria-hidden="true">
                  <ChevronDownIcon size={13} />
                </span>
              </ToolbarSelectWrapper>

              <FilterPill
                type="button"
                $active={oaOnly}
                aria-pressed={oaOnly}
                data-testid="references-filter-oa-btn"
                onClick={() => setOaOnly((v) => !v)}
              >
                <Globe size={13} />
                Open Access
              </FilterPill>
              <FilterPill
                type="button"
                $active={localPdfOnly}
                aria-pressed={localPdfOnly}
                data-testid="references-filter-local-pdf-btn"
                onClick={() => setLocalPdfOnly((v) => !v)}
              >
                <HardDriveDownload size={13} />
                Local PDF
              </FilterPill>
            </>
          )}

          {activeTab === "browse" && (
            <ToolbarSelectWrapper $active={browseCategory !== "all"}>
              <span className="select-leading" aria-hidden="true">
                <Filter size={14} />
              </span>
              <select
                value={browseCategory}
                onChange={(e) => setBrowseCategory(e.target.value as typeof browseCategory)}
                aria-label="Facet category"
              >
                <option value="all">All Facets</option>
                <option value="topics">Topics ({filteredFacets.topics.length})</option>
                <option value="authors">Authors ({filteredFacets.authors.length})</option>
                <option value="venues">Venues ({filteredFacets.venues.length})</option>
                <option value="years">Years ({filteredFacets.years.length})</option>
              </select>
              <span className="select-trailing" aria-hidden="true">
                <ChevronDownIcon size={13} />
              </span>
            </ToolbarSelectWrapper>
          )}
        </HeaderControlsRow>

        {/* Instant Citation / URN / DOI / arXiv Resolver */}
        <ResolveForm onSubmit={handleQuickResolveSubmit} data-testid="references-quick-resolve-form">
          <MonoSearchWrapper>
            <MessageSquareQuote size={14} />
            <input
              type="text"
              value={resolveInput}
              onChange={(e) => setResolveInput(e.target.value)}
              placeholder="Resolve a citation: urn:openalex:W…, DOI, arXiv ID, or [@urn:…]"
              aria-label="Resolve citation URN, DOI, or arXiv ID"
              data-testid="references-quick-resolve-input"
            />
          </MonoSearchWrapper>
          <Button
            type="submit"
            size="small"
            disabled={!resolveInput.trim()}
            trailingVisual={ExternalLink}
            data-testid="references-quick-resolve-btn"
            style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
          >
            Open Source Page
          </Button>
        </ResolveForm>
      </ReferencesHeader>

      {activeTab === "discover" ? (
        <>
          {/* Active filters + popular facets */}
          {(hasActiveFacets || (facets && (facets.topics.length > 0 || facets.authors.length > 0))) && (
            <Box
              px="20px"
              py="12px"
              display="flex"
              flexDirection="column"
              gap="8px"
              borderBottom="1px solid var(--color-border)"
            >
              {hasActiveFacets && (
                <FacetStrip>
                  <StripLabel>
                    <Filter size={12} /> Filters
                  </StripLabel>
                  {topicFilter && (
                    <Chip type="button" $active $tone="purple" onClick={() => applyFacetFilter({ topic: null })}>
                      <Hash size={11} />
                      Topic: {topicFilter}
                      <X size={11} />
                    </Chip>
                  )}
                  {authorFilter && (
                    <Chip type="button" $active $tone="brand" onClick={() => applyFacetFilter({ author: null })}>
                      <Users size={11} />
                      Author: {authorFilter}
                      <X size={11} />
                    </Chip>
                  )}
                  {venueFilter && (
                    <Chip type="button" $active $tone="success" onClick={() => applyFacetFilter({ venue: null })}>
                      <BookOpen size={11} />
                      Venue: {venueFilter}
                      <X size={11} />
                    </Chip>
                  )}
                  {yearFilter !== null && (
                    <Chip type="button" $active $tone="warning" onClick={() => applyFacetFilter({ year: null })}>
                      <Calendar size={11} />
                      Year: {yearFilter}
                      <X size={11} />
                    </Chip>
                  )}
                  <TextButton type="button" onClick={clearAllFacetFilters}>
                    Clear all
                  </TextButton>
                </FacetStrip>
              )}

              {facets && (facets.topics.length > 0 || facets.authors.length > 0) && (
                <FacetStrip>
                  <StripLabel>Popular</StripLabel>
                  {facets.topics.slice(0, 6).map((t) => (
                    <Chip
                      key={`quick-topic-${t.name}`}
                      type="button"
                      $tone="purple"
                      $active={topicFilter === t.name}
                      onClick={() => applyFacetFilter({ topic: topicFilter === t.name ? null : t.name })}
                    >
                      #{t.name} <span style={{ opacity: 0.6 }}>{t.workCount}</span>
                    </Chip>
                  ))}
                  {facets.authors.slice(0, 4).map((a) => (
                    <Chip
                      key={`quick-author-${a.name}`}
                      type="button"
                      $tone="brand"
                      $active={authorFilter === a.name}
                      onClick={() => applyFacetFilter({ author: authorFilter === a.name ? null : a.name })}
                    >
                      <Users size={11} />
                      {a.name} <span style={{ opacity: 0.6 }}>{a.workCount}</span>
                    </Chip>
                  ))}
                  <TextButton type="button" style={{ marginLeft: "auto" }} onClick={() => selectTab("browse")}>
                    Browse all →
                  </TextButton>
                </FacetStrip>
              )}
            </Box>
          )}

          {/* Results List */}
          {discoverLoading ? (
            <Box>
              {[0, 1, 2].map((i) => (
                <SkeletonRow key={i} />
              ))}
            </Box>
          ) : discoverResults.length === 0 ? (
            <EmptyState>
              <BookOpen size={48} />
              <h2>No matching works found</h2>
              <p>
                {hasAnyDiscoverFilter
                  ? "Nothing matches your current search and filters. Try broadening them, or paste a DOI/URN into the resolver above."
                  : "The scholarly catalog is empty. Import a BibTeX/RIS file or DOI, or load OpenAlex partitions from"}
                {!hasAnyDiscoverFilter && (
                  <>
                    {" "}
                    <Link to="/admin/openalex">Admin → OpenAlex S3 Catalog</Link>.
                  </>
                )}
              </p>
              <EmptyActions>
                {hasAnyDiscoverFilter && (
                  <Button size="small" onClick={resetDiscover}>
                    Reset filters
                  </Button>
                )}
                <Button size="small" leadingVisual={Upload} onClick={requireAuth(() => setShowImportModal(true))}>
                  Import references
                </Button>
                {hasAnyDiscoverFilter && (
                  <Button size="small" onClick={() => navigate("/admin/openalex")}>
                    Load OpenAlex catalog
                  </Button>
                )}
              </EmptyActions>
            </EmptyState>
          ) : (
            <Box data-testid="references-discover-list">
              {discoverResults.map((work) => {
                const target = buildCitationFromScholarlyWork(work);
                const sourceUrl = buildSourcePageUrl(work.urn);
                const externalPdf = work.externalLocations?.find((l) => l.pdfUrl && l.hostType !== "local_instance");

                return (
                  <ResultRow key={work.urn} data-testid={`reference-work-card-${work.urn}`}>
                    <RowTop>
                      <RowMain>
                        <BadgeRow>
                          <Badge $tone="brand">{work.workType}</Badge>
                          {work.localPdfUrl && (
                            <Badge $tone="success" as={Link} to={sourceUrl}>
                              <FileCheck2 size={11} />
                              Local PDF
                            </Badge>
                          )}
                          {work.isOa && (
                            <Badge $tone="warning">
                              <Globe size={11} />
                              Open Access
                            </Badge>
                          )}
                          <UrnCode>{work.urn}</UrnCode>
                        </BadgeRow>

                        <RowTitle as={Link} to={sourceUrl} data-testid={`reference-work-title-link-${work.urn}`}>
                          {work.title}
                        </RowTitle>

                        <MetaLine>
                          {(work.authors || []).map((a, idx) => (
                            <React.Fragment key={`${work.urn}-author-${a.name}-${idx}`}>
                              <MetaButton
                                type="button"
                                onClick={() => applyFacetFilter({ author: a.name })}
                                title={`Browse all works by ${a.name}`}
                                style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
                              >
                                {a.name}
                              </MetaButton>
                              {idx < (work.authors || []).length - 1 && <span>,</span>}
                            </React.Fragment>
                          ))}
                          {work.publicationYear && (
                            <>
                              <span>·</span>
                              <MetaButton
                                type="button"
                                onClick={() => applyFacetFilter({ year: work.publicationYear })}
                                title={`Filter by year ${work.publicationYear}`}
                              >
                                {work.publicationYear}
                              </MetaButton>
                            </>
                          )}
                          {work.venueName && (
                            <>
                              <span>·</span>
                              <MetaButton
                                type="button"
                                onClick={() => applyFacetFilter({ venue: work.venueName })}
                                title={`Browse all works in ${work.venueName}`}
                              >
                                {work.venueName}
                              </MetaButton>
                            </>
                          )}
                        </MetaLine>

                        {work.concepts && work.concepts.length > 0 && (
                          <BadgeRow style={{ gap: 6 }}>
                            {work.concepts.slice(0, 5).map((c) => (
                              <Chip
                                key={`${work.urn}-concept-${c.name}`}
                                type="button"
                                $tone="purple"
                                onClick={() => applyFacetFilter({ topic: c.name })}
                                title={`Browse works on ${c.name}`}
                                style={{ fontSize: 11, padding: "1px 8px" }}
                              >
                                #{c.name}
                              </Chip>
                            ))}
                          </BadgeRow>
                        )}
                      </RowMain>

                      <RowActions>
                        <CiteButton
                          target={target}
                          label="Cite"
                          variant="button"
                          testId={`reference-card-cite-btn-${work.urn}`}
                        />
                        <ActionButton
                          type="button"
                          onClick={() => void handleSaveWorkToLibrary(work)}
                          disabled={Boolean(work.inUserLibrary)}
                          data-testid={`reference-card-save-btn-${work.urn}`}
                        >
                          {work.inUserLibrary ? (
                            <BookmarkCheck size={13} fill="var(--ms-success)" />
                          ) : (
                            <BookmarkPlus size={13} />
                          )}
                          {work.inUserLibrary ? "Saved" : "Save"}
                        </ActionButton>
                        <ActionLink
                          as={Link}
                          to={sourceUrl}
                          $primary
                          data-testid={`reference-card-source-link-${work.urn}`}
                        >
                          Source Page
                          <ExternalLink size={12} />
                        </ActionLink>
                      </RowActions>
                    </RowTop>

                    {work.abstract && <Abstract>{work.abstract}</Abstract>}

                    <FooterMeta>
                      <FooterGroup>
                        <InlineStat>
                          <TrendingUp size={12} />
                          {work.citedByCount.toLocaleString()} citations
                        </InlineStat>
                        {work.localPdfUrl && (
                          <InlineStat $tone="success">
                            <FileText size={12} />
                            <a href={work.localPdfUrl} target="_blank" rel="noopener noreferrer">
                              Local PDF ({work.localPdfUrl.split("/").pop()})
                            </a>
                          </InlineStat>
                        )}
                        {externalPdf?.pdfUrl && (
                          <InlineStat $tone="brand">
                            <ExternalLink size={11} />
                            <a href={externalPdf.pdfUrl} target="_blank" rel="noopener noreferrer">
                              External PDF ({externalPdf.source})
                            </a>
                          </InlineStat>
                        )}
                      </FooterGroup>

                      <CopyTag type="button" onClick={() => handleCopyUrnTag(work.urn)} title="Copy citation tag">
                        {copiedUrn === work.urn ? <Check size={11} fill="var(--ms-success)" /> : <Copy size={11} />}
                        [@{work.urn}]
                      </CopyTag>
                    </FooterMeta>
                  </ResultRow>
                );
              })}
            </Box>
          )}
        </>
      ) : activeTab === "browse" ? (
        /* Browse by Topic, Author, Venue & Year Directory Tab */
        <Box data-testid="references-browse-directory">
          <SectionHeader style={{ marginBottom: "12px" }}>
            <h1 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Browse by Topic, Author &amp; Venue</h1>
          </SectionHeader>
          {facetsLoading ? (
            <EmptyState>
              <p>Loading scholarly facets…</p>
            </EmptyState>
          ) : (
            <>
              {(browseCategory === "all" || browseCategory === "topics") && (
                <Section>
                  <SectionHeader>
                    <h2>
                      <Hash size={16} />
                      Topics &amp; Concepts <ResultCount>{filteredFacets.topics.length}</ResultCount>
                    </h2>
                    <span>Click any topic to view matching papers</span>
                  </SectionHeader>
                  {filteredFacets.topics.length === 0 ? (
                    <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                      No indexed topics yet. Load an OpenAlex S3 partition or import BibTeX/DOI references to populate
                      topic facets.
                    </span>
                  ) : (
                    <FacetGrid>
                      {filteredFacets.topics.map((topic) => (
                        <FacetCard
                          key={topic.name}
                          type="button"
                          $tone="purple"
                          onClick={() => applyFacetFilter({ topic: topic.name })}
                          data-testid={`browse-topic-card-${topic.name}`}
                        >
                          <FacetText>
                            <div className="name">#{topic.name}</div>
                            <div className="sub">{topic.totalCitations.toLocaleString()} total citations</div>
                          </FacetText>
                          <Badge $tone="purple">
                            {topic.workCount} {topic.workCount === 1 ? "work" : "works"}
                          </Badge>
                        </FacetCard>
                      ))}
                    </FacetGrid>
                  )}
                </Section>
              )}

              {(browseCategory === "all" || browseCategory === "authors") && (
                <Section>
                  <SectionHeader>
                    <h2>
                      <Users size={16} />
                      Authors &amp; Researchers <ResultCount>{filteredFacets.authors.length}</ResultCount>
                    </h2>
                    <span>Click any author to filter works</span>
                  </SectionHeader>
                  {filteredFacets.authors.length === 0 ? (
                    <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>No indexed authors yet.</span>
                  ) : (
                    <FacetGrid>
                      {filteredFacets.authors.map((author) => (
                        <FacetCard
                          key={author.name}
                          type="button"
                          $tone="brand"
                          onClick={() => applyFacetFilter({ author: author.name })}
                          data-testid={`browse-author-card-${author.name}`}
                        >
                          <FacetText>
                            <div className="name">{author.name}</div>
                            <div className="sub">
                              {author.affiliation || `${author.totalCitations.toLocaleString()} citations`}
                            </div>
                          </FacetText>
                          <Badge $tone="brand">
                            {author.workCount} {author.workCount === 1 ? "work" : "works"}
                          </Badge>
                        </FacetCard>
                      ))}
                    </FacetGrid>
                  )}
                </Section>
              )}

              {(browseCategory === "all" || browseCategory === "venues") && (
                <Section>
                  <SectionHeader>
                    <h2>
                      <BookOpen size={16} />
                      Journals, Conferences &amp; Venues <ResultCount>{filteredFacets.venues.length}</ResultCount>
                    </h2>
                  </SectionHeader>
                  {filteredFacets.venues.length === 0 ? (
                    <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>No indexed venues yet.</span>
                  ) : (
                    <FacetGrid $cols={2}>
                      {filteredFacets.venues.map((venue) => (
                        <FacetCard
                          key={venue.name}
                          type="button"
                          $tone="success"
                          onClick={() => applyFacetFilter({ venue: venue.name })}
                        >
                          <FacetText>
                            <div className="name">{venue.name}</div>
                            <div className="sub">{venue.totalCitations.toLocaleString()} total citations</div>
                          </FacetText>
                          <Badge $tone="success">
                            {venue.workCount} {venue.workCount === 1 ? "work" : "works"}
                          </Badge>
                        </FacetCard>
                      ))}
                    </FacetGrid>
                  )}
                </Section>
              )}

              {(browseCategory === "all" || browseCategory === "years") && filteredFacets.years.length > 0 && (
                <Section>
                  <SectionHeader>
                    <h2>
                      <Calendar size={16} />
                      Publication Year <ResultCount>{filteredFacets.years.length}</ResultCount>
                    </h2>
                  </SectionHeader>
                  <BadgeRow style={{ gap: 6 }}>
                    {filteredFacets.years.map((y) => (
                      <Chip
                        key={y.year}
                        type="button"
                        $tone="warning"
                        onClick={() => applyFacetFilter({ year: y.year })}
                      >
                        {y.year} <span style={{ opacity: 0.6 }}>{y.count}</span>
                      </Chip>
                    ))}
                  </BadgeRow>
                </Section>
              )}

              {browseCategory === "all" && facets && facets.communityCited.length > 0 && (
                <Section>
                  <SectionHeader>
                    <h2>
                      <MessageSquareQuote size={16} />
                      Cited in Ansatz Posts &amp; Notebooks <ResultCount>{facets.communityCited.length}</ResultCount>
                    </h2>
                  </SectionHeader>
                  <FacetGrid $cols={2}>
                    {facets.communityCited.map((cw) => (
                      <FacetCard key={cw.urn} as={Link} to={buildSourcePageUrl(cw.urn)} $tone="brand">
                        <FacetText>
                          <div className="name">{cw.title}</div>
                          <div className="sub">
                            {cw.authors.map((a) => a.name).join(", ")}
                            {cw.publicationYear ? ` · ${cw.publicationYear}` : ""}
                          </div>
                        </FacetText>
                        <Badge $tone="brand">
                          {cw.postCitationCount} {cw.postCitationCount === 1 ? "post" : "posts"}
                        </Badge>
                      </FacetCard>
                    ))}
                  </FacetGrid>
                </Section>
              )}
            </>
          )}
        </Box>
      ) : (
        /* Personal Reference Library Tab */
        <LibraryLayout>
          <LibrarySidebar>
            <SidebarLabel>Library</SidebarLabel>
            <SidebarItem $active={selectedCollectionId === null && !favoritesOnly && statusFilter === "all"}>
              <button
                type="button"
                className="main"
                onClick={() => {
                  setSelectedCollectionId(null);
                  setFavoritesOnly(false);
                  setStatusFilter("all");
                }}
              >
                <span>All Saved</span>
                <span className="count">{libraryItems.length}</span>
              </button>
            </SidebarItem>
            <SidebarItem $active={favoritesOnly} $tone="warning">
              <button type="button" className="main" onClick={() => setFavoritesOnly((v) => !v)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Star size={14} /> Starred
                </span>
              </button>
            </SidebarItem>

            <SidebarLabel>Reading Status</SidebarLabel>
            {[
              { id: "all", label: "All Statuses" },
              { id: "to_read", label: "To Read" },
              { id: "reading", label: "Currently Reading" },
              { id: "read", label: "Completed" },
            ].map((st) => (
              <SidebarItem key={st.id} $active={statusFilter === st.id}>
                <button type="button" className="main" onClick={() => setStatusFilter(st.id)}>
                  <span>{st.label}</span>
                </button>
              </SidebarItem>
            ))}

            <SidebarLabel>
              Collections
              <TextButton
                type="button"
                onClick={requireAuth(() => setShowNewCollectionInput((v) => !v))}
                data-testid="references-new-collection-toggle"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, textTransform: "none" }}
              >
                <FolderPlus size={12} /> New
              </TextButton>
            </SidebarLabel>

            {showNewCollectionInput && (
              <NewCollectionForm onSubmit={(e) => void handleCreateCollection(e)}>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Collection name..."
                  aria-label="New collection name"
                  data-testid="references-new-collection-input"
                />
                <Button type="submit" size="small" variant="primary" data-testid="references-new-collection-submit">
                  Add
                </Button>
              </NewCollectionForm>
            )}

            {collections.map((col) => (
              <SidebarItem key={col.id} $active={selectedCollectionId === col.id}>
                <button
                  type="button"
                  className="main"
                  onClick={() => setSelectedCollectionId((prev) => (prev === col.id ? null : col.id))}
                >
                  <span>📁 {col.name}</span>
                  <span className="count">{col.itemCount}</span>
                </button>
                <IconButton
                  type="button"
                  $danger
                  onClick={() => void handleDeleteCollection(col.id)}
                  title="Delete collection"
                  aria-label={`Delete collection ${col.name}`}
                  style={{ width: 24, height: 24 }}
                >
                  <Trash2 size={12} />
                </IconButton>
              </SidebarItem>
            ))}
          </LibrarySidebar>

          <LibraryMain>
            {!token ? (
              <EmptyState>
                <Library size={48} />
                <h2>Sign in to manage your Reference Library</h2>
                <p>
                  Organize OpenAlex papers and Ansatz packages into collections, track reading status, write research
                  notes, and export BibTeX/RIS bibliographies.
                </p>
                <Button variant="primary" onClick={() => navigate("/login")}>
                  Sign In
                </Button>
              </EmptyState>
            ) : libraryLoading ? (
              <EmptyState>
                <p>Loading your Reference Library…</p>
              </EmptyState>
            ) : libraryItems.length === 0 ? (
              <EmptyState>
                <BookOpen size={48} />
                <h2>Your Reference Library is empty</h2>
                <p>Save works from the Search tab or import a BibTeX / RIS file to get started.</p>
                <EmptyActions>
                  <Button size="small" variant="primary" leadingVisual={Search} onClick={() => selectTab("discover")}>
                    Find references
                  </Button>
                  <Button size="small" leadingVisual={Upload} onClick={requireAuth(() => setShowImportModal(true))}>
                    Import
                  </Button>
                </EmptyActions>
              </EmptyState>
            ) : (
              <Box data-testid="references-personal-library-list">
                {libraryItems.map((item) => {
                  const target = buildCitationFromScholarlyWork(item.work);
                  const sourceUrl = buildSourcePageUrl(item.work.urn);
                  const isNotesOpen = expandedNotesId === item.id;

                  return (
                    <ResultRow key={item.id} data-testid={`library-item-card-${item.id}`}>
                      <RowTop>
                        <RowMain>
                          <BadgeRow>
                            <IconButton
                              type="button"
                              $active={item.isFavorite}
                              onClick={() => void handleUpdateLibraryItem(item, { isFavorite: !item.isFavorite })}
                              title="Toggle favorite"
                              aria-label="Toggle favorite"
                              aria-pressed={item.isFavorite}
                              style={{ width: 24, height: 24 }}
                            >
                              <Star size={15} fill={item.isFavorite ? "currentColor" : "none"} />
                            </IconButton>
                            <UrnCode>{item.work.urn}</UrnCode>
                            <InlineSelect
                              value={item.readingStatus}
                              onChange={(e) =>
                                void handleUpdateLibraryItem(item, {
                                  readingStatus: e.target.value as ReferenceLibraryItemDto["readingStatus"],
                                })
                              }
                              aria-label="Reading status"
                            >
                              <option value="to_read">📋 To Read</option>
                              <option value="reading">📖 Reading</option>
                              <option value="read">✅ Read</option>
                              <option value="archived">📦 Archived</option>
                            </InlineSelect>
                          </BadgeRow>

                          <RowTitle as={Link} to={sourceUrl}>
                            {item.work.title}
                          </RowTitle>
                          <MetaLine>
                            {(item.work.authors || []).map((a) => a.name).join(", ")}
                            {item.work.publicationYear ? ` · ${item.work.publicationYear}` : ""}
                            {item.work.venueName ? ` · ${item.work.venueName}` : ""}
                          </MetaLine>
                        </RowMain>

                        <RowActions>
                          <CiteButton target={target} label="Cite" variant="button" />
                          <ActionButton
                            type="button"
                            onClick={() => {
                              setExpandedNotesId(isNotesOpen ? null : item.id);
                              setNotesDraft((prev) => ({ ...prev, [item.id]: item.notes || "" }));
                            }}
                          >
                            Notes
                          </ActionButton>
                          <ActionLink as={Link} to={sourceUrl} $primary>
                            Source Page
                            <ExternalLink size={12} />
                          </ActionLink>
                          <IconButton
                            type="button"
                            $danger
                            onClick={() => void handleDeleteLibraryItem(item.id)}
                            title="Remove from library"
                            aria-label="Remove from library"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </RowActions>
                      </RowTop>

                      {isNotesOpen && (
                        <NotesBox>
                          <TextArea
                            rows={3}
                            value={notesDraft[item.id] ?? item.notes}
                            onChange={(e) => setNotesDraft((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Write private research notes, equations, or summary points for this paper..."
                          />
                          <ModalFooter>
                            <Button
                              size="small"
                              variant="primary"
                              onClick={() => {
                                void handleUpdateLibraryItem(item, { notes: notesDraft[item.id] ?? item.notes });
                                setExpandedNotesId(null);
                              }}
                            >
                              Save Notes
                            </Button>
                          </ModalFooter>
                        </NotesBox>
                      )}
                    </ResultRow>
                  );
                })}
              </Box>
            )}
          </LibraryMain>
        </LibraryLayout>
      )}

      {/* Import Modal (BibTeX, RIS, DOI/URN) */}
      {showImportModal && (
        <ModalOverlay onClick={() => setShowImportModal(false)}>
          <ModalCard
            role="dialog"
            aria-modal="true"
            aria-label="Import scholarly references"
            data-testid="references-import-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <ModalHeader>
              <h2>Import Scholarly References</h2>
              <IconButton type="button" aria-label="Close" onClick={() => setShowImportModal(false)}>
                <X size={16} />
              </IconButton>
            </ModalHeader>

            <FilterPillBar>
              {(
                [
                  { id: "identifiers", label: "DOIs / URNs / arXiv IDs" },
                  { id: "bibtex", label: "BibTeX (.bib)" },
                  { id: "ris", label: "RIS (.ris)" },
                ] as const
              ).map((m) => (
                <FilterPill
                  key={m.id}
                  type="button"
                  $active={importMode === m.id}
                  onClick={() => setImportMode(m.id)}
                  data-testid={`references-import-mode-${m.id}`}
                >
                  {m.label}
                </FilterPill>
              ))}
            </FilterPillBar>

            <form
              onSubmit={(e) => void handleImportSubmit(e)}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <TextArea
                $mono
                rows={7}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                data-testid="references-import-textarea"
                placeholder={
                  importMode === "bibtex"
                    ? "@article{elmqvist2000modelica,\n  author = {Hilding Elmqvist},\n  title = {Modelica},\n  year = {2000}\n}"
                    : importMode === "ris"
                      ? "TY  - JOUR\nTI  - Modelica Unified Language\nAU  - Elmqvist, Hilding\nPY  - 2000\nER  - "
                      : "Enter one or more DOIs, OpenAlex IDs, arXiv IDs, or URNs (e.g. 10.1016/j.jcp.2018.10.045, urn:openalex:W2108598243, arxiv:1706.03762)"
                }
              />
              <ModalFooter>
                <Button type="button" onClick={() => setShowImportModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={importing} data-testid="references-import-submit-btn">
                  {importing ? "Importing..." : "Import References"}
                </Button>
              </ModalFooter>
            </form>
          </ModalCard>
        </ModalOverlay>
      )}

      {/* Add Custom Source / Local PDF Modal */}
      {showCreateWorkModal && (
        <ModalOverlay onClick={() => setShowCreateWorkModal(false)}>
          <ModalCard
            role="dialog"
            aria-modal="true"
            aria-label="Register scholarly source"
            data-testid="references-create-work-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <ModalHeader>
              <h2>Register Scholarly Source &amp; Local PDF</h2>
              <IconButton type="button" aria-label="Close" onClick={() => setShowCreateWorkModal(false)}>
                <X size={16} />
              </IconButton>
            </ModalHeader>

            <form
              onSubmit={(e) => void handleCreateCustomWork(e)}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div>
                <FieldLabel htmlFor="ref-custom-title">Title *</FieldLabel>
                <Field
                  id="ref-custom-title"
                  type="text"
                  required
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  data-testid="references-custom-title-input"
                  placeholder="Paper, technical report, or standard title..."
                />
              </div>
              <FormGrid>
                <div>
                  <FieldLabel htmlFor="ref-custom-authors">Authors (comma-separated)</FieldLabel>
                  <Field
                    id="ref-custom-authors"
                    type="text"
                    value={customAuthors}
                    onChange={(e) => setCustomAuthors(e.target.value)}
                    placeholder="Hilding Elmqvist, Sven Erik Mattsson"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ref-custom-year">Publication Year</FieldLabel>
                  <Field
                    id="ref-custom-year"
                    type="number"
                    value={customYear}
                    onChange={(e) => setCustomYear(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ref-custom-venue">Journal / Venue / Publisher</FieldLabel>
                  <Field
                    id="ref-custom-venue"
                    type="text"
                    value={customVenue}
                    onChange={(e) => setCustomVenue(e.target.value)}
                    placeholder="IEEE Transactions / SIAM..."
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ref-custom-doi">DOI (optional)</FieldLabel>
                  <Field
                    id="ref-custom-doi"
                    type="text"
                    value={customDoi}
                    onChange={(e) => setCustomDoi(e.target.value)}
                    placeholder="10.1109/..."
                  />
                </div>
              </FormGrid>
              <div>
                <FieldLabel htmlFor="ref-custom-pdf" $tone="success">
                  Local Instance PDF URL (if stored on this Ansatz instance)
                </FieldLabel>
                <Field
                  id="ref-custom-pdf"
                  type="text"
                  value={customLocalPdf}
                  onChange={(e) => setCustomLocalPdf(e.target.value)}
                  data-testid="references-custom-local-pdf-input"
                  placeholder="/uploads/papers/my-paper.pdf"
                />
              </div>
              <div>
                <FieldLabel htmlFor="ref-custom-abstract">Abstract / Summary</FieldLabel>
                <TextArea
                  id="ref-custom-abstract"
                  rows={3}
                  value={customAbstract}
                  onChange={(e) => setCustomAbstract(e.target.value)}
                  placeholder="Full abstract or library description..."
                />
              </div>
              <ModalFooter>
                <Button type="button" onClick={() => setShowCreateWorkModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" data-testid="references-custom-submit-btn">
                  Create &amp; Open Source Page
                </Button>
              </ModalFooter>
            </form>
          </ModalCard>
        </ModalOverlay>
      )}
    </Box>
  );
};

export default ReferencesPage;
