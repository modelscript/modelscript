// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, GlobeIcon, UploadIcon } from "@primer/octicons-react";
import { Button, Dialog, FormControl, Heading, Spinner, Text, TextInput, UnderlineNav, useTheme } from "@primer/react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface AddLibraryModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onAddLibrary: (file: File | string, type: "file" | "url" | "gallery") => Promise<void>;
}

export default function AddLibraryModal({ isOpen, onDismiss, onAddLibrary }: AddLibraryModalProps) {
  const [selectedTab, setSelectedTab] = useState<"upload" | "url">("upload");
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const { colorMode } = useTheme();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        handleAdd(acceptedFiles[0], "file");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
      // Cast type if needed, but since we only ever call with "file" or "url", it should work with the prop if we keep prop wider.
      await onAddLibrary(item, type as any);
      onDismiss();
    } catch (error) {
      console.error("Failed to add library:", error);
      alert("Failed to add library. Please check the console for details.");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog
      onClose={onDismiss}
      title="Add Library"
      sx={{ width: 600, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <UnderlineNav aria-label="Add Library Methods">
          <UnderlineNav.Item
            aria-current={selectedTab === "upload" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelectedTab("upload");
            }}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <UploadIcon /> Upload
          </UnderlineNav.Item>
          <UnderlineNav.Item
            aria-current={selectedTab === "url" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelectedTab("url");
            }}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <GlobeIcon /> URL
          </UnderlineNav.Item>
        </UnderlineNav>

        <div style={{ flexGrow: 1, overflowY: "auto", minHeight: 200, paddingTop: 16 }}>
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
                  <Text>Processing library...</Text>
                </div>
              ) : (
                <>
                  <UploadIcon size={32} />
                  <Heading as="h4" sx={{ mt: 2, mb: 1 }}>
                    {isDragActive ? "Drop the ZIP file here" : "Drag & drop a ZIP file here"}
                  </Heading>
                  <Text color="fg.muted">or click to select a file</Text>
                </>
              )}
            </div>
          )}

          {selectedTab === "url" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormControl>
                <FormControl.Label>Library URL (ZIP)</FormControl.Label>
                <TextInput
                  block
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/library.zip"
                />
              </FormControl>
              <Button variant="primary" onClick={() => handleAdd(url, "url")} disabled={!url || isAdding}>
                {isAdding ? <Spinner size="small" /> : <DownloadIcon />}
                {isAdding ? " Downloading..." : " Download & Add"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
