// SPDX-License-Identifier: AGPL-3.0-or-later

import { PackageIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { IconButton, useTheme } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sanitizeSvgMarkup } from "../../../components/artifacts/PolyglotArtifactViewer";
import { DOMAIN_FILTERS, type EngineeringDomainId } from "../../../components/morsel/componentGalleryCatalog";
import { buildEquationFallbackPreviewSvg } from "../../../components/morsel/openModelCatalog";
import {
  type DiagramPreviewResultItem,
  getClassSource,
  getDiagramPreviewSvgs,
  getMountedLibraries,
  installDependency,
  type MountedLibraryEntry,
} from "../../../components/morsel/util/lsp-bridge";
import {
  fetchRegistryClassSource,
  type StreamedRegistryModelItem,
  streamRegistryModels,
} from "../../../components/morsel/util/registry-stream";
import { HERO_EXAMPLES, type HeroExample } from "../constants";

export interface TemplateGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: HeroExample) => void;
  currentTemplateId?: string | undefined;
}

const MODEL_PAGE_SIZE = 48;

const DomainGlyph: React.FC<{ svgInner: string; size?: number }> = ({ svgInner, size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    style={{ flexShrink: 0, display: "block" }}
    dangerouslySetInnerHTML={{ __html: svgInner }}
  />
);

function mapHeroDomain(ex: HeroExample): Exclude<EngineeringDomainId, "all"> {
  const raw = `${ex.domain || ""} ${ex.category}`.toLowerCase();
  if (raw.includes("electric") || raw.includes("rf") || raw.includes("spice")) return "electrical";
  if (raw.includes("mech") || raw.includes("multibody") || raw.includes("robot")) return "mechanics";
  if (raw.includes("fluid") || raw.includes("thermal") || raw.includes("process")) return "fluids-thermal";
  if (raw.includes("control") || raw.includes("nonlinear")) return "control";
  if (raw.includes("power") || raw.includes("grid")) return "power-grids";
  if (raw.includes("cad") || raw.includes("scad") || raw.includes("fea")) return "robotics-cad";
  return "systems";
}

function compareSemverSimple(a: string, b: string): number {
  const pa = a
    .replace(/^[^\d]*/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .replace(/^[^\d]*/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  currentTemplateId,
}) => {
  const { colorMode: themeMode, resolvedColorMode } = useTheme();
  const isDark = (resolvedColorMode || themeMode) !== "day";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<EngineeringDomainId>("all");
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const [mountedOnlyFilter, setMountedOnlyFilter] = useState(false);

  const [mountedLibs, setMountedLibs] = useState<MountedLibraryEntry[]>([]);
  const [streamedModels, setStreamedModels] = useState<StreamedRegistryModelItem[]>([]);
  const [registryTotal, setRegistryTotal] = useState<number | null>(null);
  const [registryHasMore, setRegistryHasMore] = useState(false);
  const [registryOffset, setRegistryOffset] = useState(0);
  const [registryFromApi, setRegistryFromApi] = useState<boolean | null>(null);
  const [registryDeps, setRegistryDeps] = useState<Record<string, Record<string, string>>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [livePreviews, setLivePreviews] = useState<Record<string, DiagramPreviewResultItem>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hydratedIdsRef = useRef<Set<string>>(new Set());

  const mountedMap = useMemo(() => {
    const map = new Map<string, MountedLibraryEntry>();
    if (Array.isArray(mountedLibs)) {
      for (const lib of mountedLibs) {
        map.set(lib.name.toLowerCase(), lib);
      }
    }
    return map;
  }, [mountedLibs]);

  // Sync mounted packages & focus search input when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    void getMountedLibraries()
      .then((res) => setMountedLibs(Array.isArray(res?.mounted) ? res.mounted : []))
      .catch(() => {
        // ignore if LSP worker is not ready yet
      });
    const timer = setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Stream openable models + diagram.svg thumbnails from the Ansatz package registry
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();
    const delay = searchQuery.trim().length > 0 ? 120 : 0;

    setIsStreaming(true);
    const timer = setTimeout(() => {
      streamRegistryModels(
        {
          q: searchQuery,
          domain: selectedDomain,
          packageName: packageFilter ?? undefined,
          limit: MODEL_PAGE_SIZE,
          offset: 0,
          includeSvg: true,
        },
        controller.signal,
      )
        .then((res) => {
          if (cancelled) return;
          setRegistryFromApi(res.fromRegistry);
          if (res.fromRegistry) {
            setStreamedModels(res.models);
            setRegistryTotal(res.total);
            setRegistryHasMore(res.hasMore);
            setRegistryOffset(res.models.length);
            if (Object.keys(res.packageDependencies).length > 0) {
              setRegistryDeps((prev) => ({ ...prev, ...res.packageDependencies }));
            }
            const seeded: Record<string, DiagramPreviewResultItem> = {};
            for (const m of res.models) {
              if (m.diagramSvg) {
                seeded[m.id] = { svg: m.diagramSvg, nodeCount: 0, edgeCount: 0 };
              }
            }
            if (Object.keys(seeded).length > 0) {
              setLivePreviews((prev) => ({ ...seeded, ...prev }));
            }
          } else {
            setStreamedModels([]);
            setRegistryTotal(null);
            setRegistryHasMore(false);
          }
          setIsStreaming(false);
        })
        .catch(() => {
          if (!cancelled) {
            setIsStreaming(false);
          }
        });
    }, delay);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [isOpen, searchQuery, selectedDomain, packageFilter]);

  const loadMoreModels = useCallback(() => {
    if (!registryHasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setIsStreaming(true);
    void streamRegistryModels({
      q: searchQuery,
      domain: selectedDomain,
      packageName: packageFilter ?? undefined,
      limit: MODEL_PAGE_SIZE,
      offset: registryOffset,
      includeSvg: true,
    })
      .then((res) => {
        if (res.fromRegistry && res.models.length > 0) {
          setStreamedModels((prev) => {
            const seen = new Set(prev.map((m) => m.fqn.toLowerCase()));
            const additions = res.models.filter((m) => !seen.has(m.fqn.toLowerCase()));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
          setRegistryOffset((prev) => prev + res.models.length);
          setRegistryHasMore(res.hasMore);
          if (Object.keys(res.packageDependencies).length > 0) {
            setRegistryDeps((prev) => ({ ...prev, ...res.packageDependencies }));
          }
          const seeded: Record<string, DiagramPreviewResultItem> = {};
          for (const m of res.models) {
            if (m.diagramSvg) {
              seeded[m.id] = { svg: m.diagramSvg, nodeCount: 0, edgeCount: 0 };
            }
          }
          if (Object.keys(seeded).length > 0) {
            setLivePreviews((prev) => ({ ...seeded, ...prev }));
          }
        } else {
          setRegistryHasMore(false);
        }
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setIsStreaming(false);
      });
  }, [registryHasMore, searchQuery, selectedDomain, packageFilter, registryOffset]);

  const filteredRegistryModels = useMemo(() => {
    if (!mountedOnlyFilter) return streamedModels;
    return streamedModels.filter((m) => mountedMap.has(m.packageName.toLowerCase()));
  }, [streamedModels, mountedOnlyFilter, mountedMap]);

  // Hydrate missing diagram thumbnails via LSP worker for visible models without diagramSvg
  useEffect(() => {
    if (!isOpen || filteredRegistryModels.length === 0) return;
    const toHydrate = filteredRegistryModels
      .slice(0, 24)
      .filter((m) => !m.diagramSvg && !livePreviews[m.id] && !hydratedIdsRef.current.has(m.id));
    if (toHydrate.length === 0) return;

    for (const m of toHydrate) hydratedIdsRef.current.add(m.id);
    let cancelled = false;
    void getDiagramPreviewSvgs(
      toHydrate.map((m) => ({ id: m.id, fqn: m.fqn })),
      isDark,
    )
      .then((previews) => {
        if (cancelled || !previews) return;
        setLivePreviews((prev) => ({ ...prev, ...previews }));
      })
      .catch(() => {
        // ignore when LSP worker has not mounted the package yet
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, filteredRegistryModels, livePreviews, isDark]);

  // Offline / fallback curated starters when Ansatz registry is unavailable
  const fallbackStarters = useMemo(() => {
    if (registryFromApi !== false) return [];
    const q = searchQuery.trim().toLowerCase();
    return HERO_EXAMPLES.filter((ex) => {
      if (selectedDomain !== "all" && mapHeroDomain(ex) !== selectedDomain) return false;
      if (!q) return true;
      return (
        ex.title.toLowerCase().includes(q) ||
        ex.category.toLowerCase().includes(q) ||
        ex.lang.toLowerCase().includes(q) ||
        Boolean(ex.description?.toLowerCase().includes(q)) ||
        Boolean(ex.tags?.some((t) => t.toLowerCase().includes(q)))
      );
    });
  }, [registryFromApi, searchQuery, selectedDomain]);

  const ensurePackageMounted = useCallback(
    async (pkgName: string, pkgVersion: string) => {
      if (!pkgName || mountedMap.has(pkgName.toLowerCase())) return;
      const deps = registryDeps[pkgName];
      if (deps) {
        for (const [depName, reqRange] of Object.entries(deps)) {
          if (depName === "Complex" || depName === "ModelicaServices") continue;
          const existing = mountedMap.get(depName.toLowerCase());
          const minVer = reqRange.replace(/^[^\d]*/, "");
          if (!existing || (minVer && compareSemverSimple(existing.version, minVer) < 0)) {
            await installDependency(depName, minVer || "4.1.0").catch(() => undefined);
          }
        }
      }
      const next = await installDependency(pkgName, pkgVersion).catch(() => []);
      if (next.length > 0) {
        setMountedLibs(next);
      }
    },
    [mountedMap, registryDeps],
  );

  const handleOpenRegistryModel = useCallback(
    async (item: StreamedRegistryModelItem) => {
      setBusyId(item.id);
      setErrorMsg(null);
      try {
        await ensurePackageMounted(item.packageName, item.packageVersion);
        let resolvedCode: string | null = null;
        try {
          const { content } = await getClassSource(item.fqn);
          if (content && content.trim().length > 0) {
            resolvedCode = content;
          }
        } catch {
          // fall through to direct Ansatz registry class source endpoint
        }
        if (!resolvedCode) {
          resolvedCode = await fetchRegistryClassSource(item.packageName, item.packageVersion, item.fqn);
        }
        if (!resolvedCode) {
          setErrorMsg(`Source unavailable for '${item.fqn}'.`);
          return;
        }
        onSelectTemplate({
          id: item.id,
          title: item.title,
          lang: item.dialect || "modelica",
          category: item.category,
          domain: item.category,
          description: item.summary,
          code: resolvedCode,
        });
        onClose();
      } catch (err) {
        setErrorMsg(`Could not open '${item.title}': ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyId(null);
      }
    },
    [ensurePackageMounted, onSelectTemplate, onClose],
  );

  if (!isOpen || typeof document === "undefined") return null;

  const palette = {
    bg: isDark ? "#18181b" : "#ffffff",
    subtleBg: isDark ? "#1e1e22" : "#f6f8fa",
    cardBg: isDark ? "#1f1f24" : "#ffffff",
    stageBg: isDark ? "#121214" : "#f8fafc",
    border: isDark ? "rgba(255, 255, 255, 0.1)" : "#d8dee4",
    subtleBorder: isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.07)",
    fg: isDark ? "#e6edf3" : "#1f2328",
    muted: isDark ? "#8b949e" : "#59636e",
    accent: "#2563eb",
    accentSoft: isDark ? "rgba(59, 130, 246, 0.16)" : "rgba(37, 99, 235, 0.10)",
    success: isDark ? "#3fb950" : "#1a7f37",
  };

  const totalCount =
    registryFromApi === false
      ? fallbackStarters.length
      : Math.max(filteredRegistryModels.length, !mountedOnlyFilter && registryTotal !== null ? registryTotal : 0);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Starter Engineering Templates"
      data-testid="template-gallery-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        backgroundColor: isDark ? "rgba(3, 7, 15, 0.74)" : "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 980,
          height: "min(740px, calc(100dvh - 32px))",
          backgroundColor: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.border}`,
          borderRadius: 16,
          boxShadow: isDark
            ? "0 28px 80px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(59,130,246,0.18)"
            : "0 24px 64px rgba(15, 23, 42, 0.22)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "var(--ms-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)",
        }}
      >
        {/* ── Top Header ── */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${palette.border}`,
            backgroundColor: palette.subtleBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "linear-gradient(135deg, #2563eb 0%, #0891b2 100%)",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <PackageIcon size={16} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.2 }}>Starter Engineering Templates</div>
              <div style={{ fontSize: 11.5, color: palette.muted }}>
                Openable models from the Ansatz package registry ({totalCount.toLocaleString()} available)
              </div>
            </div>
          </div>

          <IconButton
            icon={XIcon}
            aria-label="Close Starter Engineering Templates"
            variant="invisible"
            size="small"
            onClick={onClose}
          />
        </div>

        {/* ── Search + Domain Filter Toolbar ── */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: `1px solid ${palette.border}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            backgroundColor: palette.bg,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 12px",
                height: 38,
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.subtleBg,
              }}
            >
              <span style={{ color: palette.muted, display: "flex" }}>
                <SearchIcon size={15} />
              </span>
              {packageFilter && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 6,
                    backgroundColor: palette.accentSoft,
                    color: isDark ? "#60a5fa" : "#2563eb",
                    whiteSpace: "nowrap",
                  }}
                >
                  {packageFilter}
                  <button
                    type="button"
                    onClick={() => setPackageFilter(null)}
                    aria-label="Clear package filter"
                    style={{
                      border: "none",
                      background: "none",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                    }}
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              )}
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Ansatz models by name, package, domain, or keyword..."
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: palette.fg,
                  fontSize: 13.5,
                  minWidth: 100,
                }}
              />
              {isStreaming && (
                <span style={{ fontSize: 11, color: palette.muted, whiteSpace: "nowrap" }}>Streaming…</span>
              )}
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery("")}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: palette.muted,
                    cursor: "pointer",
                    display: "flex",
                    padding: 2,
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMountedOnlyFilter((v) => !v)}
              style={{
                height: 38,
                padding: "0 12px",
                borderRadius: 10,
                border: `1px solid ${mountedOnlyFilter ? palette.accent : palette.border}`,
                backgroundColor: mountedOnlyFilter ? palette.accentSoft : palette.subtleBg,
                color: mountedOnlyFilter ? (isDark ? "#60a5fa" : "#2563eb") : palette.muted,
                fontSize: 12,
                fontWeight: 550,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {mountedOnlyFilter ? "Mounted only ✓" : "All packages"}
            </button>
          </div>

          {/* Vector Domain Filter Pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {DOMAIN_FILTERS.map((dom) => {
              const active = selectedDomain === dom.id;
              return (
                <button
                  key={dom.id}
                  type="button"
                  onClick={() => setSelectedDomain(dom.id)}
                  style={{
                    border: `1px solid ${active ? dom.accent : palette.border}`,
                    backgroundColor: active ? `${dom.accent}1f` : "transparent",
                    color: active ? (isDark ? "#f0f6fc" : dom.accent) : palette.muted,
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer",
                    transition: "all 0.12s ease",
                  }}
                >
                  <DomainGlyph svgInner={dom.svgInner} size={13} />
                  <span>{dom.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Inline Error Banner */}
        {errorMsg && (
          <div
            style={{
              padding: "8px 20px",
              backgroundColor: isDark ? "rgba(248, 81, 73, 0.14)" : "rgba(207, 34, 46, 0.08)",
              borderBottom: `1px solid ${palette.border}`,
              color: isDark ? "#ff7b72" : "#cf222e",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              style={{
                border: "none",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                display: "flex",
              }}
            >
              <XIcon size={13} />
            </button>
          </div>
        )}

        {/* ── Main Scrollable Model Grid ── */}
        <div
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320 && registryHasMore) {
              loadMoreModels();
            }
          }}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "16px 20px",
          }}
        >
          {filteredRegistryModels.length === 0 && fallbackStarters.length === 0 ? (
            <div
              style={{
                padding: "56px 24px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                color: palette.muted,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: palette.fg }}>
                {isStreaming
                  ? "Loading models from Ansatz package registry…"
                  : `No models found${searchQuery ? ` matching "${searchQuery}"` : ""}`}
              </div>
              {!isStreaming && (searchQuery || selectedDomain !== "all" || packageFilter || mountedOnlyFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedDomain("all");
                    setPackageFilter(null);
                    setMountedOnlyFilter(false);
                  }}
                  style={{
                    marginTop: 4,
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.subtleBg,
                    color: palette.fg,
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 550,
                    cursor: "pointer",
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(225px, 1fr))",
                gap: 12,
              }}
            >
              {filteredRegistryModels.map((model) => {
                const isPkgMounted = mountedMap.has(model.packageName.toLowerCase());
                const isBusy = busyId === model.id;
                const isCurrent = currentTemplateId === model.id;
                const previewSvg =
                  livePreviews[model.id]?.svg ||
                  model.diagramSvg ||
                  buildEquationFallbackPreviewSvg(model.title, model.fqn, isDark);

                return (
                  <div
                    key={model.id}
                    onDoubleClick={() => void handleOpenRegistryModel(model)}
                    title={`${model.fqn}\nDouble-click or click Open to load model`}
                    style={{
                      border: `1px solid ${isCurrent ? palette.accent : palette.border}`,
                      borderRadius: 12,
                      backgroundColor: palette.cardBg,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      cursor: "pointer",
                      transition: "border-color 0.14s ease, box-shadow 0.14s ease",
                      boxShadow: isCurrent ? `0 0 0 2px ${palette.accentSoft}` : "none",
                    }}
                  >
                    {/* Graphical Diagram Thumbnail Stage */}
                    <div
                      style={{
                        height: 124,
                        backgroundColor: palette.stageBg,
                        backgroundImage: isDark
                          ? "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)"
                          : "radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)",
                        backgroundSize: "12px 12px",
                        borderBottom: `1px solid ${palette.subtleBorder}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        padding: "8px 10px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        dangerouslySetInnerHTML={{
                          __html: sanitizeSvgMarkup(previewSvg, { isDark, maxHeight: "108px" }),
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 7,
                          fontSize: 9.5,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          padding: "1px 5px",
                          borderRadius: 4,
                          backgroundColor: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.9)",
                          border: `1px solid ${palette.subtleBorder}`,
                          color: palette.muted,
                          fontFamily: "var(--ms-font-mono, monospace)",
                        }}
                      >
                        {model.kind}
                      </span>
                      {model.dialect && model.dialect !== "modelica" && (
                        <span
                          style={{
                            position: "absolute",
                            top: 6,
                            left: 7,
                            fontSize: 9.5,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                            padding: "1px 5px",
                            borderRadius: 4,
                            backgroundColor: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.9)",
                            border: `1px solid ${palette.subtleBorder}`,
                            color: isDark ? "#60a5fa" : "#2563eb",
                            fontFamily: "var(--ms-font-mono, monospace)",
                          }}
                        >
                          {model.dialect}
                        </span>
                      )}
                    </div>

                    {/* Model Metadata + Open Button */}
                    <div
                      style={{
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 650,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {model.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: palette.muted,
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          minHeight: 31,
                        }}
                      >
                        {model.summary}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "var(--fgColor-accent, var(--ms-brand))",
                          fontFamily: "var(--ms-font-mono, monospace)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={model.fqn}
                      >
                        {model.fqn}
                      </div>

                      <div
                        style={{
                          marginTop: "auto",
                          paddingTop: 7,
                          borderTop: `1px solid ${palette.subtleBorder}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPackageFilter((prev) => (prev === model.packageName ? null : model.packageName));
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 11,
                            color: palette.muted,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                          }}
                          title={
                            isPkgMounted
                              ? `${model.packageName} (mounted) — click to filter`
                              : `${model.packageName} (auto-mounts on open) — click to filter`
                          }
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              backgroundColor: isPkgMounted ? palette.success : "#f59e0b",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{model.packageName}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpenRegistryModel(model);
                          }}
                          style={{
                            border: "none",
                            borderRadius: 6,
                            backgroundColor: palette.accent,
                            color: "#ffffff",
                            padding: "4px 10px",
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: isBusy ? "wait" : "pointer",
                            flexShrink: 0,
                          }}
                        >
                          {isBusy ? "Opening…" : "Open"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Fallback Curated Starters when offline / registry unreachable */}
              {fallbackStarters.map((ex) => {
                const isCurrent = currentTemplateId === ex.id;
                const previewSvg = buildEquationFallbackPreviewSvg(ex.title, ex.category, isDark);

                return (
                  <div
                    key={ex.id}
                    onDoubleClick={() => {
                      onSelectTemplate(ex);
                      onClose();
                    }}
                    style={{
                      border: `1px solid ${isCurrent ? palette.accent : palette.border}`,
                      borderRadius: 12,
                      backgroundColor: palette.cardBg,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      cursor: "pointer",
                      boxShadow: isCurrent ? `0 0 0 2px ${palette.accentSoft}` : "none",
                    }}
                  >
                    <div
                      style={{
                        height: 124,
                        backgroundColor: palette.stageBg,
                        backgroundImage: isDark
                          ? "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)"
                          : "radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)",
                        backgroundSize: "12px 12px",
                        borderBottom: `1px solid ${palette.subtleBorder}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        padding: "8px 10px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        dangerouslySetInnerHTML={{
                          __html: sanitizeSvgMarkup(previewSvg, { isDark, maxHeight: "108px" }),
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 7,
                          fontSize: 9.5,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          padding: "1px 5px",
                          borderRadius: 4,
                          backgroundColor: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.9)",
                          border: `1px solid ${palette.subtleBorder}`,
                          color: palette.muted,
                          fontFamily: "var(--ms-font-mono, monospace)",
                        }}
                      >
                        {ex.lang}
                      </span>
                    </div>

                    <div
                      style={{
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 650,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ex.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: palette.muted,
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          minHeight: 31,
                        }}
                      >
                        {ex.description || ex.category}
                      </div>

                      <div
                        style={{
                          marginTop: "auto",
                          paddingTop: 7,
                          borderTop: `1px solid ${palette.subtleBorder}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <span style={{ fontSize: 11, color: palette.muted }}>{ex.category}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTemplate(ex);
                            onClose();
                          }}
                          style={{
                            border: "none",
                            borderRadius: 6,
                            backgroundColor: palette.accent,
                            color: "#ffffff",
                            padding: "4px 10px",
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
