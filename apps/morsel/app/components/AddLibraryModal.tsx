// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, GlobeIcon, PackageIcon, SearchIcon, UploadIcon } from "@primer/octicons-react";
import {
  Button,
  Dialog,
  FormControl,
  Heading,
  Label,
  Spinner,
  Text,
  TextInput,
  UnderlineNav,
  useTheme,
} from "@primer/react";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import type { Translations } from "~/util/i18n";

/** A search result from the npm registry API. */
interface RegistryPackage {
  name: string;
  version: string;
  description: string | null;
  date: string;
}

/** Fetches packages from the ModelScript registry /-/v1/search endpoint. */
async function searchRegistry(apiUrl: string, text: string): Promise<RegistryPackage[]> {
  const url = `${apiUrl}/-/v1/search?text=${encodeURIComponent(text)}&size=20`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    objects: { package: RegistryPackage }[];
  };
  return data.objects.map((o) => o.package);
}

interface AddLibraryModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onAddLibrary: (file: File | string, type: "file" | "url" | "gallery") => Promise<void>;
  /** Called when a registry package is selected for install. */
  onInstallPackage?: (packageName: string, version: string) => Promise<void>;
  translations: Translations;
  /** Base URL of the ModelScript API (defaults to /api/v1). */
  registryApiUrl?: string;
}

export default function AddLibraryModal({
  isOpen,
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
  const { colorMode } = useTheme();

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
      handleAdd(acceptedFiles[0], "file");
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
      alert("Failed to add library. Please check the console for details.");
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
      alert("Failed to install package. Please check the console for details.");
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
                placeholder="Search ModelScript packages..."
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
                    color: colorMode === "dark" ? "#8b949e" : "#57606a",
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
                      border: "1px solid",
                      borderColor: colorMode === "dark" ? "#30363d" : "#d0d7de",
                      borderRadius: 6,
                      background: colorMode === "dark" ? "#161b22" : "#fff",
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
                            color: colorMode === "dark" ? "#58a6ff" : "#0969da",
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
                            color: colorMode === "dark" ? "#8b949e" : "#57606a",
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
                borderColor: isDragActive ? "#0969da" : colorMode === "dark" ? "#30363d" : "#d0d7de",
                borderRadius: 6,
                padding: 32,
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: isDragActive
                  ? colorMode === "dark"
                    ? "rgba(56,139,253,0.1)"
                    : "#ddf4ff"
                  : colorMode === "dark"
                    ? "#0d1117"
                    : "#f6f8fa",
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
