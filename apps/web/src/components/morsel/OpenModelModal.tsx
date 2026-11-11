// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CURATED_PACKAGES, DOMAIN_FILTERS, type EngineeringDomainId } from "./componentGalleryCatalog";
import { detectLanguageFromFilename, getLanguageExtension } from "./constants";
import {
  buildEquationFallbackPreviewSvg,
  CURATED_OPEN_MODELS,
  inferModelDomain,
  type OpenModelGalleryItem,
} from "./openModelCatalog";
import {
  type DiagramPreviewResultItem,
  getClassSource,
  getDiagramPreviewSvgs,
  getMountedLibraries,
  installDependency,
  loadLibraryFromBuffer,
  type MountedLibraryEntry,
  registerFmu,
  searchClasses,
} from "./util/lsp-bridge";
import { decompressMorselPayload, resolveMorselShortlink } from "./util/permalink";
import { fetchRegistryClassSource, type StreamedRegistryModelItem, streamRegistryModels } from "./util/registry-stream";

export type OpenModelModalMode = "gallery" | "workspace" | "local";
export type OpenModelTargetView = "split" | "diagram" | "code";

export interface OpenModelPayload {
  code: string;
  dialect: string;
  title: string;
  className?: string | undefined;
  filename?: string | undefined;
  targetView: OpenModelTargetView;
}

export interface OpenModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  colorMode?: "dark" | "light" | undefined;
  currentDialect?: string | undefined;
  currentDocumentUri?: string | undefined;
  currentContent?: string | undefined;
  documentModels?: { name: string; kind: string }[] | undefined;
  selectedTreeClassName?: string | null | undefined;
  onSelectWorkspaceClass?: ((className: string) => void) | undefined;
  onOpenModel: (payload: OpenModelPayload) => void;
  onOpenLibraryHub?: (() => void) | undefined;
  toast?: {
    success?: (msg: string) => void;
    error?: (msg: string) => void;
    info?: (msg: string) => void;
  };
}

interface DynamicSearchModel {
  id: string;
  title: string;
  fqn: string;
  kind: string;
  category: Exclude<EngineeringDomainId, "all">;
  packageName: string;
  summary: string;
}

interface StagedLocalModel {
  code: string;
  filename: string;
  dialect: string;
  title: string;
  previewSvg?: string | undefined;
  nodeCount?: number | undefined;
  edgeCount?: number | undefined;
  isLoadingPreview?: boolean | undefined;
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

export const OpenModelModal: React.FC<OpenModelModalProps> = ({
  isOpen,
  onClose,
  colorMode = "dark",
  currentDialect = "modelica",
  currentDocumentUri,
  currentContent = "",
  documentModels = [],
  selectedTreeClassName,
  onSelectWorkspaceClass,
  onOpenModel,
  onOpenLibraryHub,
  toast,
}) => {
  const isDark = colorMode === "dark";
  const [mode, setMode] = useState<OpenModelModalMode>("gallery");
  const [domain, setDomain] = useState<EngineeringDomainId>("all");
  const [packageFilter, setPackageFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>(CURATED_OPEN_MODELS[0]?.id ?? "chua-circuit");

  const [mountedLibs, setMountedLibs] = useState<MountedLibraryEntry[]>([]);
  const [livePreviews, setLivePreviews] = useState<Record<string, DiagramPreviewResultItem>>({});
  const [workspacePreviews, setWorkspacePreviews] = useState<Record<string, DiagramPreviewResultItem>>({});
  const [dynamicModels, setDynamicModels] = useState<DynamicSearchModel[]>([]);
  const [streamedModels, setStreamedModels] = useState<StreamedRegistryModelItem[]>([]);
  const [registryModelPackages, setRegistryModelPackages] = useState<string[]>([]);
  const [registryModelDeps, setRegistryModelDeps] = useState<Record<string, Record<string, string>>>({});
  const [registryHasMore, setRegistryHasMore] = useState(false);
  const [registryOffset, setRegistryOffset] = useState(0);
  const [isStreamingModels, setIsStreamingModels] = useState(false);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const loadingNextModelsRef = useRef(false);

  // Local file & URL staging state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [previewBeforeOpen, setPreviewBeforeOpen] = useState(true);
  const [stagedLocal, setStagedLocal] = useState<StagedLocalModel | null>(null);
  const [shareUrlInput, setShareUrlInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshMounted = useCallback(async () => {
    const res = await getMountedLibraries();
    setMountedLibs(res.mounted ?? []);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshMounted();
    const timer = setTimeout(() => {
      if (mode === "gallery") {
        searchInputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, mode, refreshMounted]);

  // Escape & Cmd/Ctrl+K shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode("gallery");
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const mountedSet = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mountedLibs) {
      map.set(m.name.toLowerCase(), m.version);
    }
    return map;
  }, [mountedLibs]);

  const isPackageMounted = useCallback(
    (pkgName: string, bundledByDefault?: boolean) => {
      if (bundledByDefault) return true;
      return mountedSet.has(pkgName.toLowerCase());
    },
    [mountedSet],
  );

  // Hydrate live schematic SVGs for curated models whose packages are mounted
  useEffect(() => {
    if (!isOpen || mode !== "gallery") return;
    let cancelled = false;
    const itemsToHydrate = CURATED_OPEN_MODELS.filter(
      (m) => m.fqn && isPackageMounted(m.packageName, m.bundledByDefault),
    ).map((m) => ({
      id: m.id,
      className: m.fqn,
      languageId: m.dialect,
    }));
    if (itemsToHydrate.length === 0) return;

    void getDiagramPreviewSvgs(itemsToHydrate, isDark).then((previews) => {
      if (cancelled || !previews) return;
      if (Object.keys(previews).length > 0) {
        setLivePreviews((prev) => ({ ...prev, ...previews }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, isDark, isPackageMounted]);

  // Live search across mounted libraries for `model` and `block` classes
  useEffect(() => {
    if (!isOpen || mode !== "gallery") return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDynamicModels([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const resp = await searchClasses(trimmed, 24);
        if (cancelled) return;
        const curatedFqns = new Set(CURATED_OPEN_MODELS.map((c) => c.fqn).filter(Boolean));
        const results: DynamicSearchModel[] = [];
        for (const r of resp?.results ?? []) {
          const kindLower = (r.kind || "").toLowerCase();
          if (kindLower !== "model" && kindLower !== "block" && kindLower !== "class") continue;
          if (curatedFqns.has(r.compositeName)) continue;
          const rootPkg = r.compositeName.split(".")[0] || "Workspace";
          results.push({
            id: `dyn:${r.compositeName}`,
            title: r.name,
            fqn: r.compositeName,
            kind: kindLower,
            category: inferModelDomain(r.compositeName, "modelica"),
            packageName: rootPkg,
            summary: r.description || `${r.kind} in ${r.compositeName}`,
          });
          if (results.length >= 12) break;
        }
        setDynamicModels(results);

        if (results.length > 0) {
          const previews = await getDiagramPreviewSvgs(
            results.map((d) => ({ id: d.id, className: d.fqn, languageId: "modelica" })),
            isDark,
          );
          if (!cancelled && Object.keys(previews).length > 0) {
            setLivePreviews((prev) => ({ ...prev, ...previews }));
          }
        }
      } catch {
        // ignore transient search errors
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, mode, query, isDark]);

  // Hydrate workspace model diagram previews when switching to "workspace" mode
  useEffect(() => {
    if (!isOpen || mode !== "workspace") return;
    if (documentModels.length === 0 && !currentContent.trim()) return;
    let cancelled = false;

    const targetUri = currentDocumentUri || `file:///document.${getLanguageExtension(currentDialect)}`;
    const reqItems =
      documentModels.length > 0
        ? documentModels.map((dm) => ({
            id: `ws:${dm.name}`,
            uri: targetUri,
            className: dm.name,
            documentText: currentContent,
            languageId: currentDialect,
          }))
        : [
            {
              id: "ws:__active__",
              uri: targetUri,
              documentText: currentContent,
              languageId: currentDialect,
            },
          ];

    void getDiagramPreviewSvgs(reqItems, isDark).then((previews) => {
      if (!cancelled) {
        setWorkspacePreviews(previews);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, documentModels, currentContent, currentDocumentUri, currentDialect, isDark]);

  // Stream runnable models + connected diagram.svg previews live from the Ansatz Registry (/api/v1/models)
  useEffect(() => {
    if (!isOpen || mode !== "gallery") return;
    let cancelled = false;
    const controller = new AbortController();
    const delay = query.trim().length > 0 ? 120 : 0;

    setIsStreamingModels(true);
    const timer = setTimeout(() => {
      streamRegistryModels(
        {
          q: query,
          domain,
          packageName: packageFilter === "all" ? undefined : packageFilter,
          limit: 48,
          offset: 0,
          includeSvg: true,
        },
        controller.signal,
      )
        .then((res) => {
          if (cancelled) return;
          if (res.fromRegistry) {
            setStreamedModels(res.models);
            setRegistryHasMore(res.hasMore);
            setRegistryOffset(res.models.length);
            if (res.availablePackages.length > 0) {
              setRegistryModelPackages((prev) => {
                const merged = new Set(prev);
                for (const p of res.availablePackages) merged.add(p.name);
                return Array.from(merged);
              });
            }
            if (Object.keys(res.packageDependencies).length > 0) {
              setRegistryModelDeps((prev) => ({ ...prev, ...res.packageDependencies }));
            }
            const seededPreviews: Record<string, DiagramPreviewResultItem> = {};
            for (const m of res.models) {
              if (m.diagramSvg) {
                seededPreviews[m.id] = { svg: m.diagramSvg, nodeCount: 0, edgeCount: 0 };
              }
            }
            if (Object.keys(seededPreviews).length > 0) {
              setLivePreviews((prev) => ({ ...seededPreviews, ...prev }));
            }
          } else {
            setRegistryHasMore(false);
          }
          setIsStreamingModels(false);
        })
        .catch(() => {
          if (!cancelled) {
            setIsStreamingModels(false);
          }
        });
    }, delay);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [isOpen, mode, query, domain, packageFilter]);

  const loadMoreRegistryModels = useCallback(() => {
    if (!registryHasMore || loadingNextModelsRef.current) return;
    loadingNextModelsRef.current = true;
    setIsStreamingModels(true);
    void streamRegistryModels({
      q: query,
      domain,
      packageName: packageFilter === "all" ? undefined : packageFilter,
      limit: 48,
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
            setRegistryModelDeps((prev) => ({ ...prev, ...res.packageDependencies }));
          }
          const seededPreviews: Record<string, DiagramPreviewResultItem> = {};
          for (const m of res.models) {
            if (m.diagramSvg) {
              seededPreviews[m.id] = { svg: m.diagramSvg, nodeCount: 0, edgeCount: 0 };
            }
          }
          if (Object.keys(seededPreviews).length > 0) {
            setLivePreviews((prev) => ({ ...seededPreviews, ...prev }));
          }
        } else {
          setRegistryHasMore(false);
        }
      })
      .finally(() => {
        loadingNextModelsRef.current = false;
        setIsStreamingModels(false);
      });
  }, [registryHasMore, query, domain, packageFilter, registryOffset]);

  const availablePackages = useMemo(() => {
    const pkgs = new Set<string>();
    for (const m of CURATED_OPEN_MODELS) {
      pkgs.add(m.packageName);
    }
    for (const m of mountedLibs) {
      pkgs.add(m.name);
    }
    for (const pkgName of registryModelPackages) {
      pkgs.add(pkgName);
    }
    return Array.from(pkgs).sort((a, b) => a.localeCompare(b));
  }, [mountedLibs, registryModelPackages]);

  const filteredCurated = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CURATED_OPEN_MODELS.filter((item) => {
      if (domain !== "all" && item.category !== domain) return false;
      if (packageFilter !== "all" && item.packageName.toLowerCase() !== packageFilter.toLowerCase()) return false;
      if (!q) return true;
      const haystack =
        `${item.title} ${item.fqn ?? ""} ${item.packageName} ${item.dialectLabel} ${item.summary} ${item.keywords.join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [domain, packageFilter, query]);

  const filteredStreamed = useMemo(() => {
    const curatedFqns = new Set(CURATED_OPEN_MODELS.map((c) => (c.fqn || "").toLowerCase()).filter(Boolean));
    const q = query.trim().toLowerCase();
    return streamedModels.filter((item) => {
      if (curatedFqns.has(item.fqn.toLowerCase())) return false;
      if (domain !== "all" && item.category !== domain) return false;
      if (packageFilter !== "all" && item.packageName.toLowerCase() !== packageFilter.toLowerCase()) return false;
      if (!q) return true;
      const haystack = `${item.title} ${item.fqn} ${item.packageName} ${item.summary}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [streamedModels, domain, packageFilter, query]);

  const filteredDynamic = useMemo(() => {
    const seenFqns = new Set<string>();
    for (const c of CURATED_OPEN_MODELS) {
      if (c.fqn) seenFqns.add(c.fqn.toLowerCase());
    }
    for (const s of filteredStreamed) {
      seenFqns.add(s.fqn.toLowerCase());
    }
    return dynamicModels.filter((item) => {
      if (seenFqns.has(item.fqn.toLowerCase())) return false;
      if (domain !== "all" && item.category !== domain) return false;
      if (packageFilter !== "all" && item.packageName.toLowerCase() !== packageFilter.toLowerCase()) return false;
      return true;
    });
  }, [dynamicModels, filteredStreamed, domain, packageFilter]);

  const ensurePackageAndPeersMounted = useCallback(
    async (pkgName: string, pkgVersion: string, bundledByDefault?: boolean) => {
      if (isPackageMounted(pkgName, bundledByDefault)) return;
      const catalogEntry = CURATED_PACKAGES.find((p) => p.name.toLowerCase() === pkgName.toLowerCase());
      const deps = catalogEntry?.dependencies ?? registryModelDeps[pkgName];
      if (deps) {
        for (const [depName, reqRange] of Object.entries(deps)) {
          if (depName === "Complex" || depName === "ModelicaServices") continue;
          const minVer = reqRange.replace(/^[^\d]*/, "");
          const currentVer = mountedSet.get(depName.toLowerCase());
          if (!currentVer || (minVer && compareSemverSimple(currentVer, minVer) < 0)) {
            const targetVer = minVer || "4.1.0";
            await installDependency(depName, targetVer);
          }
        }
      }
      const nextMounted = await installDependency(pkgName, pkgVersion);
      if (nextMounted.length > 0) {
        setMountedLibs(nextMounted);
      } else {
        await refreshMounted();
      }
      toast?.success?.(`Mounted ${pkgName}@${pkgVersion}`);
    },
    [isPackageMounted, mountedSet, registryModelDeps, refreshMounted, toast],
  );

  const handleOpenCuratedModel = useCallback(
    async (item: OpenModelGalleryItem, targetView: OpenModelTargetView = "split") => {
      setBusyModelId(item.id);
      try {
        await ensurePackageAndPeersMounted(item.packageName, item.packageVersion, item.bundledByDefault);
        let resolvedCode = item.fallbackCode;
        if (item.fqn) {
          try {
            const { content } = await getClassSource(item.fqn);
            if (content && content.trim().length > 0) {
              resolvedCode = content;
            }
          } catch {
            // fallbackCode is already a complete runnable model
          }
        }
        onOpenModel({
          code: resolvedCode,
          dialect: item.dialect,
          title: item.title,
          className: item.fqn?.split(".").pop(),
          filename: item.suggestedFilename,
          targetView,
        });
        onClose();
      } catch (err) {
        toast?.error?.(`Could not open ${item.title}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyModelId(null);
      }
    },
    [ensurePackageAndPeersMounted, onOpenModel, onClose, toast],
  );

  const handleOpenStreamedModel = useCallback(
    async (item: StreamedRegistryModelItem, targetView: OpenModelTargetView = "split") => {
      setBusyModelId(item.id);
      try {
        await ensurePackageAndPeersMounted(item.packageName, item.packageVersion);
        let resolvedCode: string | null = null;
        try {
          const { content } = await getClassSource(item.fqn);
          if (content && content.trim().length > 0) {
            resolvedCode = content;
          }
        } catch {
          // fall through to direct registry class source endpoint
        }
        if (!resolvedCode) {
          resolvedCode = await fetchRegistryClassSource(item.packageName, item.packageVersion, item.fqn);
        }
        if (!resolvedCode) {
          toast?.error?.(`Source unavailable for '${item.fqn}'.`);
          return;
        }
        const ext = getLanguageExtension(item.dialect || "modelica");
        onOpenModel({
          code: resolvedCode,
          dialect: item.dialect || "modelica",
          title: item.title,
          className: item.title,
          filename: `${item.title}.${ext}`,
          targetView,
        });
        onClose();
      } catch (err) {
        toast?.error?.(`Could not open ${item.title}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyModelId(null);
      }
    },
    [ensurePackageAndPeersMounted, onOpenModel, onClose, toast],
  );

  const handleOpenDynamicModel = useCallback(
    async (item: DynamicSearchModel, targetView: OpenModelTargetView = "split") => {
      setBusyModelId(item.id);
      try {
        const { content, error } = await getClassSource(item.fqn);
        if (!content) {
          toast?.error?.(error || `Source unavailable for '${item.fqn}'.`);
          return;
        }
        onOpenModel({
          code: content,
          dialect: "modelica",
          title: item.title,
          className: item.title,
          filename: `${item.title}.mo`,
          targetView,
        });
        onClose();
      } finally {
        setBusyModelId(null);
      }
    },
    [onOpenModel, onClose, toast],
  );

  const stageOrOpenLocalText = useCallback(
    async (code: string, filename: string, explicitDialect?: string) => {
      setLocalError(null);
      const detectedDialect = explicitDialect || detectLanguageFromFilename(filename) || currentDialect || "modelica";
      const baseTitle = filename.replace(/\.[^.]+$/, "") || "LocalModel";

      if (!previewBeforeOpen) {
        onOpenModel({
          code,
          dialect: detectedDialect,
          title: baseTitle,
          filename,
          targetView: "split",
        });
        onClose();
        return;
      }

      setStagedLocal({
        code,
        filename,
        dialect: detectedDialect,
        title: baseTitle,
        isLoadingPreview: true,
      });

      const previewId = `local:${filename}`;
      const previews = await getDiagramPreviewSvgs(
        [
          {
            id: previewId,
            uri: `file:///__staged_${filename}`,
            documentText: code,
            languageId: detectedDialect,
          },
        ],
        isDark,
      );
      const hit = previews[previewId];
      setStagedLocal((prev) =>
        prev && prev.filename === filename
          ? {
              ...prev,
              previewSvg: hit?.svg,
              nodeCount: hit?.nodeCount ?? 0,
              edgeCount: hit?.edgeCount ?? 0,
              isLoadingPreview: false,
            }
          : prev,
      );
    },
    [currentDialect, isDark, onClose, onOpenModel, previewBeforeOpen],
  );

  const handleSelectedFile = useCallback(
    async (file: File) => {
      setLocalError(null);
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith(".fmu")) {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
          const b64 = btoa(binary);
          const fmuName = file.name.replace(/\.fmu$/i, "") || "ImportedFMU";
          await registerFmu(fmuName, b64);
          const wrapperCode = `model ${fmuName.replace(/[^A-Za-z0-9_]/g, "_")}_Harness "Co-simulation harness for ${file.name}"\n  // Registered FMU '${fmuName}' in workspace\n  Real y(start = 0);\nequation\n  der(y) = 0;\nend ${fmuName.replace(/[^A-Za-z0-9_]/g, "_")}_Harness;\n`;
          await stageOrOpenLocalText(wrapperCode, `${fmuName}.mo`, "modelica");
          toast?.success?.(`Registered FMU '${file.name}'`);
          return;
        }
        if (lower.endsWith(".zip") || lower.endsWith(".ssp")) {
          const buf = await file.arrayBuffer();
          const res = await loadLibraryFromBuffer(file.name, buf);
          await refreshMounted();
          toast?.success?.(
            `Mounted archive '${res.packageName || file.name}' (${res.fileCount} files). Browse its models in Examples & Libraries!`,
          );
          setMode("gallery");
          if (res.packageName) {
            setQuery(res.packageName);
          }
          return;
        }
        const text = await file.text();
        if (!text.trim()) {
          setLocalError(`'${file.name}' is empty.`);
          return;
        }
        await stageOrOpenLocalText(text, file.name);
      } catch (err) {
        setLocalError(`Failed to read '${file.name}': ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [refreshMounted, stageOrOpenLocalText, toast],
  );

  const handleResolveShareLink = useCallback(async () => {
    const raw = shareUrlInput.trim();
    if (!raw) return;
    setLocalError(null);
    setIsResolvingUrl(true);
    try {
      let hashPart = "";
      let morselId = "";
      if (raw.includes("#")) {
        hashPart = raw.slice(raw.indexOf("#"));
      } else if (raw.startsWith("m=")) {
        hashPart = `#${raw}`;
      }
      try {
        const parsedUrl = new URL(raw, window.location.origin);
        morselId = parsedUrl.searchParams.get("morsel") || "";
        if (!hashPart && parsedUrl.hash) {
          hashPart = parsedUrl.hash;
        }
      } catch {
        // raw token or hash string
      }

      const payload = hashPart
        ? decompressMorselPayload(hashPart)
        : morselId
          ? await resolveMorselShortlink(morselId)
          : null;

      if (!payload?.code) {
        setLocalError("Could not decode a ModelScript model from that URL or #m=... permalink.");
        return;
      }
      const dialect = payload.dialect || payload.lang || "modelica";
      const ext = getLanguageExtension(dialect);
      const fname = `${(payload.title || "SharedModel").replace(/[^A-Za-z0-9_.-]/g, "_")}.${ext}`;
      await stageOrOpenLocalText(payload.code, fname, dialect);
    } catch (err) {
      setLocalError(`Could not open share link: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsResolvingUrl(false);
    }
  }, [shareUrlInput, stageOrOpenLocalText]);

  const selectedStreamed = useMemo(
    () => filteredStreamed.find((m) => m.id === selectedId) ?? null,
    [filteredStreamed, selectedId],
  );
  const selectedDynamic = useMemo(
    () => dynamicModels.find((m) => m.id === selectedId) ?? null,
    [dynamicModels, selectedId],
  );
  const selectedCurated = useMemo(
    () =>
      selectedStreamed || selectedDynamic
        ? null
        : (CURATED_OPEN_MODELS.find((m) => m.id === selectedId) ?? filteredCurated[0] ?? null),
    [selectedId, filteredCurated, selectedStreamed, selectedDynamic],
  );

  if (!isOpen || typeof document === "undefined") return null;

  const surfaceBg = isDark ? "#0b1120" : "#ffffff";
  const panelBg = isDark ? "#0f172a" : "#f8fafc";
  const cardBg = isDark ? "#111827" : "#ffffff";
  const stageBg = isDark ? "#0d131f" : "#f8fafc";
  const borderCol = isDark ? "rgba(148, 163, 184, 0.18)" : "rgba(15, 23, 42, 0.11)";
  const textPrimary = isDark ? "#f8fafc" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#64748b";
  const brand = "#2563eb";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Open Model"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        backgroundColor: isDark ? "rgba(2, 6, 23, 0.72)" : "rgba(15, 23, 42, 0.48)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          width: "min(1060px, 96vw)",
          height: "min(760px, 90vh)",
          backgroundColor: surfaceBg,
          color: textPrimary,
          borderRadius: 16,
          border: `1px solid ${borderCol}`,
          boxShadow: isDark
            ? "0 28px 70px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255,255,255,0.04)"
            : "0 24px 60px rgba(15, 23, 42, 0.22)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Top Header & 3-Mode Segmented Control ── */}
        <div
          style={{
            padding: "16px 22px",
            borderBottom: `1px solid ${borderCol}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            backgroundColor: panelBg,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: isDark ? "rgba(37, 99, 235, 0.18)" : "rgba(37, 99, 235, 0.1)",
                border: `1px solid ${isDark ? "rgba(96, 165, 250, 0.3)" : "rgba(37, 99, 235, 0.22)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isDark ? "#60a5fa" : "#2563eb",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="2" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <rect x="10" y="2" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <rect x="5.75" y="9.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M6 4.25H10M3.75 6.5V11.75H5.75M12.25 6.5V11.75H10.25"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Open Model</div>
              <div style={{ fontSize: 12, color: textMuted }}>
                Open runnable schematics from Ansatz packages, workspace classes, or local files
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              role="tablist"
              aria-label="Open model source"
              style={{
                display: "inline-flex",
                padding: 3,
                borderRadius: 10,
                backgroundColor: isDark ? "rgba(15, 23, 42, 0.9)" : "#e2e8f0",
                border: `1px solid ${borderCol}`,
              }}
            >
              {(
                [
                  { id: "gallery", label: "Examples & Libraries" },
                  {
                    id: "workspace",
                    label: `Current Workspace${documentModels.length > 0 ? ` (${documentModels.length})` : ""}`,
                  },
                  { id: "local", label: "Local File / Link" },
                ] as const
              ).map((tab) => {
                const active = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setMode(tab.id)}
                    style={{
                      border: "none",
                      cursor: "pointer",
                      padding: "6px 13px",
                      borderRadius: 7,
                      fontSize: 12.5,
                      fontWeight: active ? 600 : 500,
                      backgroundColor: active ? (isDark ? "#1e293b" : "#ffffff") : "transparent",
                      color: active ? textPrimary : textMuted,
                      boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                      transition: "all 0.14s ease",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              aria-label="Close Open Model dialog"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: `1px solid ${borderCol}`,
                backgroundColor: "transparent",
                color: textMuted,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── MODE 1: EXAMPLES & LIBRARY MODELS WITH SCHEMATIC DIAGRAMS ── */}
        {mode === "gallery" && (
          <>
            {/* Search + Package Dropdown + Domain Filter Pills */}
            <div
              style={{
                padding: "12px 22px",
                borderBottom: `1px solid ${borderCol}`,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: "1 1 280px" }}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: textMuted,
                      pointerEvents: "none",
                    }}
                  >
                    <circle cx="7" cy="7" r="4.8" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models, circuits, mechanisms, or FQNs (e.g. Chua, PID, Hydronic, IEEE 13)..."
                    style={{
                      width: "100%",
                      height: 36,
                      padding: "0 34px 0 36px",
                      borderRadius: 9,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                      color: textPrimary,
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        border: "none",
                        background: "transparent",
                        color: textMuted,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <select
                  aria-label="Filter by package"
                  value={packageFilter}
                  onChange={(e) => setPackageFilter(e.target.value)}
                  style={{
                    height: 36,
                    padding: "0 12px",
                    borderRadius: 9,
                    border: `1px solid ${borderCol}`,
                    backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                    color: textPrimary,
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <option value="all">All Packages ({availablePackages.length})</option>
                  {availablePackages.map((pkg) => (
                    <option key={pkg} value={pkg}>
                      {pkg}
                    </option>
                  ))}
                </select>

                {onOpenLibraryHub && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenLibraryHub();
                    }}
                    style={{
                      height: 36,
                      padding: "0 12px",
                      borderRadius: 9,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: "transparent",
                      color: textMuted,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Manage Libraries…
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                {DOMAIN_FILTERS.map((df) => {
                  const active = domain === df.id;
                  return (
                    <button
                      key={df.id}
                      type="button"
                      onClick={() => setDomain(df.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 11px",
                        borderRadius: 999,
                        border: `1px solid ${active ? df.accent : borderCol}`,
                        backgroundColor: active
                          ? isDark
                            ? "rgba(37, 99, 235, 0.2)"
                            : "rgba(37, 99, 235, 0.09)"
                          : "transparent",
                        color: active ? (isDark ? "#93c5fd" : df.accent) : textMuted,
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        dangerouslySetInnerHTML={{ __html: df.svgInner }}
                      />
                      {df.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Wide Connected-Diagram Card Grid */}
            <div
              onScroll={(e) => {
                if (!registryHasMore || isStreamingModels) return;
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 280) {
                  loadMoreRegistryModels();
                }
              }}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "18px 22px",
              }}
            >
              {filteredCurated.length === 0 && filteredStreamed.length === 0 && filteredDynamic.length === 0 ? (
                <div
                  style={{
                    padding: "56px 20px",
                    textAlign: "center",
                    color: textMuted,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, color: textPrimary, marginBottom: 6 }}>
                    No matching models found
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Try clearing the domain or package filter, or switch to <strong>Local File / Link</strong> to open a
                    model from disk.
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(296px, 1fr))",
                    gap: 14,
                  }}
                >
                  {filteredCurated.map((item) => {
                    const live = livePreviews[item.id];
                    const mounted = isPackageMounted(item.packageName, item.bundledByDefault);
                    const isSelected = selectedId === item.id;
                    const isBusy = busyModelId === item.id;
                    const nodeCount = live?.nodeCount ?? item.nodeCount;
                    const edgeCount = live?.edgeCount ?? item.edgeCount;

                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        onDoubleClick={() => void handleOpenCuratedModel(item, "split")}
                        style={{
                          borderRadius: 12,
                          border: `1.5px solid ${isSelected ? brand : borderCol}`,
                          backgroundColor: cardBg,
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                          cursor: "pointer",
                          boxShadow: isSelected
                            ? "0 0 0 3px rgba(37, 99, 235, 0.18)"
                            : isDark
                              ? "0 4px 14px rgba(0,0,0,0.22)"
                              : "0 2px 8px rgba(15,23,42,0.05)",
                          transition: "border-color 0.14s ease, box-shadow 0.14s ease",
                        }}
                      >
                        {/* Blueprint Connected Schematic Stage */}
                        <div
                          style={{
                            position: "relative",
                            height: 146,
                            backgroundColor: stageBg,
                            backgroundImage: isDark
                              ? "radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)"
                              : "radial-gradient(rgba(15, 23, 42, 0.09) 1px, transparent 1px)",
                            backgroundSize: "14px 14px",
                            borderBottom: `1px solid ${borderCol}`,
                            padding: "8px 10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}
                            dangerouslySetInnerHTML={{ __html: live?.svg || item.diagramSvg }}
                          />

                          {/* Dialect Pill */}
                          <span
                            style={{
                              position: "absolute",
                              top: 8,
                              left: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10.5,
                              fontWeight: 700,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.92)",
                              border: `1px solid ${borderCol}`,
                              color: textPrimary,
                            }}
                          >
                            {item.dialectLabel}
                          </span>

                          {/* Topology Count Badge */}
                          <span
                            style={{
                              position: "absolute",
                              bottom: 7,
                              right: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 600,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.84)" : "rgba(255, 255, 255, 0.9)",
                              border: `1px solid ${borderCol}`,
                              color: textMuted,
                            }}
                          >
                            {nodeCount} blocks · {edgeCount} nets
                          </span>
                        </div>

                        {/* Metadata & Open CTA */}
                        <div
                          style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}
                        >
                          <div
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                          >
                            <div
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: textPrimary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.title}
                            </div>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 600,
                                padding: "2px 7px",
                                borderRadius: 999,
                                flexShrink: 0,
                                backgroundColor: mounted
                                  ? isDark
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : "rgba(16, 185, 129, 0.12)"
                                  : isDark
                                    ? "rgba(59, 130, 246, 0.16)"
                                    : "rgba(37, 99, 235, 0.09)",
                                color: mounted ? (isDark ? "#34d399" : "#059669") : isDark ? "#93c5fd" : "#2563eb",
                              }}
                            >
                              {mounted ? `${item.packageName} ✓` : `+ ${item.packageName}`}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: 11.5,
                              color: textMuted,
                              lineHeight: 1.42,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              minHeight: 32,
                            }}
                          >
                            {item.summary}
                          </div>

                          <div
                            style={{
                              marginTop: "auto",
                              paddingTop: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                color: textMuted,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={item.fqn || item.suggestedFilename}
                            >
                              {item.fqn || item.suggestedFilename}
                            </span>

                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleOpenCuratedModel(item, "diagram");
                                }}
                                style={{
                                  border: `1px solid ${borderCol}`,
                                  backgroundColor: "transparent",
                                  color: textPrimary,
                                  borderRadius: 7,
                                  padding: "5px 9px",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: isBusy ? "wait" : "pointer",
                                }}
                                title="Open in full-canvas Diagram view"
                              >
                                Diagram
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleOpenCuratedModel(item, "split");
                                }}
                                style={{
                                  border: "none",
                                  backgroundColor: brand,
                                  color: "#ffffff",
                                  borderRadius: 7,
                                  padding: "5px 11px",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: isBusy ? "wait" : "pointer",
                                }}
                              >
                                {isBusy ? "Opening…" : "Open"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Live Streamed Ansatz Registry Models (with pre-rendered diagram.svg) */}
                  {filteredStreamed.map((reg) => {
                    const live = livePreviews[reg.id];
                    const mounted = isPackageMounted(reg.packageName);
                    const isSelected = selectedId === reg.id;
                    const isBusy = busyModelId === reg.id;
                    const previewMarkup =
                      live?.svg || reg.diagramSvg || buildEquationFallbackPreviewSvg(reg.title, reg.fqn, isDark);

                    return (
                      <div
                        key={reg.id}
                        onClick={() => setSelectedId(reg.id)}
                        onDoubleClick={() => void handleOpenStreamedModel(reg, "split")}
                        style={{
                          borderRadius: 12,
                          border: `1.5px solid ${isSelected ? brand : borderCol}`,
                          backgroundColor: cardBg,
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                          cursor: "pointer",
                          boxShadow: isSelected
                            ? "0 0 0 3px rgba(37, 99, 235, 0.18)"
                            : isDark
                              ? "0 4px 14px rgba(0,0,0,0.22)"
                              : "0 2px 8px rgba(15,23,42,0.05)",
                          transition: "border-color 0.14s ease, box-shadow 0.14s ease",
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            height: 146,
                            backgroundColor: stageBg,
                            backgroundImage: isDark
                              ? "radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)"
                              : "radial-gradient(rgba(15, 23, 42, 0.09) 1px, transparent 1px)",
                            backgroundSize: "14px 14px",
                            borderBottom: `1px solid ${borderCol}`,
                            padding: "8px 10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}
                            dangerouslySetInnerHTML={{ __html: previewMarkup }}
                          />
                          <span
                            style={{
                              position: "absolute",
                              top: 8,
                              left: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10.5,
                              fontWeight: 700,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.92)",
                              border: `1px solid ${borderCol}`,
                              color: textPrimary,
                            }}
                          >
                            {reg.kind}
                          </span>
                          <span
                            style={{
                              position: "absolute",
                              bottom: 7,
                              right: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 600,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.84)" : "rgba(255, 255, 255, 0.9)",
                              border: `1px solid ${borderCol}`,
                              color: textMuted,
                            }}
                          >
                            {live?.svg || reg.diagramSvg ? "Ansatz Diagram" : "Ansatz Model"}
                          </span>
                        </div>

                        <div
                          style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}
                        >
                          <div
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                          >
                            <div
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: textPrimary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {reg.title}
                            </div>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 600,
                                padding: "2px 7px",
                                borderRadius: 999,
                                flexShrink: 0,
                                backgroundColor: mounted
                                  ? isDark
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : "rgba(16, 185, 129, 0.12)"
                                  : isDark
                                    ? "rgba(59, 130, 246, 0.16)"
                                    : "rgba(37, 99, 235, 0.09)",
                                color: mounted ? (isDark ? "#34d399" : "#059669") : isDark ? "#93c5fd" : "#2563eb",
                              }}
                            >
                              {mounted ? `${reg.packageName} ✓` : `+ ${reg.packageName}`}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: 11.5,
                              color: textMuted,
                              lineHeight: 1.42,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              minHeight: 32,
                            }}
                          >
                            {reg.summary}
                          </div>

                          <div
                            style={{
                              marginTop: "auto",
                              paddingTop: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                color: textMuted,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={reg.fqn}
                            >
                              {reg.fqn}
                            </span>

                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleOpenStreamedModel(reg, "diagram");
                                }}
                                style={{
                                  border: `1px solid ${borderCol}`,
                                  backgroundColor: "transparent",
                                  color: textPrimary,
                                  borderRadius: 7,
                                  padding: "5px 9px",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: isBusy ? "wait" : "pointer",
                                }}
                                title="Open in full-canvas Diagram view"
                              >
                                Diagram
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleOpenStreamedModel(reg, "split");
                                }}
                                style={{
                                  border: "none",
                                  backgroundColor: brand,
                                  color: "#ffffff",
                                  borderRadius: 7,
                                  padding: "5px 11px",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: isBusy ? "wait" : "pointer",
                                }}
                              >
                                {isBusy ? "Opening…" : "Open"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Dynamic Indexed Library Search Results */}
                  {filteredDynamic.map((dyn) => {
                    const live = livePreviews[dyn.id];
                    const isSelected = selectedId === dyn.id;
                    const isBusy = busyModelId === dyn.id;
                    const previewMarkup = live?.svg || buildEquationFallbackPreviewSvg(dyn.title, dyn.fqn, isDark);

                    return (
                      <div
                        key={dyn.id}
                        onClick={() => setSelectedId(dyn.id)}
                        onDoubleClick={() => void handleOpenDynamicModel(dyn, "split")}
                        style={{
                          borderRadius: 12,
                          border: `1.5px solid ${isSelected ? brand : borderCol}`,
                          backgroundColor: cardBg,
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            height: 146,
                            backgroundColor: stageBg,
                            borderBottom: `1px solid ${borderCol}`,
                            padding: "8px 10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{ width: "100%", height: "100%" }}
                            dangerouslySetInnerHTML={{ __html: previewMarkup }}
                          />
                          <span
                            style={{
                              position: "absolute",
                              top: 8,
                              left: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10.5,
                              fontWeight: 700,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.92)",
                              border: `1px solid ${borderCol}`,
                              color: textPrimary,
                            }}
                          >
                            {dyn.kind}
                          </span>
                          <span
                            style={{
                              position: "absolute",
                              bottom: 7,
                              right: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 600,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.84)" : "rgba(255, 255, 255, 0.9)",
                              border: `1px solid ${borderCol}`,
                              color: textMuted,
                            }}
                          >
                            {live ? `${live.nodeCount} blocks · ${live.edgeCount} nets` : "Equation model"}
                          </span>
                        </div>
                        <div
                          style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}
                        >
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: textPrimary }}>{dyn.title}</div>
                          <div style={{ fontSize: 11.5, color: textMuted, minHeight: 32 }}>{dyn.summary}</div>
                          <div
                            style={{
                              marginTop: "auto",
                              paddingTop: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                color: textMuted,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {dyn.fqn}
                            </span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleOpenDynamicModel(dyn, "split");
                              }}
                              style={{
                                border: "none",
                                backgroundColor: brand,
                                color: "#ffffff",
                                borderRadius: 7,
                                padding: "5px 12px",
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: isBusy ? "wait" : "pointer",
                              }}
                            >
                              {isBusy ? "Opening…" : "Open"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {(registryHasMore || isStreamingModels) && (
                <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                  <button
                    type="button"
                    disabled={isStreamingModels}
                    onClick={() => loadMoreRegistryModels()}
                    style={{
                      padding: "7px 16px",
                      borderRadius: 8,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: cardBg,
                      color: textPrimary,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isStreamingModels ? "wait" : "pointer",
                    }}
                  >
                    {isStreamingModels ? "Streaming models from Ansatz Registry…" : "Load more models"}
                  </button>
                </div>
              )}
            </div>

            {/* Selected Model Bottom Inspector Bar */}
            {(selectedStreamed || selectedDynamic || selectedCurated) && (
              <div
                style={{
                  padding: "12px 22px",
                  borderTop: `1px solid ${borderCol}`,
                  backgroundColor: panelBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 68,
                      height: 40,
                      borderRadius: 7,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: stageBg,
                      overflow: "hidden",
                      flexShrink: 0,
                      padding: 2,
                    }}
                    dangerouslySetInnerHTML={{
                      __html: selectedStreamed
                        ? livePreviews[selectedStreamed.id]?.svg ||
                          selectedStreamed.diagramSvg ||
                          buildEquationFallbackPreviewSvg(selectedStreamed.title, selectedStreamed.fqn, isDark)
                        : selectedDynamic
                          ? livePreviews[selectedDynamic.id]?.svg ||
                            buildEquationFallbackPreviewSvg(selectedDynamic.title, selectedDynamic.fqn, isDark)
                          : livePreviews[selectedCurated!.id]?.svg || selectedCurated!.diagramSvg,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>
                      {selectedStreamed
                        ? selectedStreamed.title
                        : selectedDynamic
                          ? selectedDynamic.title
                          : selectedCurated!.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: textMuted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedStreamed
                        ? isPackageMounted(selectedStreamed.packageName)
                          ? `${selectedStreamed.fqn} · ${selectedStreamed.packageName}@${selectedStreamed.packageVersion} ready`
                          : `Auto-mounts Ansatz package ${selectedStreamed.packageName}@${selectedStreamed.packageVersion} before opening`
                        : selectedDynamic
                          ? `${selectedDynamic.fqn} · Mounted in ${selectedDynamic.packageName}`
                          : isPackageMounted(selectedCurated!.packageName, selectedCurated!.bundledByDefault)
                            ? `${selectedCurated!.fqn || selectedCurated!.suggestedFilename} · ${selectedCurated!.packageName}@${selectedCurated!.packageVersion} ready`
                            : `Auto-mounts Ansatz package ${selectedCurated!.packageName}@${selectedCurated!.packageVersion} before opening`}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedStreamed) void handleOpenStreamedModel(selectedStreamed, "code");
                      else if (selectedDynamic) void handleOpenDynamicModel(selectedDynamic, "code");
                      else if (selectedCurated) void handleOpenCuratedModel(selectedCurated, "code");
                    }}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: "transparent",
                      color: textPrimary,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Open Code Only
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedStreamed) void handleOpenStreamedModel(selectedStreamed, "diagram");
                      else if (selectedDynamic) void handleOpenDynamicModel(selectedDynamic, "diagram");
                      else if (selectedCurated) void handleOpenCuratedModel(selectedCurated, "diagram");
                    }}
                    style={{
                      height: 34,
                      padding: "0 13px",
                      borderRadius: 8,
                      border: `1px solid ${brand}`,
                      backgroundColor: "transparent",
                      color: isDark ? "#93c5fd" : brand,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Open Full Diagram
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedStreamed) void handleOpenStreamedModel(selectedStreamed, "split");
                      else if (selectedDynamic) void handleOpenDynamicModel(selectedDynamic, "split");
                      else if (selectedCurated) void handleOpenCuratedModel(selectedCurated, "split");
                    }}
                    style={{
                      height: 34,
                      padding: "0 16px",
                      borderRadius: 8,
                      border: "none",
                      backgroundColor: brand,
                      color: "#ffffff",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Open in Split View
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── MODE 2: MODELS IN CURRENT WORKSPACE / BUFFER ── */}
        {mode === "workspace" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
            {documentModels.length === 0 ? (
              <div
                style={{
                  borderRadius: 12,
                  border: `1px solid ${borderCol}`,
                  backgroundColor: cardBg,
                  padding: "28px 24px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: "min(420px, 100%)",
                    height: 180,
                    borderRadius: 10,
                    border: `1px solid ${borderCol}`,
                    backgroundColor: stageBg,
                    padding: 10,
                  }}
                  dangerouslySetInnerHTML={{
                    __html:
                      workspacePreviews["ws:__active__"]?.svg ||
                      buildEquationFallbackPreviewSvg("Active Buffer", currentDialect.toUpperCase(), isDark),
                  }}
                />
                <div style={{ fontSize: 14, fontWeight: 700 }}>Active {currentDialect.toUpperCase()} Buffer</div>
                <div style={{ fontSize: 12.5, color: textMuted, textAlign: "center", maxWidth: 460 }}>
                  Your active buffer does not declare multiple named sub-models. Switch to{" "}
                  <strong>Examples &amp; Libraries</strong> or <strong>Local File / Link</strong> to load another model.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: textMuted, marginBottom: 14 }}>
                  Select any model or block declared in the active workspace buffer to inspect its schematic diagram:
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 14,
                  }}
                >
                  {documentModels.map((dm) => {
                    const prev = workspacePreviews[`ws:${dm.name}`];
                    const isActive = selectedTreeClassName === dm.name;
                    const svg =
                      prev?.svg || buildEquationFallbackPreviewSvg(dm.name, `${dm.kind} · Current Workspace`, isDark);
                    return (
                      <div
                        key={dm.name}
                        onClick={() => {
                          onSelectWorkspaceClass?.(dm.name);
                          onClose();
                        }}
                        style={{
                          borderRadius: 12,
                          border: `1.5px solid ${isActive ? brand : borderCol}`,
                          backgroundColor: cardBg,
                          overflow: "hidden",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            height: 146,
                            backgroundColor: stageBg,
                            borderBottom: `1px solid ${borderCol}`,
                            padding: 8,
                          }}
                        >
                          <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
                          <span
                            style={{
                              position: "absolute",
                              top: 8,
                              left: 8,
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 10.5,
                              fontWeight: 700,
                              backgroundColor: isDark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.92)",
                              border: `1px solid ${borderCol}`,
                              color: textPrimary,
                            }}
                          >
                            {dm.kind}
                          </span>
                          {prev && (
                            <span
                              style={{
                                position: "absolute",
                                bottom: 7,
                                right: 8,
                                padding: "2px 7px",
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                backgroundColor: isDark ? "rgba(15, 23, 42, 0.84)" : "rgba(255, 255, 255, 0.9)",
                                border: `1px solid ${borderCol}`,
                                color: textMuted,
                              }}
                            >
                              {prev.nodeCount} blocks · {prev.edgeCount} nets
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            padding: "11px 14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{dm.name}</div>
                            <div style={{ fontSize: 11, color: textMuted }}>
                              {isActive ? "Currently active in canvas" : "Click to switch diagram"}
                            </div>
                          </div>
                          <span
                            style={{
                              padding: "5px 11px",
                              borderRadius: 7,
                              backgroundColor: isActive ? (isDark ? "#1e293b" : "#e2e8f0") : brand,
                              color: isActive ? textPrimary : "#ffffff",
                              fontSize: 11.5,
                              fontWeight: 600,
                            }}
                          >
                            {isActive ? "Active" : "Switch"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── MODE 3: LOCAL FILE, ARCHIVE, OR SHARE LINK WITH LIVE DIAGRAM PREVIEW ── */}
        {mode === "local" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 24px",
              display: "grid",
              gridTemplateColumns: stagedLocal ? "1fr 1.15fr" : "1fr",
              gap: 18,
              alignItems: "stretch",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleSelectedFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  flex: 1,
                  minHeight: 220,
                  borderRadius: 14,
                  border: `2px dashed ${isDraggingFile ? brand : borderCol}`,
                  backgroundColor: isDraggingFile
                    ? isDark
                      ? "rgba(37, 99, 235, 0.12)"
                      : "rgba(37, 99, 235, 0.06)"
                    : panelBg,
                  padding: "28px 24px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mo,.ms,.mos,.sysml,.sysml2,.sp,.cir,.net,.dss,.raw,.pscx,.pslx,.urdf,.inp,.scad,.step,.stp,.fmu,.ssp,.zip,.owl,.ttl"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleSelectedFile(file);
                    e.target.value = "";
                  }}
                />
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    backgroundColor: isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.1)",
                    color: isDark ? "#60a5fa" : brand,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V4M12 4L7.5 8.5M12 4L16.5 8.5M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>
                  Drop a model file or archive here, or click to browse
                </div>
                <div style={{ fontSize: 12, color: textMuted, maxWidth: 440, lineHeight: 1.5 }}>
                  Supports <strong>.mo</strong>, <strong>.sysml</strong>, <strong>.sp</strong>, <strong>.dss</strong>,{" "}
                  <strong>.raw</strong>, <strong>.pscx</strong>, <strong>.urdf</strong>, <strong>.inp</strong>,{" "}
                  <strong>.fmu</strong>, <strong>.ssp</strong>, and Ansatz <strong>.zip</strong> bundles
                </div>
              </div>

              {/* Share Permalink / URL Opener */}
              <div
                style={{
                  borderRadius: 12,
                  border: `1px solid ${borderCol}`,
                  backgroundColor: panelBg,
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Open from Morsel Permalink or Share URL</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={shareUrlInput}
                    onChange={(e) => setShareUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleResolveShareLink();
                    }}
                    placeholder="Paste https://modelscript.org/morsel#m=... or ?morsel=..."
                    style={{
                      flex: 1,
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: isDark ? "#0b1120" : "#ffffff",
                      color: textPrimary,
                      fontSize: 12.5,
                    }}
                  />
                  <button
                    type="button"
                    disabled={isResolvingUrl || !shareUrlInput.trim()}
                    onClick={() => void handleResolveShareLink()}
                    style={{
                      height: 34,
                      padding: "0 14px",
                      borderRadius: 8,
                      border: "none",
                      backgroundColor: brand,
                      color: "#ffffff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isResolvingUrl ? "wait" : "pointer",
                      opacity: !shareUrlInput.trim() ? 0.55 : 1,
                    }}
                  >
                    {isResolvingUrl ? "Loading…" : "Preview / Open"}
                  </button>
                </div>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: textMuted,
                    cursor: "pointer",
                    marginTop: 2,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={previewBeforeOpen}
                    onChange={(e) => setPreviewBeforeOpen(e.target.checked)}
                  />
                  Show live schematic diagram preview before replacing editor contents
                </label>

                {localError && (
                  <div style={{ fontSize: 12, color: "#ef4444", marginTop: 4, fontWeight: 500 }}>{localError}</div>
                )}
              </div>
            </div>

            {/* Live Staged File Schematic Preview Pane */}
            {stagedLocal && (
              <div
                style={{
                  borderRadius: 14,
                  border: `1.5px solid ${brand}`,
                  backgroundColor: cardBg,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: `1px solid ${borderCol}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{stagedLocal.filename}</div>
                    <div style={{ fontSize: 11.5, color: textMuted }}>
                      Dialect: <strong>{stagedLocal.dialect}</strong> ·{" "}
                      {stagedLocal.isLoadingPreview
                        ? "Rendering schematic preview…"
                        : stagedLocal.previewSvg
                          ? `${stagedLocal.nodeCount ?? 0} blocks · ${stagedLocal.edgeCount ?? 0} nets`
                          : "Text / equation model"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStagedLocal(null)}
                    style={{
                      border: `1px solid ${borderCol}`,
                      background: "transparent",
                      color: textMuted,
                      borderRadius: 6,
                      padding: "3px 8px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 220,
                    backgroundColor: stageBg,
                    backgroundImage: isDark
                      ? "radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)"
                      : "radial-gradient(rgba(15, 23, 42, 0.09) 1px, transparent 1px)",
                    backgroundSize: "14px 14px",
                    padding: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{ width: "100%", height: "100%", maxHeight: 280 }}
                    dangerouslySetInnerHTML={{
                      __html:
                        stagedLocal.previewSvg ||
                        buildEquationFallbackPreviewSvg(stagedLocal.title, stagedLocal.filename, isDark),
                    }}
                  />
                </div>

                <div
                  style={{
                    padding: "12px 16px",
                    borderTop: `1px solid ${borderCol}`,
                    backgroundColor: panelBg,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onOpenModel({
                        code: stagedLocal.code,
                        dialect: stagedLocal.dialect,
                        title: stagedLocal.title,
                        filename: stagedLocal.filename,
                        targetView: "diagram",
                      });
                      onClose();
                    }}
                    style={{
                      height: 34,
                      padding: "0 13px",
                      borderRadius: 8,
                      border: `1px solid ${brand}`,
                      backgroundColor: "transparent",
                      color: isDark ? "#93c5fd" : brand,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Open Full Diagram
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenModel({
                        code: stagedLocal.code,
                        dialect: stagedLocal.dialect,
                        title: stagedLocal.title,
                        filename: stagedLocal.filename,
                        targetView: "split",
                      });
                      onClose();
                    }}
                    style={{
                      height: 34,
                      padding: "0 16px",
                      borderRadius: 8,
                      border: "none",
                      backgroundColor: brand,
                      color: "#ffffff",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Open in Split View
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default OpenModelModal;
