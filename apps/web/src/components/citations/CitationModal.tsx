// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookmarkFillIcon,
  BookmarkIcon as BookmarkPlus,
  CheckIcon as Check,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon as Copy,
  DownloadIcon as Download,
  LinkExternalIcon as ExternalLink,
  FileCodeIcon as FileCode2,
  QuoteIcon as Quote,
  XIcon as X,
} from "@primer/octicons-react";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { saveToReferenceLibrary } from "../../api/references";
import { useAuth } from "../../AuthContext";
import {
  CITATION_EXPORT_FORMATS,
  CITATION_STYLES,
  exportCitation,
  formatCitation,
  type CitationExportFormatId,
  type CitationStyleId,
  type CitationTarget,
} from "../../util/citations";
import { ToastContext } from "../ToastContext";
import {
  Backdrop,
  Body,
  Button,
  buttonStyles,
  Chip,
  ChipRow,
  Code,
  Dialog,
  Disclosure,
  Eyebrow,
  Footer,
  FooterGroup,
  Header,
  IconButton,
  Meta,
  Preview,
  PreviewCode,
  PreviewCopy,
  PreviewLabel,
  PreviewText,
  QuickList,
  QuickRow,
  Segmented,
  SegmentedItem,
  SyntaxRow,
  Tag,
  Title,
} from "./citationUi";

const SourceLink = styled(Link)`
  ${buttonStyles("ghost")}
`;

const STYLE_STORAGE_KEY = "ansatz_citation_style";

const ENTITY_LABELS: Record<string, string> = {
  package: "Software Package",
  post: "Post",
  artifact: "Artifact",
  repo: "Repository",
};

export interface CitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  target?: CitationTarget;
  metadata?: CitationTarget;
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export const CitationModal: React.FC<CitationModalProps> = ({ isOpen, onClose, target: targetProp, metadata }) => {
  const target = (targetProp || metadata)!;
  const [activeTab, setActiveTab] = useState<"styles" | "exports">("styles");
  const [selectedStyle, setSelectedStyle] = useState<CitationStyleId>(() => {
    try {
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STYLE_STORAGE_KEY) : null;
      if (saved && CITATION_STYLES.some((s) => s.id === saved)) return saved as CitationStyleId;
    } catch {
      // ignore storage errors
    }
    return "apa";
  });
  const [selectedExport, setSelectedExport] = useState<CitationExportFormatId>("bibtex");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAllFormats, setShowAllFormats] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { token } = useAuth();
  const toastCtx = useContext(ToastContext);
  const addToast = (msg: string, type: "success" | "error" | "info" | "warning" = "info") => {
    toastCtx?.showToast(msg, type);
  };

  const formattedStyleText = useMemo(
    () => (target ? formatCitation(target, selectedStyle) : ""),
    [target, selectedStyle],
  );

  const exportFileContent = useMemo(
    () => (target ? exportCitation(target, selectedExport) : ""),
    [target, selectedExport],
  );

  const selectedExportMeta = useMemo(
    () => CITATION_EXPORT_FORMATS.find((f) => f.id === selectedExport) || CITATION_EXPORT_FORMATS[0]!,
    [selectedExport],
  );

  const open = isOpen && !!target;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc to close, focus management and a basic focus trap.
  useEffect(() => {
    if (!open) return;
    const onClose = () => onCloseRef.current();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const handleCopy = (text: string, key: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    addToast(`Copied ${label} to clipboard`, "success");
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const handleSelectStyle = (id: CitationStyleId) => {
    setSelectedStyle(id);
    try {
      localStorage.setItem(STYLE_STORAGE_KEY, id);
    } catch {
      // ignore storage errors
    }
  };

  const handleDownloadExport = (formatId: CitationExportFormatId = selectedExport) => {
    const fmtMeta = CITATION_EXPORT_FORMATS.find((f) => f.id === formatId) || CITATION_EXPORT_FORMATS[0]!;
    const content = exportCitation(target, formatId);
    const blob = new Blob([content], { type: fmtMeta.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${target.citationKey || "ansatz-citation"}.${fmtMeta.ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast(`Downloaded ${fmtMeta.label} (.${fmtMeta.ext})`, "success");
  };

  const handleSaveToLibrary = async () => {
    if (!token) {
      addToast("Sign in to save citations to your personal reference library", "info");
      return;
    }
    setSavingToLibrary(true);
    try {
      await saveToReferenceLibrary({ urn: target.urn });
      setSavedToLibrary(true);
      addToast("Saved to your Ansatz Reference Library", "success");
    } catch {
      addToast("Failed to save to Reference Library", "error");
    } finally {
      setSavingToLibrary(false);
    }
  };

  const inlinePostSyntax = `[@${target.urn}]`;
  const styleCopied = copiedKey === `style-${selectedStyle}`;
  const exportCopied = copiedKey === `exp-${selectedExport}`;
  const styleMeta = CITATION_STYLES.find((s) => s.id === selectedStyle);

  const modalContent = (
    <Backdrop
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      data-testid="citation-modal-backdrop"
    >
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Cite ${target.title}`}
        tabIndex={-1}
        data-testid="citation-modal"
        style={{ outline: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Header>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Eyebrow>
              <Quote size={12} />
              Cite this {ENTITY_LABELS[target.entityType as string] ?? "Scholarly Source"}
            </Eyebrow>
            <Title>{target.title}</Title>
            <Meta>
              {target.authors.map((a) => a.name).join(", ")} · {target.publicationYear} · {target.venueName}
            </Meta>
          </div>
          <IconButton
            type="button"
            onClick={onClose}
            aria-label="Close citation dialog"
            title="Close (Esc)"
            data-testid="citation-modal-close"
          >
            <X size={16} />
          </IconButton>
        </Header>

        <Body>
          <Segmented role="tablist" aria-label="Citation mode">
            <SegmentedItem
              type="button"
              role="tab"
              aria-selected={activeTab === "styles"}
              $active={activeTab === "styles"}
              onClick={() => setActiveTab("styles")}
              data-testid="citation-tab-styles"
            >
              <Quote size={14} />
              Citation
            </SegmentedItem>
            <SegmentedItem
              type="button"
              role="tab"
              aria-selected={activeTab === "exports"}
              $active={activeTab === "exports"}
              onClick={() => setActiveTab("exports")}
              data-testid="citation-tab-exports"
            >
              <FileCode2 size={14} />
              Export
            </SegmentedItem>
          </Segmented>

          {activeTab === "styles" ? (
            <>
              <ChipRow role="tablist" aria-label="Citation styles">
                {CITATION_STYLES.map((st) => (
                  <Chip
                    key={st.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedStyle === st.id}
                    $active={selectedStyle === st.id}
                    data-testid={`citation-style-pill-${st.id}`}
                    onClick={() => handleSelectStyle(st.id)}
                  >
                    {st.label}
                  </Chip>
                ))}
              </ChipRow>

              <Preview>
                <PreviewLabel>{styleMeta?.description}</PreviewLabel>
                <PreviewCopy>
                  <IconButton
                    type="button"
                    $success={styleCopied}
                    aria-label={styleCopied ? "Copied" : "Copy citation"}
                    title={styleCopied ? "Copied" : "Copy citation"}
                    data-testid="citation-copy-active-style"
                    onClick={() =>
                      handleCopy(formattedStyleText, `style-${selectedStyle}`, selectedStyle.toUpperCase())
                    }
                  >
                    {styleCopied ? <Check size={16} /> : <Copy size={16} />}
                  </IconButton>
                </PreviewCopy>
                <PreviewText data-testid="citation-formatted-output">{formattedStyleText}</PreviewText>
              </Preview>

              <Disclosure type="button" aria-expanded={showAllFormats} onClick={() => setShowAllFormats((v) => !v)}>
                {showAllFormats ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                {showAllFormats ? "Hide other formats" : "Show other formats"}
              </Disclosure>

              {showAllFormats && (
                <QuickList>
                  {(["apa", "mla", "ieee", "chicago"] as CitationStyleId[]).map((stId) => {
                    const text = formatCitation(target, stId);
                    const copied = copiedKey === `quick-${stId}`;
                    return (
                      <QuickRow key={stId}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Tag>{stId.toUpperCase()}</Tag>
                          <p>{text}</p>
                        </div>
                        <IconButton
                          type="button"
                          $success={copied}
                          onClick={() => handleCopy(text, `quick-${stId}`, stId.toUpperCase())}
                          aria-label={`Copy ${stId.toUpperCase()}`}
                          title={`Copy ${stId.toUpperCase()}`}
                        >
                          {copied ? <Check size={16} /> : <Copy size={16} />}
                        </IconButton>
                      </QuickRow>
                    );
                  })}
                </QuickList>
              )}

              <SyntaxRow>
                <span>In-post syntax</span>
                <Code data-testid="citation-modal-urn" title={target.urn}>
                  {inlinePostSyntax}
                </Code>
                <IconButton
                  type="button"
                  $success={copiedKey === "urn-inline"}
                  onClick={() => handleCopy(inlinePostSyntax, "urn-inline", "in-post citation tag")}
                  aria-label="Copy post tag"
                  title="Copy post tag"
                  data-testid="citation-copy-inline-urn"
                  style={{ width: 28, height: 28 }}
                >
                  {copiedKey === "urn-inline" ? <Check size={14} /> : <Copy size={14} />}
                </IconButton>
              </SyntaxRow>

              <SyntaxRow style={{ marginTop: "6px" }}>
                <span>Export formats</span>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  BibTeX, RIS, CSL-JSON, CFF, EndNote (.enw)
                </span>
                <Button
                  type="button"
                  $variant="ghost"
                  style={{ marginLeft: "auto", fontSize: "12px", padding: "2px 8px" }}
                  onClick={() => setActiveTab("exports")}
                >
                  Export files →
                </Button>
              </SyntaxRow>
            </>
          ) : (
            <>
              <ChipRow role="tablist" aria-label="Citation export formats">
                {CITATION_EXPORT_FORMATS.map((fmt) => (
                  <Chip
                    key={fmt.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedExport === fmt.id}
                    $active={selectedExport === fmt.id}
                    data-testid={`citation-export-pill-${fmt.id}`}
                    onClick={() => setSelectedExport(fmt.id)}
                  >
                    {fmt.label}
                  </Chip>
                ))}
              </ChipRow>

              <Preview>
                <PreviewLabel>
                  {selectedExportMeta.label} · .{selectedExportMeta.ext}
                </PreviewLabel>
                <PreviewCopy>
                  <IconButton
                    type="button"
                    $success={exportCopied}
                    aria-label={exportCopied ? "Copied" : `Copy ${selectedExportMeta.label}`}
                    title={exportCopied ? "Copied" : `Copy ${selectedExportMeta.label}`}
                    data-testid="citation-copy-export-btn"
                    onClick={() => handleCopy(exportFileContent, `exp-${selectedExport}`, selectedExportMeta.label)}
                  >
                    {exportCopied ? <Check size={16} /> : <Copy size={16} />}
                  </IconButton>
                </PreviewCopy>
                <PreviewCode data-testid="citation-export-output">{exportFileContent}</PreviewCode>
              </Preview>
              <Meta style={{ whiteSpace: "normal" }}>{selectedExportMeta.description}</Meta>
            </>
          )}
        </Body>

        <Footer>
          <FooterGroup>
            {target.entityType !== "post" && (
              <Button
                type="button"
                onClick={() => void handleSaveToLibrary()}
                disabled={savingToLibrary || savedToLibrary}
                data-testid="citation-save-library-btn"
              >
                {savedToLibrary ? <BookmarkFillIcon size={14} /> : <BookmarkPlus size={14} />}
                {savedToLibrary ? "Saved" : "Save to References"}
              </Button>
            )}
            <SourceLink
              to={
                target.entityType === "post"
                  ? target.url || target.sourcePageUrl || `/posts/${target.entityId}`
                  : target.sourcePageUrl
              }
              onClick={onClose}
              data-testid="citation-view-source-page-link"
            >
              {target.entityType === "post" ? "View Post" : "Open Source Page"}
              <ExternalLink size={12} />
            </SourceLink>
          </FooterGroup>
          {activeTab === "styles" ? (
            <Button
              type="button"
              $variant="primary"
              onClick={() => handleCopy(formattedStyleText, `style-${selectedStyle}`, selectedStyle.toUpperCase())}
            >
              {styleCopied ? <Check size={14} /> : <Copy size={14} />}
              {styleCopied ? "Copied" : "Copy citation"}
            </Button>
          ) : (
            <Button
              type="button"
              $variant="primary"
              data-testid="citation-download-export-btn"
              onClick={() => handleDownloadExport(selectedExport)}
            >
              <Download size={14} />
              Download .{selectedExportMeta.ext}
            </Button>
          )}
        </Footer>
      </Dialog>
    </Backdrop>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
};
