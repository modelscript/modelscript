// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileZipIcon,
  GlobeIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
  VerifiedIcon,
  XIcon,
} from "@primer/octicons-react";
import { useTheme } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDropzone } from "react-dropzone";
import { useToast } from "../ToastContext";
import {
  buildGenericSchematicSvg,
  CURATED_ANSATZ_PACKAGES,
  DOMAIN_FILTERS,
  GALLERY_COMPONENTS,
  inferDomainForFqn,
  type EngineeringDomainId,
  type GalleryComponentItem,
  type PackageComponentSummary,
  type RegistryPackage,
} from "./componentGalleryCatalog";
import { startPlacement } from "./placement";
import type { Translations } from "./util/i18n";
import {
  getClassIcons,
  getComponentCatalog,
  getMountedLibraries,
  globalClassIconCache,
  installDependency,
  searchClasses,
  uninstallDependency,
  type CatalogComponentInfo,
  type MountedLibraryEntry,
} from "./util/lsp-bridge";
import { invertSvgColors, normalizeSvgForIcon } from "./util/x6";

export { CURATED_ANSATZ_PACKAGES as CURATED_STDLIB_PACKAGES };
export type { PackageComponentSummary, RegistryPackage };

type HubViewMode = "components" | "libraries" | "import";

const COMPONENT_PAGE_SIZE = 72;

function extractSubpackageGroup(fqn: string): string | null {
  const parts = fqn.split(".");
  if (parts.length < 3) return null;
  if (parts[0] === "Modelica" && parts.length >= 4) {
    return `${parts[1]} · ${parts[2]}`;
  }
  return `${parts[0]} · ${parts[1]}`;
}

function catalogEntryToGalleryItem(entry: CatalogComponentInfo, mountedVer?: string): GalleryComponentItem {
  const domain = inferDomainForFqn(entry.fqn, entry.language);
  const parts = entry.fqn.split(".");
  const subPath = parts.length > 2 ? parts.slice(1, -1).join(" · ") : entry.packageName;
  const baseIdent = entry.name.replace(/[^A-Za-z0-9_]/g, "") || "comp";
  const instIdent = `${baseIdent.charAt(0).toLowerCase()}${baseIdent.slice(1)}1`;
  return {
    id: `cat:${entry.fqn}`,
    shortName: entry.name,
    fqn: entry.fqn,
    kind: entry.kind || "model",
    category: domain,
    packageName: entry.packageName,
    packageVersion: mountedVer || (entry.packageName === "Modelica" ? "4.1.0" : "1.0.0"),
    summary: entry.description || `${subPath} (${entry.kind || "model"})`,
    portsAndParams: parts.length > 2 ? parts.slice(0, -1).join(".") : `${entry.kind} · ${entry.packageName}`,
    declarationSnippet: `${entry.fqn} ${instIdent};`,
    keywords: [entry.name.toLowerCase(), entry.fqn.toLowerCase(), subPath.toLowerCase()],
    schematicSvg: buildGenericSchematicSvg(entry.name, entry.kind || "model", domain),
  };
}

export interface AddLibraryModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onAddLibrary: (item: File | string, type: "file" | "url") => void | Promise<void>;
  onInstallPackage?: ((packageName: string, version: string) => Promise<void>) | undefined;
  onUninstallPackage?: ((packageName: string) => Promise<void>) | undefined;
  onPlaceComponent?: ((snippet: string, className?: string) => void) | undefined;
  translations: Translations;
  documentUri?: string | undefined;
  dialect?: string | undefined;
  colorMode?: "dark" | "light" | undefined;
}

function formatCompactCount(count?: number): string {
  if (!count) return "";
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return String(count);
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function setComponentDragPreview(e: React.DragEvent, svgMarkup: string, shortName: string, isDark: boolean): void {
  if (typeof document === "undefined") return;
  const ghost = document.createElement("div");
  ghost.style.position = "fixed";
  ghost.style.top = "-9999px";
  ghost.style.left = "-9999px";
  ghost.style.width = "64px";
  ghost.style.height = "52px";
  ghost.style.display = "flex";
  ghost.style.alignItems = "center";
  ghost.style.justifyContent = "center";
  ghost.style.backgroundColor = isDark ? "#161b22" : "#ffffff";
  ghost.style.color = isDark ? "#e6edf3" : "#1f2328";
  ghost.style.borderRadius = "10px";
  ghost.style.border = "1.5px solid #3b82f6";
  ghost.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.35)";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "999999";
  ghost.style.padding = "4px";

  if (svgMarkup && svgMarkup.includes("<svg")) {
    ghost.innerHTML = DOMPurify.sanitize(svgMarkup, { USE_PROFILES: { svg: true, svgFilters: true } });
    const svgEl = ghost.querySelector("svg");
    if (svgEl) {
      svgEl.setAttribute("width", "50");
      svgEl.setAttribute("height", "38");
      svgEl.style.width = "50px";
      svgEl.style.height = "38px";
    }
  } else {
    ghost.textContent = shortName.slice(0, 6);
  }

  document.body.appendChild(ghost);
  try {
    e.dataTransfer.setDragImage(ghost, 32, 26);
  } catch {
    // ignore unsupported environments
  }
  setTimeout(() => {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }, 0);
}

/**
 * Renders a crisp engineering schematic SVG for a component card.
 * Uses batch-hydrated official LSP/MSL `Icon(...)` SVGs from `globalClassIconCache`
 * and falls back seamlessly to the curated schematic vector symbol.
 */
const SchematicPreview: React.FC<{
  fqn: string;
  cachedSvg: string | null;
  fallbackSvg: string;
  isDark: boolean;
}> = React.memo(function SchematicPreview({ fqn, cachedSvg, fallbackSvg, isDark }) {
  const activeSvg = cachedSvg ?? globalClassIconCache.get(fqn) ?? null;

  const sanitizedHtml = useMemo(() => {
    if (activeSvg && activeSvg.includes("<svg")) {
      const adapted = normalizeSvgForIcon(invertSvgColors(activeSvg, isDark));
      return DOMPurify.sanitize(adapted, { USE_PROFILES: { svg: true, svgFilters: true } });
    }
    return DOMPurify.sanitize(fallbackSvg, { USE_PROFILES: { svg: true, svgFilters: true } });
  }, [activeSvg, fallbackSvg, isDark]);

  const isUsingLiveMsl = Boolean(activeSvg && activeSvg.includes("<svg"));

  return (
    <div
      style={{
        width: isUsingLiveMsl ? 52 : 76,
        height: isUsingLiveMsl ? 52 : 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: isDark ? "#e6edf3" : "#1e293b",
        overflow: "hidden",
      }}
      className={isUsingLiveMsl ? "modelica-icon" : undefined}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
});

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

const AddLibraryModal: React.FC<AddLibraryModalProps> = ({
  isOpen,
  onDismiss,
  onAddLibrary,
  onInstallPackage,
  onUninstallPackage,
  onPlaceComponent,
  colorMode: propColorMode,
}) => {
  const toast = useToast();
  const { colorMode: themeMode, resolvedColorMode } = useTheme();
  const isDark = propColorMode === "dark" || (!propColorMode && (themeMode === "dark" || resolvedColorMode === "dark"));

  const [viewMode, setViewMode] = useState<HubViewMode>("components");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<EngineeringDomainId>("all");
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const [subpackageFilter, setSubpackageFilter] = useState<string | null>(null);
  const [mountedOnlyFilter, setMountedOnlyFilter] = useState(false);
  const [installedOnlyLibraries, setInstalledOnlyLibraries] = useState(false);
  const [sortBy, setSortBy] = useState<"popular" | "name">("popular");
  const [visibleCount, setVisibleCount] = useState<number>(COMPONENT_PAGE_SIZE);
  const [iconRev, setIconRev] = useState(0);

  // Authoritative mounted packages & full component catalog from LSP
  const [mountedMap, setMountedMap] = useState<Map<string, MountedLibraryEntry>>(new Map());
  const [catalogEntries, setCatalogEntries] = useState<CatalogComponentInfo[]>([]);
  const [remotePackages, setRemotePackages] = useState<RegistryPackage[]>([]);
  const [liveClassMatches, setLiveClassMatches] = useState<GalleryComponentItem[]>([]);
  const [isSearchingLive, setIsSearchingLive] = useState(false);

  // Per-package selected version & active install/uninstall state
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [busyComponentId, setBusyComponentId] = useState<string | null>(null);
  const [inspectedComponent, setInspectedComponent] = useState<GalleryComponentItem | null>(null);

  // Import state
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const attemptedIconFqnsRef = useRef<Set<string>>(new Set());

  const syncMountedState = useCallback(async (): Promise<number> => {
    const [res, catalog] = await Promise.all([getMountedLibraries(), getComponentCatalog()]);
    const next = new Map<string, MountedLibraryEntry>();
    for (const item of res.mounted) {
      next.set(item.name.toLowerCase(), item);
    }
    setMountedMap(next);
    if (catalog.length > 0) {
      setCatalogEntries(catalog);
    }
    return catalog.length;
  }, []);

  // Refresh mounted libraries, full MSL/workspace component catalog & remote packages when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void syncMountedState().then((count) => {
      // If LSP worker was still booting on initial cold open, retry once it finishes initializing
      if (!cancelled && count === 0) {
        retryTimer = setTimeout(() => {
          if (!cancelled) {
            void syncMountedState();
          }
        }, 650);
      }
    });
    setTimeout(() => searchInputRef.current?.focus(), 40);

    fetch("/api/v1/packages?limit=40")
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as { packages?: RegistryPackage[] };
        if (!cancelled && Array.isArray(data.packages)) {
          setRemotePackages(data.packages);
        }
      })
      .catch(() => {
        // Offline / standalone mode uses curated catalog seamlessly
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isOpen, syncMountedState]);

  // Reset subpackage filter when top-level domain or package filter changes
  useEffect(() => {
    setSubpackageFilter(null);
  }, [selectedDomain, packageFilter]);

  // Reset progressive render window & scroll position when filters or query change
  useEffect(() => {
    setVisibleCount(COMPONENT_PAGE_SIZE);
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = 0;
    }
  }, [searchQuery, selectedDomain, packageFilter, subpackageFilter, mountedOnlyFilter, viewMode]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (inspectedComponent) {
          setInspectedComponent(null);
        } else {
          onDismiss();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, inspectedComponent, onDismiss]);

  // Live workspace class search fusion when user types >= 2 chars
  useEffect(() => {
    const q = searchQuery.trim();
    if (!isOpen || q.length < 2) {
      setLiveClassMatches([]);
      setIsSearchingLive(false);
      return;
    }

    let cancelled = false;
    setIsSearchingLive(true);
    const timer = setTimeout(() => {
      searchClasses(q, 60)
        .then((res) => {
          if (cancelled) return;
          const dynamicItems: GalleryComponentItem[] = [];
          for (const node of res.results) {
            const fqn = node.compositeName || node.name;
            if (!fqn || fqn.startsWith("__LIB__:")) continue;
            const kind = (node.classKind || "class").toLowerCase();
            if (kind === "package") continue;
            const rootPkg = fqn.split(".")[0] || "Workspace";
            const domain = inferDomainForFqn(fqn, node.language);
            const mountedVer = mountedMap.get(rootPkg.toLowerCase())?.version || "1.0.0";
            if (node.iconSvg && node.iconSvg.includes("<svg")) {
              globalClassIconCache.set(fqn, node.iconSvg);
            }
            dynamicItems.push({
              id: `live:${fqn}`,
              shortName: node.name,
              fqn,
              kind,
              category: domain,
              packageName: rootPkg,
              packageVersion: mountedVer,
              summary: `${fqn}`,
              portsAndParams: `${kind} · ${rootPkg}`,
              declarationSnippet: `${fqn} ${node.name.charAt(0).toLowerCase()}${node.name.slice(1)}1;`,
              keywords: [node.name.toLowerCase(), fqn.toLowerCase()],
              schematicSvg: node.iconSvg || buildGenericSchematicSvg(node.name, kind, domain),
            });
            if (dynamicItems.length >= 40) break;
          }
          setLiveClassMatches(dynamicItems);
          setIsSearchingLive(false);
        })
        .catch(() => {
          if (!cancelled) {
            setLiveClassMatches([]);
            setIsSearchingLive(false);
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, searchQuery, mountedMap]);

  // Unified merged package list (curated + any extra remote packages + any custom mounted packages)
  const allPackages = useMemo<RegistryPackage[]>(() => {
    const merged = new Map<string, RegistryPackage>();
    for (const pkg of CURATED_ANSATZ_PACKAGES) {
      merged.set(pkg.name.toLowerCase(), pkg);
    }
    for (const remote of remotePackages) {
      const key = remote.name.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        const vers = Array.from(
          new Set([...(existing.versions || [existing.version]), ...(remote.versions || [remote.version])]),
        );
        merged.set(key, {
          ...existing,
          versions: vers,
          downloads: Math.max(existing.downloads ?? 0, remote.downloads ?? 0),
        });
      } else {
        merged.set(key, {
          ...remote,
          domain: remote.domain || inferDomainForFqn(remote.name, remote.language),
          versions: remote.versions?.length ? remote.versions : [remote.version || "1.0.0"],
        });
      }
    }
    for (const m of mountedMap.values()) {
      if (m.name === "Complex" || m.name === "ModelicaServices") continue;
      const key = m.name.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, {
          name: m.name,
          version: m.version,
          versions: [m.version],
          description: m.description || `Mounted workspace library (${m.language || "Modelica"})`,
          domain: inferDomainForFqn(m.name, m.language),
          language: m.language || "Modelica",
          verified: false,
        });
      }
    }
    return Array.from(merged.values());
  }, [remotePackages, mountedMap]);

  // Full merged Component Gallery (38 featured polyglot/MSL components + 1,330+ pre-baked MSL & mounted workspace components)
  const allGalleryComponents = useMemo<GalleryComponentItem[]>(() => {
    const seen = new Set<string>();
    const out: GalleryComponentItem[] = [];
    for (const item of GALLERY_COMPONENTS) {
      seen.add(item.fqn.toLowerCase());
      out.push(item);
    }
    for (const entry of catalogEntries) {
      const key = entry.fqn.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const mountedVer = mountedMap.get(entry.packageName.toLowerCase())?.version;
      out.push(catalogEntryToGalleryItem(entry, mountedVer));
    }
    return out;
  }, [catalogEntries, mountedMap]);

  // Domain + package + search filtered components (before subpackage quick-pill refinement)
  const baseFilteredComponents = useMemo<GalleryComponentItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    let combined = allGalleryComponents;
    if (q.length >= 2 && liveClassMatches.length > 0) {
      const seen = new Set(allGalleryComponents.map((c) => c.fqn.toLowerCase()));
      const extras = liveClassMatches.filter((m) => !seen.has(m.fqn.toLowerCase()));
      if (extras.length > 0) {
        combined = [...allGalleryComponents, ...extras];
      }
    }

    return combined.filter((item) => {
      if (selectedDomain !== "all" && item.category !== selectedDomain) return false;
      if (packageFilter && item.packageName.toLowerCase() !== packageFilter.toLowerCase()) return false;
      if (mountedOnlyFilter && !mountedMap.has(item.packageName.toLowerCase())) return false;
      if (!q) return true;

      return (
        item.shortName.toLowerCase().includes(q) ||
        item.fqn.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.packageName.toLowerCase().includes(q) ||
        item.portsAndParams.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
      );
    });
  }, [
    allGalleryComponents,
    searchQuery,
    selectedDomain,
    packageFilter,
    mountedOnlyFilter,
    mountedMap,
    liveClassMatches,
  ]);

  // Top subpackage pills when exploring a domain or package (e.g. "Electrical · Analog", "Blocks · Continuous")
  const availableSubpackages = useMemo<Array<{ label: string; count: number }>>(() => {
    if (selectedDomain === "all" && !packageFilter) return [];
    const counts = new Map<string, number>();
    for (const item of baseFilteredComponents) {
      const grp = extractSubpackageGroup(item.fqn);
      if (grp) {
        counts.set(grp, (counts.get(grp) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [baseFilteredComponents, selectedDomain, packageFilter]);

  // Final filtered Component Gallery items
  const filteredComponents = useMemo<GalleryComponentItem[]>(() => {
    if (!subpackageFilter) return baseFilteredComponents;
    return baseFilteredComponents.filter((item) => extractSubpackageGroup(item.fqn) === subpackageFilter);
  }, [baseFilteredComponents, subpackageFilter]);

  // Progressive visible slice for 60fps scrolling + batched official MSL SVG hydration
  const visibleComponents = useMemo<GalleryComponentItem[]>(
    () => filteredComponents.slice(0, visibleCount),
    [filteredComponents, visibleCount],
  );

  useEffect(() => {
    if (!isOpen || viewMode !== "components" || visibleComponents.length === 0) return;
    const missing: string[] = [];
    for (const comp of visibleComponents) {
      if (globalClassIconCache.has(comp.fqn)) continue;
      if (attemptedIconFqnsRef.current.has(comp.fqn)) continue;
      const canFetch = comp.packageName === "Modelica" || mountedMap.has(comp.packageName.toLowerCase());
      if (canFetch) {
        attemptedIconFqnsRef.current.add(comp.fqn);
        missing.push(comp.fqn);
      }
    }
    if (missing.length === 0) return;

    let cancelled = false;
    void getClassIcons(missing.slice(0, 80)).then((icons) => {
      if (cancelled) return;
      if (Object.keys(icons).length > 0) {
        setIconRev((r) => r + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, viewMode, visibleComponents, mountedMap]);

  // Pre-computed component counts per package for the Libraries tab
  const packageComponentCounts = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const comp of allGalleryComponents) {
      const key = comp.packageName.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [allGalleryComponents]);

  // Filtered Ansatz Library cards (matches library name, description, language, AND its component names!)
  const filteredPackages = useMemo<RegistryPackage[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const matchingPkgFromComponents = new Set<string>();
    if (q) {
      for (const comp of allGalleryComponents) {
        if (
          comp.shortName.toLowerCase().includes(q) ||
          comp.fqn.toLowerCase().includes(q) ||
          comp.keywords.some((kw) => kw.includes(q))
        ) {
          matchingPkgFromComponents.add(comp.packageName.toLowerCase());
        }
      }
    }

    const list = allPackages.filter((pkg) => {
      if (selectedDomain !== "all" && pkg.domain && pkg.domain !== selectedDomain) return false;
      const isMounted = mountedMap.has(pkg.name.toLowerCase());
      if (installedOnlyLibraries && !isMounted) return false;
      if (!q) return true;
      return (
        pkg.name.toLowerCase().includes(q) ||
        (pkg.description || "").toLowerCase().includes(q) ||
        (pkg.language || "").toLowerCase().includes(q) ||
        matchingPkgFromComponents.has(pkg.name.toLowerCase())
      );
    });

    list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return (b.downloads ?? 0) - (a.downloads ?? 0);
    });
    return list;
  }, [allPackages, allGalleryComponents, searchQuery, selectedDomain, installedOnlyLibraries, mountedMap, sortBy]);

  // Install package (with automatic peer-dependency version bump per user preference)
  const executeInstallPackage = useCallback(
    async (pkgName: string, requestedVer?: string, silentToast = false): Promise<boolean> => {
      const pkgMeta = allPackages.find((p) => p.name.toLowerCase() === pkgName.toLowerCase());
      const targetVersion =
        requestedVer || selectedVersions[pkgName] || pkgMeta?.versions?.[0] || pkgMeta?.version || "1.0.0";

      setBusyPackage(pkgName);
      try {
        // Automatic peer-dependency version bump if required
        if (pkgMeta?.dependencies) {
          for (const [peerName, range] of Object.entries(pkgMeta.dependencies)) {
            if (peerName === "Complex" || peerName === "ModelicaServices") continue;
            const reqClean = range.replace(/^[>=~^]+/, "").trim();
            const currentPeer = mountedMap.get(peerName.toLowerCase());
            if (currentPeer && reqClean && currentPeer.version < reqClean) {
              await installDependency(peerName, reqClean);
              toast.info(`Auto-bumped '${peerName}' to v${reqClean} for '${pkgName}'.`);
            }
          }
        }

        if (onInstallPackage) {
          await onInstallPackage(pkgName, targetVersion);
        } else {
          await installDependency(pkgName, targetVersion);
        }

        await syncMountedState();
        if (!silentToast) {
          toast.success(`Installed '${pkgName}@${targetVersion}' into Libraries.`);
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to install '${pkgName}': ${msg}`);
        return false;
      } finally {
        setBusyPackage(null);
      }
    },
    [allPackages, selectedVersions, mountedMap, onInstallPackage, syncMountedState, toast],
  );

  const executeUninstallPackage = useCallback(
    async (pkgName: string) => {
      setBusyPackage(pkgName);
      try {
        if (onUninstallPackage) {
          await onUninstallPackage(pkgName);
        } else {
          await uninstallDependency(pkgName);
        }
        await syncMountedState();
        toast.info(`Removed '${pkgName}' from Libraries.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to remove '${pkgName}': ${msg}`);
      } finally {
        setBusyPackage(null);
      }
    },
    [onUninstallPackage, syncMountedState, toast],
  );

  // Place component (auto-installs parent library if not mounted!)
  const handlePlaceComponent = useCallback(
    async (item: GalleryComponentItem) => {
      const isMounted = mountedMap.has(item.packageName.toLowerCase());
      setBusyComponentId(item.id);
      try {
        if (!isMounted) {
          const ok = await executeInstallPackage(item.packageName, item.packageVersion, true);
          if (!ok) return;
          toast.info(`Auto-installed '${item.packageName}@${item.packageVersion}' for '${item.shortName}'.`);
        }

        const cachedSvg = globalClassIconCache.get(item.fqn) || item.schematicSvg;
        if (onPlaceComponent) {
          onPlaceComponent(item.declarationSnippet, item.fqn);
          toast.success(`Added '${item.shortName}' to model.`);
        } else {
          startPlacement({
            className: item.fqn,
            classKind: item.kind,
            iconSvg: cachedSvg,
          });
          toast.info(`Click on the schematic canvas to place '${item.shortName}'.`);
        }
        onDismiss();
      } finally {
        setBusyComponentId(null);
      }
    },
    [mountedMap, executeInstallPackage, onPlaceComponent, onDismiss, toast],
  );

  // Drag component directly onto schematic canvas (auto-installs parent library if needed)
  const handleComponentDragStart = useCallback(
    (e: React.DragEvent, item: GalleryComponentItem) => {
      const iconSvg = globalClassIconCache.get(item.fqn) || item.schematicSvg;
      const payload = {
        className: item.fqn,
        classKind: item.kind,
        iconSvg,
      };
      e.dataTransfer.setData("application/json", JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", JSON.stringify(payload));
      e.dataTransfer.setData("application/vnd.modelscript.classname", item.fqn);
      e.dataTransfer.setData("application/vnd.modelscript.iconsvg", iconSvg);
      e.dataTransfer.effectAllowed = "copy";

      setComponentDragPreview(e, iconSvg, item.shortName, isDark);

      if (!mountedMap.has(item.packageName.toLowerCase())) {
        void executeInstallPackage(item.packageName, item.packageVersion, true);
      }

      startPlacement({
        className: item.fqn,
        classKind: item.kind,
        iconSvg,
        isDrag: true,
      });

      // Dismiss modal on next frame so drop lands directly on the schematic canvas
      requestAnimationFrame(() => {
        onDismiss();
      });
    },
    [isDark, mountedMap, executeInstallPackage, onDismiss],
  );

  // Dropzone for Import tab
  const onDropFiles = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      setImportError(null);
      setIsImporting(true);
      try {
        await onAddLibrary(file, "file");
        await syncMountedState();
        onDismiss();
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsImporting(false);
      }
    },
    [onAddLibrary, syncMountedState, onDismiss],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropFiles,
    multiple: false,
  });

  const handleImportFromUrl = useCallback(async () => {
    const trimmed = importUrl.trim();
    if (!trimmed) return;
    setImportError(null);
    setIsImporting(true);
    try {
      await onAddLibrary(trimmed, "url");
      await syncMountedState();
      setImportUrl("");
      onDismiss();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  }, [importUrl, onAddLibrary, syncMountedState, onDismiss]);

  if (!isOpen || typeof document === "undefined") return null;

  // Clean design tokens (zero Primer overflow bugs)
  const palette = {
    bg: isDark ? "#0d1117" : "#ffffff",
    subtleBg: isDark ? "#161b22" : "#f6f8fa",
    cardBg: isDark ? "#131922" : "#ffffff",
    cardHoverBg: isDark ? "#192230" : "#f8fafc",
    stageBg: isDark ? "#0b1017" : "#f8fafc",
    border: isDark ? "#2a323d" : "#d8dee4",
    subtleBorder: isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.07)",
    fg: isDark ? "#e6edf3" : "#1f2328",
    muted: isDark ? "#8b949e" : "#59636e",
    accent: "#2563eb",
    accentSoft: isDark ? "rgba(59, 130, 246, 0.16)" : "rgba(37, 99, 235, 0.10)",
    success: isDark ? "#3fb950" : "#1a7f37",
    successSoft: isDark ? "rgba(63, 185, 80, 0.15)" : "rgba(26, 127, 55, 0.10)",
  };

  const mountedVisibleCount = Array.from(mountedMap.keys()).filter(
    (k) => k !== "complex" && k !== "modelicaservices",
  ).length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Component and Library Hub"
      data-testid="add-library-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
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
        {/* ── Top Header + Clean 3-Mode Segmented Control ── */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${palette.border}`,
            backgroundColor: palette.subtleBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
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
              <div style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.2 }}>Component &amp; Library Hub</div>
              <div style={{ fontSize: 11.5, color: palette.muted }}>
                Drag or place schematic components · Manage Ansatz packages
              </div>
            </div>
          </div>

          {/* Crisp 3-tab Segmented Control */}
          <div
            role="tablist"
            aria-label="Hub view mode"
            style={{
              display: "inline-flex",
              padding: 3,
              borderRadius: 10,
              backgroundColor: isDark ? "#0d1117" : "#eaeef2",
              border: `1px solid ${palette.border}`,
              gap: 2,
            }}
          >
            {(
              [
                { id: "components", label: "Components", badge: filteredComponents.length.toLocaleString() },
                { id: "libraries", label: "Libraries", badge: `${mountedVisibleCount}/${allPackages.length}` },
                { id: "import", label: "Import", badge: null },
              ] as const
            ).map((tab) => {
              const active = viewMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setViewMode(tab.id)}
                  style={{
                    border: "none",
                    borderRadius: 7,
                    padding: "6px 13px",
                    fontSize: 12.5,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: active ? (isDark ? "#212832" : "#ffffff") : "transparent",
                    color: active ? palette.fg : palette.muted,
                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.16)" : "none",
                    transition: "all 0.14s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: "0 6px",
                        borderRadius: 999,
                        backgroundColor: active ? palette.accentSoft : "transparent",
                        color: active ? (isDark ? "#60a5fa" : "#2563eb") : palette.muted,
                        fontFamily: "var(--ms-font-mono, monospace)",
                      }}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Close Component and Library Hub"
            onClick={onDismiss}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: `1px solid ${palette.border}`,
              backgroundColor: "transparent",
              color: palette.muted,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* ── Search + Domain Filter Toolbar (Components & Libraries views) ── */}
        {viewMode !== "import" && (
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
                  placeholder={
                    viewMode === "components"
                      ? "Search 1,350+ schematic components (resistor, opamp, PID, gear, fluxtube, MOSFET, pump, UR5)..."
                      : "Search Ansatz libraries by name, domain, language, or included component..."
                  }
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
                {isSearchingLive && (
                  <span style={{ fontSize: 11, color: palette.muted, whiteSpace: "nowrap" }}>Indexing…</span>
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

              {viewMode === "components" ? (
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
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setInstalledOnlyLibraries((v) => !v)}
                    style={{
                      height: 38,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: `1px solid ${installedOnlyLibraries ? palette.success : palette.border}`,
                      backgroundColor: installedOnlyLibraries ? palette.successSoft : palette.subtleBg,
                      color: installedOnlyLibraries ? palette.success : palette.muted,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Installed ({mountedVisibleCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy((s) => (s === "popular" ? "name" : "popular"))}
                    style={{
                      height: 38,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.subtleBg,
                      color: palette.fg,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Sort: {sortBy === "popular" ? "Popular" : "Name A–Z"}
                  </button>
                </div>
              )}
            </div>

            {/* Clean Vector Domain Filter Strip (no emojis, no scroll clutter) */}
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

            {/* Subpackage Quick-Filter Pills (when exploring a specific domain or package) */}
            {viewMode === "components" && availableSubpackages.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {availableSubpackages.map((grp) => {
                  const active = subpackageFilter === grp.label;
                  return (
                    <button
                      key={grp.label}
                      type="button"
                      onClick={() => setSubpackageFilter(active ? null : grp.label)}
                      style={{
                        border: `1px solid ${active ? palette.accent : palette.subtleBorder}`,
                        backgroundColor: active ? palette.accentSoft : palette.subtleBg,
                        color: active ? (isDark ? "#60a5fa" : "#2563eb") : palette.muted,
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: active ? 600 : 500,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        cursor: "pointer",
                      }}
                    >
                      <span>{grp.label}</span>
                      <span style={{ opacity: 0.72, fontFamily: "var(--ms-font-mono, monospace)", fontSize: 10 }}>
                        {grp.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Main Scrollable Viewport ── */}
        <div
          ref={scrollViewportRef}
          onScroll={(e) => {
            if (viewMode !== "components" || visibleCount >= filteredComponents.length) return;
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 280) {
              setVisibleCount((prev) => Math.min(prev + COMPONENT_PAGE_SIZE, filteredComponents.length));
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
          {/* ════════ VIEW 1: VISUAL COMPONENT GALLERY ════════ */}
          {viewMode === "components" && (
            <>
              {filteredComponents.length === 0 ? (
                <div
                  style={{
                    padding: "56px 24px",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600 }}>No matching schematic components</div>
                  <div style={{ fontSize: 13, color: palette.muted, maxWidth: 420 }}>
                    No components matched &ldquo;{searchQuery || subpackageFilter || selectedDomain}&rdquo;. Try
                    clearing active filters or check Ansatz Libraries to mount additional domain packages.
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setSelectedDomain("all");
                        setPackageFilter(null);
                        setSubpackageFilter(null);
                        setMountedOnlyFilter(false);
                      }}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: `1px solid ${palette.border}`,
                        backgroundColor: palette.subtleBg,
                        color: palette.fg,
                        fontSize: 12.5,
                        fontWeight: 550,
                        cursor: "pointer",
                      }}
                    >
                      Reset filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("libraries")}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: "none",
                        backgroundColor: palette.accent,
                        color: "#ffffff",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Browse Ansatz Libraries
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    data-icon-rev={iconRev}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {visibleComponents.map((comp) => {
                      const isPkgMounted = mountedMap.has(comp.packageName.toLowerCase());
                      const isBusy = busyComponentId === comp.id;
                      const isSelected = inspectedComponent?.id === comp.id;
                      const cachedSvg = globalClassIconCache.get(comp.fqn) ?? null;

                      return (
                        <div
                          key={comp.id}
                          draggable
                          onDragStart={(e) => handleComponentDragStart(e, comp)}
                          onClick={() => setInspectedComponent((prev) => (prev?.id === comp.id ? null : comp))}
                          title={`${comp.fqn}\nDrag onto schematic canvas or click Place`}
                          style={{
                            border: `1px solid ${isSelected ? palette.accent : palette.border}`,
                            borderRadius: 12,
                            backgroundColor: palette.cardBg,
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                            cursor: "grab",
                            transition: "border-color 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease",
                            boxShadow: isSelected ? `0 0 0 2px ${palette.accentSoft}` : "none",
                          }}
                        >
                          {/* Graphical Schematic Blueprint Stage */}
                          <div
                            style={{
                              height: 82,
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
                              padding: "6px 12px",
                            }}
                          >
                            <SchematicPreview
                              fqn={comp.fqn}
                              cachedSvg={cachedSvg}
                              fallbackSvg={comp.schematicSvg}
                              isDark={isDark}
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
                                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)",
                                color: palette.muted,
                                fontFamily: "var(--ms-font-mono, monospace)",
                              }}
                            >
                              {comp.kind}
                            </span>
                          </div>

                          {/* Component Metadata + Place Button */}
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
                              {comp.shortName}
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
                              {comp.summary}
                            </div>
                            <div
                              style={{
                                fontSize: 10.5,
                                color: isDark ? "#79c0ff" : "#0969da",
                                fontFamily: "var(--ms-font-mono, monospace)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {comp.portsAndParams}
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
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 11,
                                  color: palette.muted,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={
                                  isPkgMounted
                                    ? `${comp.packageName} (mounted)`
                                    : `${comp.packageName} (auto-installs on place)`
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
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{comp.packageName}</span>
                              </span>

                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handlePlaceComponent(comp);
                                }}
                                style={{
                                  border: "none",
                                  borderRadius: 6,
                                  padding: "4px 10px",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  backgroundColor: palette.accent,
                                  color: "#ffffff",
                                  cursor: isBusy ? "wait" : "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  flexShrink: 0,
                                }}
                              >
                                <PlusIcon size={12} />
                                <span>{isBusy ? "Adding…" : "Place"}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {visibleCount < filteredComponents.length && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1px solid ${palette.subtleBorder}`,
                        backgroundColor: palette.subtleBg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 12,
                        color: palette.muted,
                      }}
                    >
                      <span>
                        Showing <strong>{visibleComponents.length.toLocaleString()}</strong> of{" "}
                        <strong>{filteredComponents.length.toLocaleString()}</strong> schematic components
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleCount((prev) => Math.min(prev + COMPONENT_PAGE_SIZE, filteredComponents.length))
                        }
                        style={{
                          padding: "5px 12px",
                          borderRadius: 7,
                          border: `1px solid ${palette.border}`,
                          backgroundColor: palette.cardBg,
                          color: palette.fg,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Show more (+{Math.min(COMPONENT_PAGE_SIZE, filteredComponents.length - visibleCount)})
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ════════ VIEW 2: ANSATZ LIBRARIES CATALOG ════════ */}
          {viewMode === "libraries" && (
            <>
              {searchQuery.trim().length > 0 && filteredComponents.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.subtleBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    fontSize: 12.5,
                  }}
                >
                  <span>
                    Found <strong>{filteredComponents.length.toLocaleString()}</strong> visual schematic components
                    matching &ldquo;{searchQuery.trim()}&rdquo;
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewMode("components")}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: isDark ? "#60a5fa" : "#2563eb",
                      fontWeight: 600,
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    View Component Gallery →
                  </button>
                </div>
              )}

              {filteredPackages.length === 0 ? (
                <div style={{ padding: "48px 24px", textAlign: "center", color: palette.muted }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: palette.fg, marginBottom: 6 }}>
                    No matching libraries found
                  </div>
                  <div style={{ fontSize: 12.5, marginBottom: 12 }}>
                    Try adjusting your search or disabling the Installed filter.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedDomain("all");
                      setInstalledOnlyLibraries(false);
                    }}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.subtleBg,
                      color: palette.fg,
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    Show all libraries
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(410px, 1fr))",
                    gap: 12,
                  }}
                >
                  {filteredPackages.map((pkg) => {
                    const mountedInfo = mountedMap.get(pkg.name.toLowerCase());
                    const availableVersions = pkg.versions?.length ? pkg.versions : [pkg.version || "1.0.0"];
                    const chosenVer =
                      selectedVersions[pkg.name] || mountedInfo?.version || availableVersions[0] || "1.0.0";
                    const isInstalledSameVer = Boolean(mountedInfo && mountedInfo.version === chosenVer);
                    const isInstalledDiffVer = Boolean(mountedInfo && mountedInfo.version !== chosenVer);
                    const isBusy = busyPackage === pkg.name;

                    const domMeta = DOMAIN_FILTERS.find((d) => d.id === pkg.domain) || DOMAIN_FILTERS[0]!;
                    const pkgCompCount = packageComponentCounts.get(pkg.name.toLowerCase()) ?? 0;

                    return (
                      <div
                        key={pkg.name}
                        data-testid={`library-card-${pkg.name}`}
                        style={{
                          border: `1px solid ${mountedInfo ? (isDark ? "rgba(63,185,80,0.4)" : "rgba(26,127,55,0.35)") : palette.border}`,
                          borderRadius: 12,
                          padding: "14px 16px",
                          backgroundColor: palette.cardBg,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 9,
                                backgroundColor: `${domMeta.accent}1f`,
                                color: domMeta.accent,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <DomainGlyph svgInner={domMeta.svgInner} size={18} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 14.5, fontWeight: 650 }}>{pkg.name}</span>
                                {pkg.verified && (
                                  <span
                                    style={{ color: "#3b82f6", display: "inline-flex" }}
                                    title="Verified Standard Library"
                                  >
                                    <VerifiedIcon size={14} />
                                  </span>
                                )}
                                {pkg.language && (
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      padding: "1px 6px",
                                      borderRadius: 5,
                                      backgroundColor: palette.subtleBg,
                                      border: `1px solid ${palette.subtleBorder}`,
                                      color: palette.muted,
                                    }}
                                  >
                                    {pkg.language}
                                  </span>
                                )}
                              </div>
                              <div
                                style={{ fontSize: 11.5, color: palette.muted, marginTop: 2, display: "flex", gap: 8 }}
                              >
                                {pkg.license && <span>{pkg.license}</span>}
                                {pkg.downloads ? (
                                  <span>
                                    <DownloadIcon size={11} /> {formatCompactCount(pkg.downloads)}
                                  </span>
                                ) : null}
                                {pkg.sizeBytes ? <span>{formatSize(pkg.sizeBytes)}</span> : null}
                              </div>
                            </div>
                          </div>

                          {/* Compact SemVer Selector */}
                          <select
                            aria-label={`Version for ${pkg.name}`}
                            value={chosenVer}
                            onChange={(e) => setSelectedVersions((prev) => ({ ...prev, [pkg.name]: e.target.value }))}
                            style={{
                              height: 28,
                              padding: "0 8px",
                              borderRadius: 6,
                              border: `1px solid ${palette.border}`,
                              backgroundColor: palette.subtleBg,
                              color: palette.fg,
                              fontSize: 11.5,
                              fontFamily: "var(--ms-font-mono, monospace)",
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            {availableVersions.map((v) => (
                              <option key={v} value={v}>
                                v{v}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div style={{ fontSize: 12.5, color: palette.muted, lineHeight: 1.45 }}>
                          {pkg.description || "Ansatz engineering library package."}
                        </div>

                        <div
                          style={{
                            marginTop: "auto",
                            paddingTop: 8,
                            borderTop: `1px solid ${palette.subtleBorder}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          {pkgCompCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPackageFilter(pkg.name);
                                setSelectedDomain("all");
                                setViewMode("components");
                              }}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: isDark ? "#60a5fa" : "#2563eb",
                                fontSize: 12,
                                fontWeight: 550,
                                padding: 0,
                                cursor: "pointer",
                              }}
                            >
                              Browse {pkgCompCount.toLocaleString()} components →
                            </button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: palette.muted }}>
                              {mountedInfo ? `Mounted v${mountedInfo.version}` : "Ready to mount"}
                            </span>
                          )}

                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {isInstalledSameVer ? (
                              <>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    padding: "5px 10px",
                                    borderRadius: 7,
                                    backgroundColor: palette.successSoft,
                                    color: palette.success,
                                    fontSize: 12,
                                    fontWeight: 600,
                                  }}
                                >
                                  <CheckIcon size={13} />
                                  <span>Installed</span>
                                </span>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  title={`Remove ${pkg.name} from workspace`}
                                  onClick={() => void executeUninstallPackage(pkg.name)}
                                  style={{
                                    height: 29,
                                    padding: "0 8px",
                                    borderRadius: 7,
                                    border: `1px solid ${palette.border}`,
                                    backgroundColor: "transparent",
                                    color: palette.muted,
                                    cursor: isBusy ? "wait" : "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11.5,
                                  }}
                                >
                                  <TrashIcon size={12} />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                data-testid={`install-btn-${pkg.name}`}
                                onClick={() => void executeInstallPackage(pkg.name, chosenVer)}
                                style={{
                                  border: "none",
                                  borderRadius: 7,
                                  padding: "6px 13px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  backgroundColor: palette.accent,
                                  color: "#ffffff",
                                  cursor: isBusy ? "wait" : "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                {isBusy ? (
                                  <>
                                    <SyncIcon size={12} />
                                    <span>Installing…</span>
                                  </>
                                ) : isInstalledDiffVer ? (
                                  <span>Switch to v{chosenVer}</span>
                                ) : (
                                  <>
                                    <DownloadIcon size={12} />
                                    <span>Add Library</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ════════ VIEW 3: UNIFIED LOCAL + URL IMPORT ════════ */}
          {viewMode === "import" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
              {/* Local Archive / File Dropzone */}
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: 14,
                  padding: 20,
                  backgroundColor: palette.cardBg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileZipIcon size={18} />
                  <span style={{ fontSize: 14.5, fontWeight: 650 }}>Local Archive or Model File</span>
                </div>
                <div style={{ fontSize: 12.5, color: palette.muted, lineHeight: 1.45 }}>
                  Drop a <code>.zip</code> library package, <code>.fmu</code> Functional Mock-up Unit, or source file (
                  <code>.mo</code>, <code>.msx</code>, <code>.sysml</code>) to mount it directly into the workspace VFS.
                </div>

                <div
                  {...getRootProps()}
                  style={{
                    flex: 1,
                    minHeight: 180,
                    border: `2px dashed ${isDragActive ? palette.accent : palette.border}`,
                    borderRadius: 12,
                    backgroundColor: isDragActive ? palette.accentSoft : palette.subtleBg,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: 24,
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input {...getInputProps()} />
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      backgroundColor: palette.accentSoft,
                      color: palette.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <UploadIcon size={20} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {isDragActive ? "Drop archive to mount" : "Click to browse or drag file here"}
                  </div>
                  <div style={{ fontSize: 11.5, color: palette.muted }}>
                    Supports .zip, .mo, .msx, .sysml, .fmu, .cir, .dss, .urdf, .step
                  </div>
                </div>
              </div>

              {/* Remote URL / GitHub Release Zip */}
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: 14,
                  padding: 20,
                  backgroundColor: palette.cardBg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <GlobeIcon size={18} />
                  <span style={{ fontSize: 14.5, fontWeight: 650 }}>Import from Remote URL / GitHub</span>
                </div>
                <div style={{ fontSize: 12.5, color: palette.muted, lineHeight: 1.45 }}>
                  Fetch a <code>.zip</code> archive or raw <code>.mo</code> / <code>.sysml</code> library directly from
                  an HTTPS URL or GitHub release asset.
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  <label htmlFor="ansatz-remote-url-input" style={{ fontSize: 12, fontWeight: 600 }}>
                    Archive or Raw File URL
                  </label>
                  <input
                    id="ansatz-remote-url-input"
                    type="url"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://github.com/org/library/releases/download/v1.0.0/Library.zip"
                    style={{
                      height: 38,
                      padding: "0 12px",
                      borderRadius: 9,
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.subtleBg,
                      color: palette.fg,
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    disabled={!importUrl.trim() || isImporting}
                    onClick={() => void handleImportFromUrl()}
                    style={{
                      height: 38,
                      borderRadius: 9,
                      border: "none",
                      backgroundColor: !importUrl.trim() || isImporting ? palette.border : palette.accent,
                      color: "#ffffff",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: !importUrl.trim() || isImporting ? "not-allowed" : "pointer",
                      marginTop: 4,
                    }}
                  >
                    {isImporting ? "Fetching & Mounting…" : "Fetch & Mount Library"}
                  </button>
                </div>

                {importError && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      backgroundColor: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.35)",
                      color: isDark ? "#fca5a5" : "#b91c1c",
                      fontSize: 12,
                    }}
                  >
                    {importError}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom Component Inspector Bar (when a component card is clicked) ── */}
        {viewMode === "components" && inspectedComponent && (
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${palette.border}`,
              backgroundColor: palette.subtleBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: "var(--ms-font-mono, monospace)",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {inspectedComponent.fqn}
              </div>
              <div style={{ fontSize: 11.5, color: palette.muted }}>
                <code>{inspectedComponent.declarationSnippet}</code>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(inspectedComponent.declarationSnippet);
                  toast.success("Copied component declaration.");
                }}
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 7,
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.cardBg,
                  color: palette.fg,
                  fontSize: 12,
                  fontWeight: 550,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <CopyIcon size={12} />
                <span>Copy Code</span>
              </button>
              <button
                type="button"
                onClick={() => void handlePlaceComponent(inspectedComponent)}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 7,
                  border: "none",
                  backgroundColor: palette.accent,
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <CodeIcon size={12} />
                <span>Place in Model</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default AddLibraryModal;
