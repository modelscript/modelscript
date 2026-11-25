// SPDX-License-Identifier: AGPL-3.0-or-later

import { DOMAIN_FILTERS, type EngineeringDomainId } from "@modelscript/editor/workbench/componentGalleryCatalog";
import { getLanguageInfo } from "@modelscript/editor/workbench/constants";
import { buildEquationFallbackPreviewSvg } from "@modelscript/editor/workbench/openModelCatalog";
import {
  getClassSource,
  getDiagramPreviewSvgs,
  getMountedLibraries,
  installDependency,
  type DiagramPreviewResultItem,
  type MountedLibraryEntry,
} from "@modelscript/editor/workbench/util/lsp-bridge";
import {
  fetchRegistryClassSource,
  streamRegistryModels,
  type StreamedRegistryModelItem,
} from "@modelscript/editor/workbench/util/registry-stream";
import { ChevronRightIcon, PackageIcon, PlusIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { IconButton, useTheme } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sanitizeSvgMarkup } from "../../../components/artifacts/PolyglotArtifactViewer";
import {
  ANSATZ_EDITOR_LANGUAGE_DOMAINS,
  DEFAULT_EMPTY_MODELICA_CODE,
  getAnsatzEditorLanguageDomain,
  HERO_EXAMPLES,
  PINNED_ANSATZ_EDITOR_LANGUAGE_IDS,
  useVisibleAnsatzEditorLanguages,
  type HeroExample,
} from "../constants";
import {
  DIFFICULTY_LABELS,
  EXAMPLE_INDEX_BY_LANG,
  getCachedLanguageExamples,
  loadLanguageExamples,
  type ExampleDifficulty,
  type LoadedLanguageExample,
} from "../generated/example-loader";

export interface TemplateGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: HeroExample) => void;
  onSelectPendingTemplate?: ((title: string, loadTemplate: () => Promise<HeroExample | null>) => void) | undefined;
  currentTemplateId?: string | undefined;
  currentLang?: string | undefined;
  lockedLanguage?: string | undefined;
  requireChoice?: boolean | undefined;
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
  onSelectPendingTemplate,
  currentTemplateId,
  currentLang = "modelica",
  lockedLanguage,
  requireChoice = false,
}) => {
  const { colorMode: themeMode, resolvedColorMode } = useTheme();
  const isDark = (resolvedColorMode || themeMode) !== "day";
  const allVisibleAnsatzEditorLanguages = useVisibleAnsatzEditorLanguages();
  const visibleAnsatzEditorLanguages = useMemo(
    () =>
      lockedLanguage
        ? allVisibleAnsatzEditorLanguages.filter((l) => l.id.toLowerCase() === lockedLanguage.toLowerCase())
        : allVisibleAnsatzEditorLanguages,
    [allVisibleAnsatzEditorLanguages, lockedLanguage],
  );

  const [selectedLang, setSelectedLang] = useState<string>(lockedLanguage || currentLang || "modelica");
  const [langSearch, setLangSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<EngineeringDomainId>("all");
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const [mountedOnlyFilter, setMountedOnlyFilter] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

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

  // Sync selected language, mounted packages & focus search input when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setSelectedLang(lockedLanguage || currentLang || "modelica");
    setLangSearch("");
    setErrorMsg(null);
    void getMountedLibraries()
      .then((res) => setMountedLibs(Array.isArray(res?.mounted) ? res.mounted : []))
      .catch(() => {
        // ignore if LSP worker is not ready yet
      });
    const timer = setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isOpen, currentLang, lockedLanguage]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen || requireChoice) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, requireChoice]);

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

  const isModelicaSelected = selectedLang.toLowerCase() === "modelica";

  const filteredRegistryModels = useMemo(() => {
    if (!isModelicaSelected) return [];
    if (!mountedOnlyFilter) return streamedModels;
    return streamedModels.filter((m) => mountedMap.has(m.packageName.toLowerCase()));
  }, [isModelicaSelected, streamedModels, mountedOnlyFilter, mountedMap]);

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

  const [selectedDifficulty, setSelectedDifficulty] = useState<ExampleDifficulty | "all">("all");
  const [loadedChunkByLang, setLoadedChunkByLang] = useState<Record<string, LoadedLanguageExample[]>>({});

  const VR_SHOWCASE_LANG_ID = "__vr_showcase__";
  const isVrShowcaseSelected = selectedLang === VR_SHOWCASE_LANG_ID;

  useEffect(() => {
    if (!isOpen || isVrShowcaseSelected) return;
    const norm = selectedLang.toLowerCase();
    if (!EXAMPLE_INDEX_BY_LANG.has(norm)) return;
    const cached = getCachedLanguageExamples(norm);
    if (cached) {
      setLoadedChunkByLang((prev) => (prev[norm] === cached ? prev : { ...prev, [norm]: cached }));
      return;
    }
    let cancelled = false;
    void loadLanguageExamples(norm).then((items) => {
      if (!cancelled && items.length > 0) {
        setLoadedChunkByLang((prev) => ({ ...prev, [norm]: items }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isVrShowcaseSelected, selectedLang]);

  const selectedLangOption = useMemo(() => {
    if (isVrShowcaseSelected) {
      return {
        id: VR_SHOWCASE_LANG_ID,
        label: "3D & VR Showcase",
        ext: "VR",
      };
    }
    return (
      visibleAnsatzEditorLanguages.find((l) => l.id === selectedLang) || {
        id: selectedLang,
        label: selectedLang.toUpperCase(),
        ext: `.${selectedLang}`,
      }
    );
  }, [isVrShowcaseSelected, visibleAnsatzEditorLanguages, selectedLang]);
  const selectedLangInfo = useMemo(
    () => getLanguageInfo(isVrShowcaseSelected ? "scad" : selectedLang),
    [isVrShowcaseSelected, selectedLang],
  );

  const vrShowcaseExamples = useMemo(
    () =>
      HERO_EXAMPLES.filter(
        (ex) => Boolean(ex.tags?.some((t) => t.toLowerCase() === "vr")) || ex.id === "scad-flanged-hub",
      ),
    [],
  );

  const exampleCountsByLang = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ex of HERO_EXAMPLES) {
      const id = ex.lang.toLowerCase();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [langId, entries] of EXAMPLE_INDEX_BY_LANG.entries()) {
      if (entries.length > 0) {
        counts.set(langId, entries.length);
      }
    }
    return counts;
  }, []);

  const normalizedLangQuery = langSearch.trim().toLowerCase();
  const filteredLanguages = useMemo(() => {
    if (!normalizedLangQuery) return visibleAnsatzEditorLanguages;
    return visibleAnsatzEditorLanguages.filter((lang) => {
      const domain = getAnsatzEditorLanguageDomain(lang.id).toLowerCase();
      return (
        lang.label.toLowerCase().includes(normalizedLangQuery) ||
        lang.id.toLowerCase().includes(normalizedLangQuery) ||
        lang.ext.toLowerCase().includes(normalizedLangQuery) ||
        domain.includes(normalizedLangQuery)
      );
    });
  }, [visibleAnsatzEditorLanguages, normalizedLangQuery]);

  const pinnedLanguages = useMemo(() => {
    const byId = new Map(visibleAnsatzEditorLanguages.map((l) => [l.id, l]));
    return PINNED_ANSATZ_EDITOR_LANGUAGE_IDS.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> =>
      Boolean(l),
    );
  }, [visibleAnsatzEditorLanguages]);

  const groupedLanguages = useMemo(() => {
    const byId = new Map(visibleAnsatzEditorLanguages.map((l) => [l.id, l]));
    const assigned = new Set<string>();
    const groups: Array<{ title: string; items: typeof visibleAnsatzEditorLanguages }> = [];
    for (const domain of ANSATZ_EDITOR_LANGUAGE_DOMAINS) {
      const items = domain.ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
      if (items.length > 0) {
        items.forEach((l) => assigned.add(l.id));
        groups.push({ title: domain.title, items });
      }
    }
    const remaining = visibleAnsatzEditorLanguages.filter((l) => !assigned.has(l.id));
    if (remaining.length > 0) {
      groups.push({ title: "Other", items: remaining });
    }
    return groups;
  }, [visibleAnsatzEditorLanguages]);

  // Curated starters for the selected language (preferring SSOT verified multi-file chunks when present)
  const fallbackStarters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const normLang = selectedLang.toLowerCase();
    const ssotIndex = EXAMPLE_INDEX_BY_LANG.get(normLang);
    const ssotLoaded = loadedChunkByLang[normLang];

    let baseList: HeroExample[];
    if (isVrShowcaseSelected) {
      baseList = vrShowcaseExamples;
    } else if (isModelicaSelected && registryFromApi !== false) {
      if (packageFilter || mountedOnlyFilter) {
        return [];
      }
      const ssotItems: HeroExample[] = ssotLoaded
        ? ssotLoaded.map((item) => ({ ...item }))
        : ssotIndex
          ? ssotIndex.map((m) => ({ ...m, code: selectedLangInfo.defaultCode || "" }))
          : [];
      const vrModelica = HERO_EXAMPLES.filter(
        (ex) =>
          ex.lang.toLowerCase() === "modelica" &&
          Boolean(ex.tags?.some((t) => t.toLowerCase() === "vr")) &&
          !ssotItems.some((s) => s.id === ex.id),
      );
      baseList = [...ssotItems, ...vrModelica];
    } else if (ssotIndex && ssotIndex.length > 0) {
      baseList = ssotLoaded
        ? ssotLoaded.map((item) => ({ ...item }))
        : ssotIndex.map((m) => ({
            ...m,
            code: selectedLangInfo.defaultCode || "",
          }));
    } else {
      const langMatches = HERO_EXAMPLES.filter((ex) => ex.lang.toLowerCase() === normLang);
      baseList =
        langMatches.length > 0
          ? langMatches
          : selectedLangInfo.defaultCode
            ? [
                {
                  id: `starter-${selectedLang}`,
                  title: `${selectedLangOption.label} Starter`,
                  category: getAnsatzEditorLanguageDomain(selectedLang),
                  lang: selectedLang,
                  description: `Starter ${selectedLangOption.label} (${selectedLangOption.ext}) model`,
                  code: selectedLangInfo.defaultCode,
                  ...(selectedLangInfo.defaultFiles ? { files: { ...selectedLangInfo.defaultFiles } } : {}),
                  ...(selectedLangInfo.defaultActiveFile ? { activeFile: selectedLangInfo.defaultActiveFile } : {}),
                },
              ]
            : [];
    }
    return baseList.filter((ex) => {
      if (selectedDifficulty !== "all" && ex.difficulty && ex.difficulty !== selectedDifficulty) {
        return false;
      }
      if (
        (isModelicaSelected || isVrShowcaseSelected) &&
        selectedDomain !== "all" &&
        mapHeroDomain(ex) !== selectedDomain
      ) {
        return false;
      }
      if (!q) return true;
      return (
        ex.title.toLowerCase().includes(q) ||
        ex.category.toLowerCase().includes(q) ||
        ex.lang.toLowerCase().includes(q) ||
        Boolean(ex.description?.toLowerCase().includes(q)) ||
        Boolean(ex.tags?.some((t) => t.toLowerCase().includes(q))) ||
        Boolean(ex.subFormats?.some((sf) => sf.toLowerCase().includes(q))) ||
        Boolean(ex.fileNames?.some((fn) => fn.toLowerCase().includes(q)))
      );
    });
  }, [
    isVrShowcaseSelected,
    vrShowcaseExamples,
    isModelicaSelected,
    registryFromApi,
    packageFilter,
    mountedOnlyFilter,
    searchQuery,
    selectedDomain,
    selectedDifficulty,
    selectedLang,
    selectedLangInfo,
    selectedLangOption,
    loadedChunkByLang,
  ]);

  const ensurePackageMounted = useCallback(
    async (pkgName: string, pkgVersion: string) => {
      if (!pkgName) return;
      const live = await getMountedLibraries().catch(() => ({ mounted: [] as MountedLibraryEntry[] }));
      const liveMap = new Map<string, MountedLibraryEntry>();
      for (const lib of live.mounted) {
        liveMap.set(lib.name.toLowerCase(), lib);
      }
      if (liveMap.has(pkgName.toLowerCase())) return;
      const deps = registryDeps[pkgName];
      if (deps) {
        for (const [depName, reqRange] of Object.entries(deps)) {
          if (depName === "Complex" || depName === "ModelicaServices") continue;
          const existing = liveMap.get(depName.toLowerCase());
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
    [registryDeps],
  );

  const handleOpenRegistryModel = useCallback(
    async (item: StreamedRegistryModelItem) => {
      const loadModel = async (): Promise<HeroExample | null> => {
        let resolvedCode = await fetchRegistryClassSource(item.packageName, item.packageVersion, item.fqn);
        if (resolvedCode && resolvedCode.trim().length > 0) {
          if (item.packageName) {
            void ensurePackageMounted(item.packageName, item.packageVersion);
          }
        } else {
          await ensurePackageMounted(item.packageName, item.packageVersion);
          try {
            const { content } = await getClassSource(item.fqn);
            if (content && content.trim().length > 0) {
              resolvedCode = content;
            }
          } catch {
            // ignore
          }
        }
        if (!resolvedCode) {
          return null;
        }
        return {
          id: item.id,
          title: item.title,
          lang: item.dialect || "modelica",
          category: item.category,
          domain: item.category,
          description: item.summary,
          code: resolvedCode,
        };
      };

      if (onSelectPendingTemplate) {
        onClose();
        onSelectPendingTemplate(item.title, loadModel);
        return;
      }

      setBusyId(item.id);
      setErrorMsg(null);
      try {
        const loaded = await loadModel();
        if (!loaded) {
          setErrorMsg(`Source unavailable for '${item.fqn}'.`);
          return;
        }
        onSelectTemplate(loaded);
        onClose();
      } catch (err) {
        setErrorMsg(`Could not open '${item.title}': ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyId(null);
      }
    },
    [ensurePackageMounted, onSelectTemplate, onSelectPendingTemplate, onClose],
  );

  if (!isOpen || typeof document === "undefined") return null;

  const palette = {
    bg: "var(--ms-bg, #ffffff)",
    subtleBg: isDark ? "#121214" : "#f6f8fa",
    cardBg: "var(--ms-bg-elv, #ffffff)",
    stageBg: isDark ? "#121214" : "#f8fafc",
    border: "var(--ms-border, rgba(15, 23, 42, 0.12))",
    subtleBorder: "var(--ms-divider, rgba(15, 23, 42, 0.08))",
    fg: "var(--ms-text-1, #0f172a)",
    muted: "var(--ms-text-2, #475569)",
    accent: isDark ? "var(--ms-link, #22d3ee)" : "var(--ms-brand, #0e7490)",
    accentBg: "var(--ms-brand, #0e7490)",
    accentSoft: "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))",
    success: "var(--ms-status-pass-fg, #047857)",
  };

  const totalCount = isModelicaSelected
    ? registryFromApi === false
      ? fallbackStarters.length
      : Math.max(
          filteredRegistryModels.length + fallbackStarters.length,
          !mountedOnlyFilter && registryTotal !== null ? registryTotal + fallbackStarters.length : 0,
        )
    : fallbackStarters.length;

  const handleCreateBlank = () => {
    const blankLang = isVrShowcaseSelected ? "scad" : selectedLang;
    const blankCode = selectedLangInfo.defaultCode || (isModelicaSelected ? DEFAULT_EMPTY_MODELICA_CODE : "");
    onSelectTemplate({
      id: `blank-${blankLang}`,
      title: "Untitled Model",
      category: "Blank",
      lang: blankLang,
      code: blankCode,
      ...(selectedLangInfo.defaultFiles ? { files: { ...selectedLangInfo.defaultFiles } } : {}),
      ...(selectedLangInfo.defaultActiveFile ? { activeFile: selectedLangInfo.defaultActiveFile } : {}),
    });
    onClose();
  };

  const renderLangRailItem = (lang: (typeof visibleAnsatzEditorLanguages)[number], keyPrefix = "") => {
    const isSelected = lang.id.toLowerCase() === selectedLang.toLowerCase();
    const count =
      lang.id.toLowerCase() === "modelica" && registryTotal !== null
        ? registryTotal
        : (exampleCountsByLang.get(lang.id.toLowerCase()) ?? 0);
    return (
      <button
        key={`${keyPrefix}${lang.id}`}
        type="button"
        onClick={() => {
          setSelectedLang(lang.id);
          setSelectedDomain("all");
          setPackageFilter(null);
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 10px",
          borderRadius: 8,
          border: "none",
          backgroundColor: isSelected ? palette.accentSoft : "transparent",
          color: isSelected ? palette.accent : palette.fg,
          fontSize: 12,
          fontWeight: isSelected ? 600 : 500,
          cursor: "pointer",
          textAlign: "left",
          transition: "background-color 0.12s ease",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {lang.label}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {count > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 5px",
                borderRadius: 999,
                backgroundColor: isSelected
                  ? "color-mix(in srgb, var(--ms-brand, #0891b2) 18%, transparent)"
                  : palette.subtleBorder,
                color: isSelected ? palette.accent : palette.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {count > 999 ? `${Math.floor(count / 1000)}k+` : count}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              color: palette.muted,
              fontFamily: "var(--ms-font-mono, monospace)",
              opacity: 0.8,
            }}
          >
            {lang.ext}
          </span>
        </span>
      </button>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Model & Starter Templates"
      data-testid="template-gallery-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !requireChoice) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9990,
        backgroundColor: isDark ? "rgba(0, 0, 0, 0.68)" : "rgba(15, 23, 42, 0.48)",
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
          maxWidth: 1080,
          height: "min(760px, calc(100dvh - 32px))",
          backgroundColor: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.border}`,
          borderRadius: 16,
          boxShadow: "var(--ms-shadow-pop, 0 24px 64px rgba(15, 23, 42, 0.22))",
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
                background: "linear-gradient(135deg, var(--ms-accent-teal, #14b8a6) 0%, var(--ms-brand, #0891b2) 100%)",
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
              <div style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.2 }}>New Model</div>
              <div style={{ fontSize: 11.5, color: palette.muted }}>
                Choose a language, add a blank model, or pick a starter template ({totalCount.toLocaleString()} in{" "}
                {selectedLangOption.label})
              </div>
            </div>
          </div>

          {!requireChoice && (
            <IconButton
              icon={XIcon}
              aria-label="Close New Model gallery"
              variant="invisible"
              size="small"
              onClick={onClose}
            />
          )}
        </div>

        {/* ── Two-Pane Body: Language Rail (Left) + Blank Tile & Templates (Right) ── */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
          {/* Left Language Rail */}
          <aside
            aria-label="Languages"
            style={{
              width: 244,
              flexShrink: 0,
              borderRight: `1px solid ${palette.border}`,
              backgroundColor: palette.subtleBg,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderBottom: `1px solid ${palette.border}`,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
              }}
            >
              <SearchIcon size={13} style={{ color: palette.muted, flexShrink: 0 }} />
              <input
                type="text"
                value={langSearch}
                onChange={(e) => setLangSearch(e.target.value)}
                placeholder={`Filter ${visibleAnsatzEditorLanguages.length} languages…`}
                aria-label="Filter languages"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: palette.fg,
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              />
              {langSearch && (
                <button
                  type="button"
                  onClick={() => setLangSearch("")}
                  aria-label="Clear language filter"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: palette.muted,
                    cursor: "pointer",
                    display: "flex",
                    padding: 2,
                  }}
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px 8px" }}>
              {!lockedLanguage && !normalizedLangQuery && vrShowcaseExamples.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    data-testid="template-gallery-vr-showcase"
                    onClick={() => {
                      setSelectedLang(VR_SHOWCASE_LANG_ID);
                      setSelectedDomain("all");
                      setPackageFilter(null);
                      setMountedOnlyFilter(false);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: isVrShowcaseSelected
                        ? "1px solid rgba(14, 165, 233, 0.72)"
                        : `1px solid ${isDark ? "rgba(56, 189, 248, 0.28)" : "rgba(2, 132, 199, 0.25)"}`,
                      background: isVrShowcaseSelected
                        ? isDark
                          ? "linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(99, 102, 241, 0.28))"
                          : "linear-gradient(135deg, rgba(14, 165, 233, 0.16), rgba(99, 102, 241, 0.14))"
                        : isDark
                          ? "linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.10))"
                          : "linear-gradient(135deg, rgba(240, 249, 255, 0.95), rgba(238, 242, 255, 0.92))",
                      color: isVrShowcaseSelected ? (isDark ? "#e0f2fe" : "#0369a1") : palette.fg,
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "border-color 0.14s ease, background 0.14s ease",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span aria-hidden="true">🥽</span>
                      <span>3D &amp; VR Showcase</span>
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 999,
                        backgroundColor: isVrShowcaseSelected
                          ? "rgba(2, 132, 199, 0.85)"
                          : isDark
                            ? "rgba(56, 189, 248, 0.22)"
                            : "rgba(2, 132, 199, 0.14)",
                        color: isVrShowcaseSelected ? "#ffffff" : isDark ? "#7dd3fc" : "#0369a1",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      {vrShowcaseExamples.length}
                    </span>
                  </button>
                </div>
              )}
              {filteredLanguages.length === 0 ? (
                <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 12, color: palette.muted }}>
                  No languages matching "{langSearch}"
                </div>
              ) : normalizedLangQuery ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {filteredLanguages.map((lang) => renderLangRailItem(lang))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    ...(pinnedLanguages.length > 0
                      ? [{ key: "Popular", title: "Popular", items: pinnedLanguages, prefix: "pinned-" }]
                      : []),
                    ...groupedLanguages.map((g) => ({
                      key: g.title,
                      title: g.title,
                      items: g.items,
                      prefix: "",
                    })),
                  ].map((section) => {
                    const isCollapsed = Boolean(collapsedCategories[section.key]);
                    const hasActiveChild = section.items.some((l) => l.id.toLowerCase() === selectedLang.toLowerCase());
                    return (
                      <div key={section.key}>
                        <button
                          type="button"
                          aria-expanded={!isCollapsed}
                          onClick={() =>
                            setCollapsedCategories((prev) => ({
                              ...prev,
                              [section.key]: !prev[section.key],
                            }))
                          }
                          onMouseEnter={(e) => {
                            if (!hasActiveChild) e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!hasActiveChild) e.currentTarget.style.backgroundColor = "transparent";
                          }}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: "none",
                            backgroundColor: hasActiveChild ? "var(--ms-surface-hover)" : "transparent",
                            color: palette.fg,
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background-color 0.12s ease",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <span
                              style={{
                                display: "inline-flex",
                                color: hasActiveChild ? palette.accent : palette.muted,
                                transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                                transition: "transform 0.14s ease",
                                flexShrink: 0,
                              }}
                            >
                              <ChevronRightIcon size={12} />
                            </span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {section.title}
                            </span>
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "1px 6px",
                              borderRadius: 999,
                              backgroundColor: palette.subtleBorder,
                              color: palette.muted,
                              fontVariantNumeric: "tabular-nums",
                              flexShrink: 0,
                            }}
                          >
                            {section.items.length}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div
                            style={{
                              marginLeft: 13,
                              paddingLeft: 8,
                              marginTop: 3,
                              borderLeft: `1px solid ${palette.border}`,
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {section.items.map((lang) => renderLangRailItem(lang, section.prefix))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Right Main Content */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Big Fixed Blank Model Hero Tile */}
            <div
              style={{
                padding: "14px 20px 10px 20px",
                backgroundColor: palette.bg,
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                data-testid="new-blank-model-tile"
                onClick={handleCreateBlank}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: `1px dashed ${palette.accent}`,
                  backgroundColor: palette.accentSoft,
                  color: palette.fg,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "transform 0.12s ease, box-shadow 0.12s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background:
                        "linear-gradient(135deg, var(--ms-accent-teal, #14b8a6) 0%, var(--ms-brand, #0891b2) 100%)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <PlusIcon size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: palette.fg }}>
                      {isVrShowcaseSelected
                        ? "Blank 3D CAD Model (OpenSCAD)"
                        : `Blank ${selectedLangOption.label} Model`}
                    </div>
                    <div style={{ fontSize: 11.5, color: palette.muted, marginTop: 2 }}>
                      {isVrShowcaseSelected
                        ? "Start a fresh parametric 3D CAD & WebXR VR model (.scad), or pick any curated showcase below"
                        : `Start with an empty canvas & editor (${selectedLangOption.ext})`}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "5px 12px",
                    borderRadius: 8,
                    backgroundColor: palette.accentBg,
                    color: "#ffffff",
                    flexShrink: 0,
                  }}
                >
                  Create Blank
                </span>
              </button>
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
                        color: active ? (isDark ? "var(--ms-text-heading, #f0f6fc)" : dom.accent) : palette.muted,
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
              {/* Difficulty Progression Filter Pills (L1 Easy → L5 Hard) */}
              {!isVrShowcaseSelected && (EXAMPLE_INDEX_BY_LANG.get(selectedLang.toLowerCase())?.length ?? 0) > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: palette.muted, marginRight: 2 }}>Level:</span>
                  {(["all", 1, 2, 3, 4, 5] as const).map((lvl) => {
                    const active = selectedDifficulty === lvl;
                    const label = lvl === "all" ? "All Levels" : `L${lvl} ${DIFFICULTY_LABELS[lvl]}`;
                    return (
                      <button
                        key={String(lvl)}
                        type="button"
                        onClick={() => setSelectedDifficulty(lvl)}
                        style={{
                          border: `1px solid ${active ? palette.accent : palette.border}`,
                          backgroundColor: active ? palette.accentSoft : "transparent",
                          color: active ? palette.accent : palette.muted,
                          borderRadius: 999,
                          padding: "3px 9px",
                          fontSize: 11,
                          fontWeight: active ? 650 : 500,
                          cursor: "pointer",
                          transition: "all 0.12s ease",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
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
                  {/* Curated VR 3D Showcase & Language Starters (always visible at top) */}
                  {fallbackStarters.map((ex) => {
                    const isCurrent = currentTemplateId === ex.id;
                    const isVrFeatured = Boolean(ex.tags?.some((t) => t.toLowerCase() === "vr"));
                    const previewSvg = buildEquationFallbackPreviewSvg(ex.title, ex.category, isDark);

                    return (
                      <div
                        key={ex.id}
                        className="ms-modal-tile"
                        data-testid={`template-card-${ex.id}`}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", ex.code);
                          e.dataTransfer.setData("application/modelscript-template", JSON.stringify(ex));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => {
                          onSelectTemplate(ex);
                          onClose();
                        }}
                        onDoubleClick={() => {
                          onSelectTemplate(ex);
                          onClose();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectTemplate(ex);
                            onClose();
                          }
                        }}
                        title={`${ex.title}\nClick to open or drag onto workspace`}
                        style={{
                          border: `1px solid ${isCurrent ? palette.accent : isVrFeatured ? (isDark ? "rgba(56, 189, 248, 0.38)" : "rgba(2, 132, 199, 0.32)") : palette.border}`,
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
                          {isVrFeatured && (
                            <span
                              style={{
                                position: "absolute",
                                top: 6,
                                left: 7,
                                fontSize: 9.5,
                                fontWeight: 700,
                                letterSpacing: "0.03em",
                                padding: "2px 6px",
                                borderRadius: 999,
                                background: "linear-gradient(135deg, #0284c7, #6366f1)",
                                color: "#ffffff",
                                boxShadow: "0 2px 6px rgba(2, 132, 199, 0.35)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              <span aria-hidden="true">🥽</span>
                              <span>VR 3D</span>
                            </span>
                          )}
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
                              flexWrap: "wrap",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                              {ex.difficulty && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 650,
                                    padding: "1px 6px",
                                    borderRadius: 999,
                                    backgroundColor:
                                      ex.difficulty <= 2
                                        ? "rgba(16, 185, 129, 0.14)"
                                        : ex.difficulty === 3
                                          ? "rgba(59, 130, 246, 0.14)"
                                          : "rgba(245, 158, 11, 0.16)",
                                    color:
                                      ex.difficulty <= 2
                                        ? isDark
                                          ? "#34d399"
                                          : "#047857"
                                        : ex.difficulty === 3
                                          ? isDark
                                            ? "#60a5fa"
                                            : "#1d4ed8"
                                          : isDark
                                            ? "#fbbf24"
                                            : "#b45309",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  L{ex.difficulty} {DIFFICULTY_LABELS[ex.difficulty]}
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: 11,
                                  color: palette.muted,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {ex.category}
                              </span>
                            </span>
                            {(ex.fileCount ?? (ex.files ? Object.keys(ex.files).length : 1)) > 1 && (
                              <span
                                title={(ex.fileNames ?? Object.keys(ex.files ?? {})).join(", ")}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  backgroundColor: palette.accentSoft,
                                  color: palette.accent,
                                  fontFamily: "var(--ms-font-mono, monospace)",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {ex.fileCount ?? Object.keys(ex.files ?? {}).length} files
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

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
                        className="ms-modal-tile"
                        role="button"
                        tabIndex={0}
                        draggable={!isBusy}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", model.fqn);
                          e.dataTransfer.setData("application/modelscript-model", JSON.stringify(model));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => {
                          if (!isBusy) void handleOpenRegistryModel(model);
                        }}
                        onDoubleClick={() => {
                          if (!isBusy) void handleOpenRegistryModel(model);
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && !isBusy) {
                            e.preventDefault();
                            void handleOpenRegistryModel(model);
                          }
                        }}
                        title={`${model.fqn}\nClick to open or drag onto workspace`}
                        style={{
                          border: `1px solid ${isCurrent ? palette.accent : palette.border}`,
                          borderRadius: 12,
                          backgroundColor: palette.cardBg,
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                          cursor: isBusy ? "wait" : "pointer",
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

                            {isBusy && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: palette.accent, flexShrink: 0 }}>
                                Opening…
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
