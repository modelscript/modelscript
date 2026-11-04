// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon as ArrowLeft,
  TrophyIcon as Award,
  BookmarkFillIcon as BookmarkCheck,
  BookmarkIcon as BookmarkPlus,
  BookIcon as BookOpen,
  OrganizationIcon as Building2,
  CalendarIcon as Calendar,
  CheckIcon as Check,
  CopyIcon as Copy,
  DownloadIcon as Download,
  LinkExternalIcon as ExternalLink,
  FileCheckIcon as FileCheck2,
  FileIcon as FileText,
  GlobeIcon as Globe,
  DesktopDownloadIcon as HardDriveDownload,
  HashIcon as Hash,
  StackIcon as Layers,
  LinkIcon as Link2,
  CommentDiscussionIcon as MessageSquareQuote,
  PlusCircleIcon as PlusCircle,
  QuoteIcon as Quote,
  SparklesFillIcon as Sparkles,
  TagIcon as Tag,
  GraphIcon as TrendingUp,
  UploadIcon as Upload,
} from "@primer/octicons-react";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  attachLocalPdfToWork,
  resolveCitationSource,
  saveToReferenceLibrary,
  type ResolvedSourceResponseDto,
  type ScholarlyWorkDto,
} from "../api/references";
import { useAuth } from "../AuthContext";
import { CiteButton } from "../components/citations/CiteButton";
import { ToastContext } from "../components/ToastContext";
import {
  buildCitationFromScholarlyWork,
  buildSourcePageUrl,
  exportCitation,
  formatCitation,
  normalizeCitationUrn,
  type CitationStyleId,
} from "../util/citations";
import { usePageTitle } from "../util/title";
import {
  Abstract,
  ALink,
  AuthorChip,
  Badge,
  BadgeLink,
  Bar,
  BarFill,
  Bars,
  BarTrack,
  Card,
  Clamp,
  Crumbs,
  Divider,
  FieldGrid,
  FieldLabel,
  FieldValue,
  Grid,
  H1,
  H2,
  Hero,
  Input,
  MetaStrip,
  Muted,
  Page,
  PdfBar,
  PdfFrame,
  RLink,
  Row,
  Scroll,
  SkeletonBlock,
  SmallALink,
  Stack,
  Subtitle,
  Text,
  TextButton,
  Tile,
  TileLink,
  TopBar,
} from "./sourceDetailUi";

export const SourceDetailPage: React.FC = () => {
  const params = useParams<{ identifier?: string; "*"?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { token } = useAuth();
  const toastCtx = useContext(ToastContext);
  const addToast = useCallback(
    (msg: string, type: "success" | "error" | "info" | "warning" = "info") => {
      toastCtx?.showToast(msg, type);
    },
    [toastCtx],
  );

  // Extract raw URN/identifier from route wildcard, `:identifier`, or `?urn=`
  const rawIdentifier = useMemo(() => {
    const fromQuery = searchParams.get("urn") || searchParams.get("id");
    if (fromQuery) return fromQuery;
    const pathAfterSources = location.pathname.replace(/^\/sources\/?/i, "");
    if (pathAfterSources) {
      try {
        return decodeURIComponent(pathAfterSources);
      } catch {
        return pathAfterSources;
      }
    }
    return params.identifier || params["*"] || "";
  }, [searchParams, location.pathname, params]);

  const normalizedUrn = useMemo(() => normalizeCitationUrn(rawIdentifier), [rawIdentifier]);

  const [resolved, setResolved] = useState<ResolvedSourceResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeInlineStyle, setActiveInlineStyle] = useState<CitationStyleId>("apa");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showInlinePdfViewer, setShowInlinePdfViewer] = useState(false);
  const [showAttachPdfForm, setShowAttachPdfForm] = useState(false);
  const [newLocalPdfInput, setNewLocalPdfInput] = useState("");
  const [attachingPdf, setAttachingPdf] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [savedInLibrary, setSavedInLibrary] = useState(false);

  usePageTitle(resolved?.work?.title ? `${resolved.work.title} — Source Catalog` : `Source ${normalizedUrn}`);

  useEffect(() => {
    if (normalizedUrn.startsWith("urn:ansatz:post:")) {
      const postId = normalizedUrn.slice("urn:ansatz:post:".length).trim();
      if (postId) {
        navigate(`/posts/${encodeURIComponent(postId)}`, { replace: true });
        return;
      }
    }

    let cancelled = false;
    async function loadSource() {
      if (!rawIdentifier) {
        setError("No citation URN or identifier specified.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await resolveCitationSource(rawIdentifier);
        if (!cancelled) {
          setResolved(data);
          setSavedInLibrary(Boolean(data.libraryItem));
          setNewLocalPdfInput(data.work.localPdfUrl || "");
        }
      } catch (err) {
        if (!cancelled) {
          const resError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(resError || "Failed to resolve citation URN.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadSource();
    return () => {
      cancelled = true;
    };
  }, [rawIdentifier]);

  const work: ScholarlyWorkDto | null = resolved?.work ?? null;

  const citationTarget = useMemo(() => {
    if (!work) return null;
    return buildCitationFromScholarlyWork(work);
  }, [work]);

  const handleCopy = (text: string, key: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedField(key);
    addToast(`Copied ${label} to clipboard`, "success");
    setTimeout(() => {
      setCopiedField((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const handleSaveToLibrary = async () => {
    if (!work) return;
    if (!token) {
      addToast("Sign in to save sources to your personal Reference Library", "info");
      return;
    }
    setSavingLibrary(true);
    try {
      await saveToReferenceLibrary({ urn: work.urn, workId: work.id });
      setSavedInLibrary(true);
      addToast("Saved to your Reference Library", "success");
    } catch {
      addToast("Failed to save to Reference Library", "error");
    } finally {
      setSavingLibrary(false);
    }
  };

  const handleAttachLocalPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!work || !newLocalPdfInput.trim()) return;
    setAttachingPdf(true);
    try {
      const { work: updatedWork } = await attachLocalPdfToWork({
        urn: work.urn,
        localPdfUrl: newLocalPdfInput.trim(),
      });
      setResolved((prev) => (prev ? { ...prev, work: updatedWork } : prev));
      setShowAttachPdfForm(false);
      addToast("Attached local instance PDF to source record", "success");
    } catch {
      addToast("Failed to attach local PDF", "error");
    } finally {
      setAttachingPdf(false);
    }
  };

  const handleCiteInNewPost = () => {
    if (!work) return;
    const tag = `[@${work.urn}]`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(tag);
    }
    navigate(`/?cite=${encodeURIComponent(work.urn)}`);
    addToast(`Prepared post citation ${tag}`, "info");
  };

  if (loading) {
    return (
      <Page style={{ paddingTop: 32 }} data-testid="source-detail-loading">
        <Stack $gap={16}>
          <SkeletonBlock $h={20} $w="192px" />
          <SkeletonBlock $h={36} $w="75%" />
          <SkeletonBlock $h={16} $w="50%" />
          <SkeletonBlock $h={144} />
          <SkeletonBlock $h={192} />
        </Stack>
      </Page>
    );
  }

  if (error || !work || !citationTarget) {
    return (
      <Page style={{ maxWidth: 768, paddingTop: 48 }} data-testid="source-detail-error">
        <Card style={{ padding: 24 }}>
          <H2 style={{ fontSize: 15, color: "var(--ms-warning)" }}>
            <BookOpen size={18} />
            <span>Source Not Found</span>
          </H2>
          <Text $muted>{error || `Unable to resolve scholarly source for identifier '${rawIdentifier}'.`}</Text>
          <Row>
            {normalizedUrn.startsWith("urn:ansatz:post:") ? (
              <RLink
                to={`/posts/${encodeURIComponent(normalizedUrn.slice("urn:ansatz:post:".length))}`}
                $variant="primary"
              >
                <span>View Post #{normalizedUrn.slice("urn:ansatz:post:".length)}</span>
              </RLink>
            ) : (
              <RLink to="/references" $variant="primary">
                <ArrowLeft size={14} />
                <span>Browse Reference Manager</span>
              </RLink>
            )}
          </Row>
        </Card>
      </Page>
    );
  }

  const maxYearCitation = Math.max(1, ...(work.countsByYear || []).map((c) => c.cited_by_count));
  const externalPdfLocations = (work.externalLocations || []).filter((loc) => loc.hostType !== "local_instance");
  const inlineCitationText =
    resolved?.citations?.[activeInlineStyle] || formatCitation(citationTarget, activeInlineStyle);

  return (
    <Page data-testid="source-detail-page">
      {/* Top Breadcrumb & Back Bar */}
      <TopBar>
        <Crumbs>
          <RLink to="/references" $variant="ghost" style={{ padding: "0 8px", margin: "0 -8px" }}>
            <ArrowLeft size={15} />
            <span>Scholarly Reference Library</span>
          </RLink>
          <span aria-hidden>/</span>
          <Code data-testid="source-page-urn-breadcrumb">{work.urn}</Code>
        </Crumbs>

        <Row>
          <CiteButton
            target={citationTarget}
            label="Cite & Export"
            variant="button"
            size="md"
            testId="source-page-cite-btn"
          />
          <Button
            type="button"
            onClick={() => void handleSaveToLibrary()}
            disabled={savingLibrary || savedInLibrary}
            data-testid="source-page-save-library-btn"
          >
            {savedInLibrary ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}
            <span>{savedInLibrary ? "In Your Library" : "Save to Library"}</span>
          </Button>
          <Button
            type="button"
            $variant="primary"
            onClick={handleCiteInNewPost}
            data-testid="source-page-cite-in-post-btn"
          >
            <MessageSquareQuote size={14} />
            <span>Cite in Post</span>
          </Button>
        </Row>
      </TopBar>

      {/* Main Bibliographic Hero Card */}
      <Hero>
        <Row $gap={6}>
          <Badge $tone="brand">
            <BookOpen size={11} />
            {work.workType}
          </Badge>

          {work.localPdfUrl && (
            <Badge $tone="success" data-testid="source-local-instance-badge">
              <FileCheck2 size={11} />
              Local Instance PDF Available
            </Badge>
          )}

          {work.isOa && (
            <Badge $tone="warn">
              <Globe size={11} />
              Open Access {work.oaStatus ? `(${work.oaStatus.toUpperCase()})` : ""}
            </Badge>
          )}

          {work.openalexId && (
            <Badge $mono $tone="neutral">
              OpenAlex: {work.openalexId}
            </Badge>
          )}

          {work.doi && (
            <BadgeLink
              $mono
              $tone="brand"
              href={`https://doi.org/${work.doi}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              DOI: {work.doi}
              <ExternalLink size={10} />
            </BadgeLink>
          )}
        </Row>

        <div>
          <H1 data-testid="source-detail-title">{work.title}</H1>
          {work.subtitle && <Subtitle>{work.subtitle}</Subtitle>}
        </div>

        <Row data-testid="source-detail-authors">
          {(work.authors || []).map((author, idx) => (
            <AuthorChip key={`${author.name}-${idx}`}>
              {author.username ? (
                <Link to={`/${author.username}`} style={{ color: "var(--ms-brand)" }}>
                  {author.name} (@{author.username})
                </Link>
              ) : (
                <Link
                  to={`/references?author=${encodeURIComponent(author.name)}`}
                  title={`Browse works by ${author.name}`}
                >
                  {author.name}
                </Link>
              )}
              {author.affiliation && (
                <Muted>
                  <Building2 size={11} />
                  {author.affiliation}
                </Muted>
              )}
              {author.orcid && (
                <a
                  href={`https://orcid.org/${author.orcid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`ORCID ${author.orcid}`}
                  style={{ color: "var(--ms-success)", fontFamily: "monospace", fontSize: 10 }}
                >
                  ORCID
                </a>
              )}
            </AuthorChip>
          ))}
        </Row>

        {/* Publication Venue, Year, Metrics Strip */}
        <MetaStrip>
          {work.publicationYear && (
            <Link to={`/references?year=${work.publicationYear}`}>
              <Calendar size={13} />
              <strong>{work.publicationYear}</strong>
            </Link>
          )}
          {work.venueName && (
            <Link to={`/references?venue=${encodeURIComponent(work.venueName)}`}>
              <Layers size={13} />
              <span>
                <strong>{work.venueName}</strong>
                {work.volume ? ` · Vol. ${work.volume}` : ""}
                {work.issue ? ` (${work.issue})` : ""}
                {work.pages ? `, pp. ${work.pages}` : ""}
              </span>
            </Link>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <TrendingUp size={13} />
            <span>
              <strong>{work.citedByCount.toLocaleString()}</strong> citations
            </span>
          </span>
          {typeof work.fwci === "number" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Award size={13} />
              <span>
                FWCI: <strong>{work.fwci.toFixed(2)}</strong>
              </span>
            </span>
          )}
          <Row $gap={4} style={{ marginLeft: "auto" }}>
            <Code style={{ color: "var(--ms-brand)" }}>[@{work.urn}]</Code>
            <IconButton
              type="button"
              $success={copiedField === "hero-post-tag"}
              onClick={() => handleCopy(`[@${work.urn}]`, "hero-post-tag", "in-post citation tag")}
              aria-label="Copy post tag"
              title="Copy post tag"
              style={{ width: 28, height: 28 }}
            >
              {copiedField === "hero-post-tag" ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </Row>
        </MetaStrip>
      </Hero>

      {/* Full-Text PDF & External Hosting Section */}
      <Grid>
        {/* Local Instance Storage Card */}
        <Card
          $tone={work.localPdfUrl ? "success" : undefined}
          data-testid="source-local-pdf-card"
          style={{ justifyContent: "space-between" }}
        >
          <Stack>
            <Row $between $wrap={false}>
              <H2>
                <HardDriveDownload size={18} style={work.localPdfUrl ? { color: "var(--ms-success)" } : undefined} />
                Ansatz Instance Full-Text Storage
              </H2>
              {token && (
                <TextButton
                  type="button"
                  onClick={() => setShowAttachPdfForm((v) => !v)}
                  data-testid="source-toggle-attach-pdf-btn"
                >
                  <Upload size={11} />
                  <span>{work.localPdfUrl ? "Update Local PDF" : "Attach Local PDF"}</span>
                </TextButton>
              )}
            </Row>

            {work.localPdfUrl ? (
              <Text $size={12.5} $muted>
                A verified full-text PDF copy of this source is stored locally on this Ansatz instance (
                <Code style={{ color: "var(--ms-success)" }}>{work.localPdfUrl}</Code>) for air-gapped and zero-latency
                access.
              </Text>
            ) : (
              <Text $size={12.5} $muted>
                No local PDF mirror is stored on this instance yet. Use the external full-text links on the right, or
                attach a local PDF path to host it directly on this node.
              </Text>
            )}
          </Stack>

          {showAttachPdfForm && (
            <form onSubmit={(e) => void handleAttachLocalPdf(e)}>
              <Stack>
                <FieldLabel as="label" htmlFor="source-attach-pdf-input">
                  Local Instance PDF Path or Artifact URL
                </FieldLabel>
                <Row $wrap={false}>
                  <Input
                    id="source-attach-pdf-input"
                    type="text"
                    value={newLocalPdfInput}
                    onChange={(e) => setNewLocalPdfInput(e.target.value)}
                    placeholder="/uploads/papers/paper.pdf"
                    data-testid="source-attach-pdf-input"
                  />
                  <Button
                    type="submit"
                    $variant="primary"
                    disabled={attachingPdf}
                    data-testid="source-attach-pdf-submit"
                  >
                    {attachingPdf ? "Saving..." : "Save PDF"}
                  </Button>
                </Row>
              </Stack>
            </form>
          )}

          <Row>
            {work.localPdfUrl ? (
              <>
                <Button
                  type="button"
                  $variant="primary"
                  onClick={() => setShowInlinePdfViewer((v) => !v)}
                  data-testid="source-toggle-inline-pdf-btn"
                >
                  <FileText size={14} />
                  <span>{showInlinePdfViewer ? "Hide Inline PDF Reader" : "Read Local PDF Inline"}</span>
                </Button>
                <ALink
                  href={work.localPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="source-open-local-pdf-link"
                >
                  <span>Open</span>
                  <ExternalLink size={12} />
                </ALink>
                <ALink href={work.localPdfUrl} download $variant="ghost">
                  <Download size={12} />
                  <span>Download</span>
                </ALink>
              </>
            ) : (
              work.ansatzEntityType &&
              work.ansatzEntityType !== "work" &&
              work.canonicalUrl && (
                <RLink to={work.canonicalUrl} $variant="primary" data-testid="source-open-native-entity-link">
                  <span>Open Native {work.ansatzEntityType} on Ansatz</span>
                  <ExternalLink size={13} />
                </RLink>
              )
            )}
          </Row>
        </Card>

        {/* External Full-Text & Publisher Hosts Card */}
        <Card data-testid="source-external-locations">
          <H2>
            <Globe size={18} />
            External Full-Text &amp; Publisher Sites ({externalPdfLocations.length})
          </H2>

          {externalPdfLocations.length === 0 ? (
            <Text $size={12.5} $muted>
              No external repository links recorded for this item.
            </Text>
          ) : (
            <Scroll>
              {externalPdfLocations.map((loc, idx) => (
                <Tile key={`${loc.source}-${idx}`}>
                  <Row $between $wrap={false}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Row $gap={6}>
                        <strong style={{ fontSize: 12.5 }}>{loc.source}</strong>
                        <Badge $tone="neutral" style={{ height: 18, fontSize: 10 }}>
                          {loc.hostType}
                        </Badge>
                        {loc.isOa && (
                          <Badge $tone="success" style={{ height: 18, fontSize: 10 }}>
                            OA
                          </Badge>
                        )}
                      </Row>
                      {loc.version && <Muted style={{ fontSize: 11 }}>{loc.version}</Muted>}
                    </div>
                    <Row $gap={6} $wrap={false}>
                      {loc.pdfUrl && (
                        <SmallALink
                          href={loc.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          $variant="primary"
                          data-testid={`source-external-pdf-link-${idx}`}
                        >
                          <FileText size={11} />
                          <span>Full PDF</span>
                        </SmallALink>
                      )}
                      {loc.landingPageUrl && (
                        <SmallALink
                          href={loc.landingPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`source-external-landing-link-${idx}`}
                        >
                          <span>Site</span>
                          <ExternalLink size={10} />
                        </SmallALink>
                      )}
                    </Row>
                  </Row>
                </Tile>
              ))}
            </Scroll>
          )}
        </Card>
      </Grid>

      {/* Inline Local PDF Reader (when toggled open) */}
      {showInlinePdfViewer && work.localPdfUrl && (
        <PdfFrame data-testid="source-inline-pdf-viewer">
          <PdfBar>
            <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ms-success)" }}>
              <FileText size={14} />
              Local Instance PDF Reader — {work.title}
            </span>
            <a href={work.localPdfUrl} target="_blank" rel="noopener noreferrer">
              Open Fullscreen ↗
            </a>
          </PdfBar>
          <iframe src={work.localPdfUrl} title={`PDF Viewer - ${work.title}`} />
        </PdfFrame>
      )}

      {/* Abstract / Full Description & Research Concepts */}
      <Card style={{ padding: 24 }}>
        <H2 style={{ fontSize: 15 }}>
          <BookOpen size={16} />
          <span>Abstract &amp; Full Description</span>
        </H2>
        <Abstract data-testid="source-detail-abstract">
          {work.abstract || "No abstract text provided for this catalog record."}
        </Abstract>

        {work.concepts && work.concepts.length > 0 && (
          <>
            <Divider />
            <FieldLabel style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Tag size={12} />
              <span>OpenAlex Research Topics &amp; Concepts</span>
            </FieldLabel>
            <ChipRow style={{ flexWrap: "wrap", overflow: "visible" }}>
              {work.concepts.map((concept, idx) => (
                <Chip
                  key={`${concept.name}-${idx}`}
                  as={Link}
                  to={`/references?topic=${encodeURIComponent(concept.name)}`}
                  $active={false}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    textDecoration: "none",
                    lineHeight: "26px",
                  }}
                >
                  <span>{concept.name}</span>
                  {typeof concept.score === "number" && (
                    <span style={{ fontSize: 10, color: "var(--ms-text-3)" }}>{Math.round(concept.score * 100)}%</span>
                  )}
                </Chip>
              ))}
            </ChipRow>
          </>
        )}
      </Card>

      {/* Library Catalog Record Metadata & Citation Trajectory */}
      <Grid $cols="3">
        <Card>
          <H2>
            <Hash size={15} />
            <span>Library Catalog Metadata</span>
          </H2>
          <FieldGrid>
            <Tile>
              <FieldLabel>Canonical URN</FieldLabel>
              <FieldValue $mono $brand $truncate>
                {work.urn}
              </FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>BibTeX Citation Key</FieldLabel>
              <FieldValue $mono>{work.citationKey}</FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>Venue / Journal</FieldLabel>
              <FieldValue>{work.venueName || "—"}</FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>Publisher</FieldLabel>
              <FieldValue>{work.publisher || "—"}</FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>Publication Date</FieldLabel>
              <FieldValue>{work.publicationDate || work.publicationYear || "—"}</FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>Volume / Issue / Pages</FieldLabel>
              <FieldValue>
                {[
                  work.volume ? `Vol. ${work.volume}` : null,
                  work.issue ? `No. ${work.issue}` : null,
                  work.pages ? `pp. ${work.pages}` : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>DOI / OpenAlex / arXiv</FieldLabel>
              <FieldValue $mono $truncate>
                {work.doi || work.openalexId || work.arxivId || "—"}
              </FieldValue>
            </Tile>
            <Tile>
              <FieldLabel>License &amp; Access</FieldLabel>
              <FieldValue>{work.license || (work.isOa ? "Open Access" : "Standard Copyright")}</FieldValue>
            </Tile>
          </FieldGrid>
        </Card>

        {/* Citation Velocity by Year */}
        <Card style={{ justifyContent: "space-between" }}>
          <div>
            <H2>
              <TrendingUp size={15} />
              <span>Citations by Year</span>
            </H2>
            <Text $size={11.5} $muted style={{ marginTop: 4 }}>
              {work.citedByCount.toLocaleString()} total scholarly citations tracked via OpenAlex
            </Text>
          </div>

          {work.countsByYear && work.countsByYear.length > 0 ? (
            <Bars>
              {work.countsByYear.slice(-8).map((item) => {
                const heightPct = Math.max(10, Math.round((item.cited_by_count / maxYearCitation) * 100));
                return (
                  <Bar key={item.year}>
                    <span>{item.cited_by_count}</span>
                    <BarTrack>
                      <BarFill style={{ height: `${heightPct}%` }} />
                    </BarTrack>
                    <span>{item.year}</span>
                  </Bar>
                );
              })}
            </Bars>
          ) : (
            <Text $size={12.5} $muted style={{ padding: "32px 0", textAlign: "center" }}>
              Annual citation breakdown not yet indexed.
            </Text>
          )}
        </Card>
      </Grid>

      {/* Instant Citation Formatter & Export Strip on Page */}
      <Card>
        <Row $between>
          <H2>
            <Quote size={15} />
            Cite This Source
          </H2>
          <ChipRow>
            {(["apa", "ieee", "mla", "chicago", "ansatz-urn"] as CitationStyleId[]).map((st) => (
              <Chip key={st} type="button" $active={activeInlineStyle === st} onClick={() => setActiveInlineStyle(st)}>
                {st.toUpperCase()}
              </Chip>
            ))}
          </ChipRow>
        </Row>

        <Preview>
          <PreviewText data-testid="source-inline-citation" style={{ paddingRight: 48, paddingTop: 12 }}>
            {inlineCitationText}
          </PreviewText>
          <PreviewCopy>
            <IconButton
              type="button"
              $success={copiedField === "inline-cite-box"}
              onClick={() => handleCopy(inlineCitationText, "inline-cite-box", activeInlineStyle.toUpperCase())}
              aria-label="Copy citation"
              title="Copy citation"
            >
              {copiedField === "inline-cite-box" ? <Check size={16} /> : <Copy size={16} />}
            </IconButton>
          </PreviewCopy>
        </Preview>

        <Row $between>
          <Text $size={12} $muted>
            Machine-readable bibliography exports:
          </Text>
          <Row $gap={6}>
            {(["bibtex", "ris", "csl-json", "cff", "enw"] as const).map((fmt) => (
              <Button
                key={fmt}
                type="button"
                style={{ height: 28, fontSize: 12 }}
                onClick={() =>
                  handleCopy(
                    resolved?.exports?.[fmt] || exportCitation(citationTarget, fmt),
                    `exp-${fmt}`,
                    fmt.toUpperCase(),
                  )
                }
              >
                {copiedField === `exp-${fmt}` ? <Check size={12} /> : <Copy size={12} />}
                <span>{fmt.toUpperCase()}</span>
              </Button>
            ))}
          </Row>
        </Row>
      </Card>

      {/* Backlinks: Ansatz Posts Citing This Source */}
      <Card data-testid="source-cited-by-posts">
        <Row $between>
          <H2>
            <MessageSquareQuote size={16} />
            <span>Cited in Ansatz Posts ({resolved?.citedByPosts?.length || 0})</span>
          </H2>
          <TextButton type="button" onClick={handleCiteInNewPost}>
            <PlusCircle size={13} />
            <span>Write a post citing this source</span>
          </TextButton>
        </Row>

        {!resolved?.citedByPosts || resolved.citedByPosts.length === 0 ? (
          <Tile style={{ padding: 16, color: "var(--ms-text-2)", lineHeight: 1.6 }}>
            No public posts on this Ansatz instance have cited <Code>[@{work.urn}]</Code> yet. Include{" "}
            <Code>[@{work.urn}]</Code> in any post to automatically link back to this source page!
          </Tile>
        ) : (
          <Stack>
            {resolved.citedByPosts.map((post) => (
              <TileLink key={post.id} to={`/${post.author.username}/status/${post.id}`}>
                <Row $between style={{ fontSize: 12.5, marginBottom: 4 }}>
                  <strong>
                    {post.author.displayName} <Muted style={{ fontWeight: 400 }}>@{post.author.username}</Muted>
                  </strong>
                  <Muted style={{ fontSize: 11.5 }}>{new Date(post.createdAt).toLocaleDateString()}</Muted>
                </Row>
                <Clamp style={{ fontSize: 13, color: "var(--ms-text-2)" }}>{post.content}</Clamp>
              </TileLink>
            ))}
          </Stack>
        )}
      </Card>

      {/* Referenced & Related Scholarly Works */}
      {((resolved?.referencedWorks && resolved.referencedWorks.length > 0) ||
        (resolved?.relatedWorks && resolved.relatedWorks.length > 0)) && (
        <Grid>
          {resolved?.referencedWorks && resolved.referencedWorks.length > 0 && (
            <Card>
              <H2>
                <Link2 size={15} />
                <span>Referenced Sources ({resolved.referencedWorks.length})</span>
              </H2>
              <Stack>
                {resolved.referencedWorks.map((refWork) => (
                  <TileLink key={refWork.urn} to={buildSourcePageUrl(refWork.urn)}>
                    <Clamp $lines={1} style={{ fontSize: 13, fontWeight: 700 }}>
                      {refWork.title}
                    </Clamp>
                    <Text $size={11.5} $muted>
                      {refWork.authors.map((a) => a.name).join(", ")} · {refWork.publicationYear}
                    </Text>
                  </TileLink>
                ))}
              </Stack>
            </Card>
          )}

          {resolved?.relatedWorks && resolved.relatedWorks.length > 0 && (
            <Card>
              <H2>
                <Sparkles size={15} />
                <span>Related Scholarly Works ({resolved.relatedWorks.length})</span>
              </H2>
              <Stack>
                {resolved.relatedWorks.map((relWork) => (
                  <TileLink key={relWork.urn} to={buildSourcePageUrl(relWork.urn)}>
                    <Clamp $lines={1} style={{ fontSize: 13, fontWeight: 700 }}>
                      {relWork.title}
                    </Clamp>
                    <Text $size={11.5} $muted>
                      {relWork.authors.map((a) => a.name).join(", ")} · {relWork.publicationYear}
                    </Text>
                  </TileLink>
                ))}
              </Stack>
            </Card>
          )}
        </Grid>
      )}
    </Page>
  );
};

export default SourceDetailPage;
