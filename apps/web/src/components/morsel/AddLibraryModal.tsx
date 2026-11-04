// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, GlobeIcon, PackageIcon, SearchIcon, UploadIcon } from "@primer/octicons-react";
import { Button, Dialog, FormControl, Heading, Label, Text, TextInput, UnderlineNav } from "@primer/react";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import Spinner from "../Spinner";
import { useToast } from "../ToastContext";
import type { Translations } from "./util/i18n";

/** A search result from the npm registry API. */
interface RegistryPackage {
  name: string;
  version: string;
  description: string | null;
  date: string;
}

const CURATED_STDLIB_PACKAGES: RegistryPackage[] = [
  {
    name: "Modelica",
    version: "4.1.0",
    description: "Modelica Standard Library — multi-domain physical modeling (Electrical, Mechanical, Fluid, Thermal)",
    date: "2026-01-01",
  },
  {
    name: "SysML",
    version: "2026.3.0",
    description: "OMG Systems Modeling Language (SysML v2) & KerML Standard Library",
    date: "2026-03-01",
  },
];

/** Fetches packages from the Ansatz registry (`/api/v1/packages`, `/api/v1/libraries`, or `/-/v1/search`). */
async function searchRegistry(apiUrl: string, text: string): Promise<RegistryPackage[]> {
  const base = (apiUrl || "/api/v1").replace(/\/+$/, "");
  const q = text.trim();
  const encodedQ = q ? `?q=${encodeURIComponent(q)}` : "";
  const results: RegistryPackage[] = [];
  const seen = new Set<string>();

  for (const endpoint of [`${base}/packages${encodedQ}`, `${base}/libraries${encodedQ}`]) {
    try {
      const resp = await fetch(endpoint);
      if (resp.ok) {
        const data = (await resp.json()) as {
          packages?: { name: string; latestVersion?: string; versions?: string[]; description?: string }[];
        };
        if (Array.isArray(data.packages)) {
          for (const pkg of data.packages) {
            if (!seen.has(pkg.name.toLowerCase())) {
              seen.add(pkg.name.toLowerCase());
              results.push({
                name: pkg.name,
                version: pkg.latestVersion || pkg.versions?.[0] || "1.0.0",
                description: pkg.description || null,
                date: "",
              });
            }
          }
          break;
        }
      }
    } catch {
      // try next endpoint
    }
  }

  if (results.length === 0) {
    try {
      const url = `${apiUrl}/-/v1/search?text=${encodeURIComponent(text)}&size=20`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = (await resp.json()) as {
          objects: { package: RegistryPackage }[];
        };
        for (const o of data.objects || []) {
          if (!seen.has(o.package.name.toLowerCase())) {
            seen.add(o.package.name.toLowerCase());
            results.push(o.package);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const lowerQ = q.toLowerCase();
  for (const std of CURATED_STDLIB_PACKAGES) {
    if (
      !seen.has(std.name.toLowerCase()) &&
      (!lowerQ ||
        std.name.toLowerCase().includes(lowerQ) ||
        (std.description && std.description.toLowerCase().includes(lowerQ)))
    ) {
      results.push(std);
    }
  }

  return results;
}

interface AddLibraryModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onAddLibrary: (file: File | string, type: "file" | "url" | "gallery") => Promise<void>;
  /** Called when a registry package is selected for install. */
  onInstallPackage?: ((packageName: string, version: string) => Promise<void>) | undefined;
  translations: Translations;
  /** Base URL of the ModelScript API (defaults to /api/v1). */
  registryApiUrl?: string | undefined;
}

export default function AddLibraryModal({
  isOpen: _isOpen,
  onDismiss,
  onAddLibrary,
  onInstallPackage,
  translations,
  registryApiUrl = "",
}: AddLibraryModalProps) {
  const [selectedTab, setSelectedTab] = useState<"registry" | "upload" | "url">("registry");
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<RegistryPackage[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingPkg, setInstallingPkg] = useState<string | null>(null);
  const toast = useToast();

  // Search the registry when the user types
  useEffect(() => {
    if (selectedTab !== "registry") return;
    const debounce = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchRegistry(registryApiUrl, searchText);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchText, selectedTab, registryApiUrl]);

  // Load initial results when switching to registry tab
  useEffect(() => {
    if (selectedTab === "registry" && searchResults.length === 0 && !searching) {
      setSearching(true);
      searchRegistry(registryApiUrl, "")
        .then((results) => setSearchResults(results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }
  }, [selectedTab]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      handleAdd(acceptedFiles[0]!, "file");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
    maxFiles: 1,
  });

  const handleAdd = async (item: File | string, type: "file" | "url") => {
    setIsAdding(true);
    try {
      await onAddLibrary(item, type);
      onDismiss();
    } catch (error) {
      console.error("Failed to add library:", error);
      toast.error("Failed to add library. Please check the console for details.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleInstall = async (pkg: RegistryPackage) => {
    if (!onInstallPackage) return;
    setInstallingPkg(pkg.name);
    try {
      await onInstallPackage(pkg.name, pkg.version);
      onDismiss();
    } catch (error) {
      console.error("Failed to install package:", error);
      toast.error("Failed to install package. Please check the console for details.");
    } finally {
      setInstallingPkg(null);
    }
  };

  return (
    <Dialog onClose={onDismiss} title={translations.addLibrary}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <UnderlineNav aria-label={translations.addLibraryMethods}>
          <UnderlineNav.Item
            aria-current={selectedTab === "registry" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelectedTab("registry");
            }}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <PackageIcon /> Registry
          </UnderlineNav.Item>
          <UnderlineNav.Item
            aria-current={selectedTab === "upload" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelectedTab("upload");
            }}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <UploadIcon /> {translations.upload}
          </UnderlineNav.Item>
          <UnderlineNav.Item
            aria-current={selectedTab === "url" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelectedTab("url");
            }}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <GlobeIcon /> {translations.url}
          </UnderlineNav.Item>
        </UnderlineNav>

        <div style={{ flexGrow: 1, overflowY: "auto", minHeight: 200, paddingTop: 16 }}>
          {/* ── Registry search tab ── */}
          {selectedTab === "registry" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <TextInput
                block
                leadingVisual={SearchIcon}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search engineering packages..."
              />

              {searching && (
                <div style={{ textAlign: "center", padding: 24 }}>
                  <Spinner size="medium" />
                </div>
              )}

              {!searching && searchResults.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--color-fg-muted)",
                  }}
                >
                  <PackageIcon size={32} />
                  <Text as="p" style={{ marginTop: 8 }}>
                    {searchText ? "No packages found" : "Search to find packages"}
                  </Text>
                </div>
              )}

              {!searching &&
                searchResults.map((pkg) => (
                  <div
                    key={pkg.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      border: "1px solid var(--color-border-default)",
                      borderRadius: 6,
                      background: "var(--color-canvas-subtle)",
                      transition: "border-color 0.2s",
                    }}
                  >
                    <PackageIcon size={20} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Text
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            color: "var(--color-accent-fg)",
                          }}
                        >
                          {pkg.name}
                        </Text>
                        <Label variant="secondary" style={{ fontSize: 10 }}>
                          {pkg.version}
                        </Label>
                      </div>
                      {pkg.description && (
                        <Text
                          as="p"
                          style={{
                            fontSize: 12,
                            color: "var(--color-fg-muted)",
                            margin: "2px 0 0",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {pkg.description}
                        </Text>
                      )}
                    </div>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => handleInstall(pkg)}
                      disabled={installingPkg === pkg.name}
                    >
                      {installingPkg === pkg.name ? <Spinner size="small" /> : <DownloadIcon size={14} />}
                      {installingPkg === pkg.name ? " Installing…" : " Install"}
                    </Button>
                  </div>
                ))}
            </div>
          )}

          {/* ── Upload tab ── */}
          {selectedTab === "upload" && (
            <div
              {...getRootProps()}
              style={{
                border: "2px dashed",
                borderColor: isDragActive ? "var(--color-accent-emphasis)" : "var(--color-border-default)",
                borderRadius: 6,
                padding: 32,
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: isDragActive ? "var(--color-accent-subtle)" : "var(--color-canvas-subtle)",
                transition: "all 0.2s",
              }}
            >
              <input {...getInputProps()} />
              {isAdding ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <Spinner />
                  <Text>{translations.processingLibrary}</Text>
                </div>
              ) : (
                <>
                  <UploadIcon size={32} />
                  <Heading as="h4" style={{ marginTop: 8, marginBottom: 4 }}>
                    {isDragActive ? translations.dropZipHere : translations.dragDropZip}
                  </Heading>
                  <Text color="fg.muted">{translations.clickToSelectFile}</Text>
                </>
              )}
            </div>
          )}

          {/* ── URL tab ── */}
          {selectedTab === "url" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormControl>
                <FormControl.Label>{translations.libraryUrl}</FormControl.Label>
                <TextInput
                  block
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/library.zip"
                />
              </FormControl>
              <Button variant="primary" onClick={() => handleAdd(url, "url")} disabled={!url || isAdding}>
                {isAdding ? <Spinner size="small" /> : <DownloadIcon />}
                {isAdding ? ` ${translations.downloading}` : ` ${translations.downloadAndAdd}`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
