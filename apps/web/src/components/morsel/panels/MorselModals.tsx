// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense } from "react";
import { createMorselShortLink } from "../../../api";
import AddLibraryModal from "../AddLibraryModal";
import { CloudDispatchModal } from "../CloudDispatchModal";
import { detectLanguageFromFilename, getLanguageExtension } from "../constants";
import OpenFileDropzone from "../OpenFileDropzone";
import { didOpen, installDependency, loadLibraryFromBuffer } from "../util/lsp-bridge";
import { compressMorselPayload } from "../util/permalink";

const CodeEditor = React.lazy(() => import("../Code"));

export interface MorselModalsProps {
  dialect?: string | undefined;
  documentUri?: string | undefined;
  onSelectDialect?: ((dialect: string) => void) | undefined;
  setLastLoadedContent?: ((v: string) => void) | undefined;
  parameterOverrides?: Map<string, number> | Record<string, number> | undefined;
  isShareDialogOpen: boolean;
  setShareDialogOpen: (v: boolean) => void;
  shareButtonRef: React.RefObject<HTMLButtonElement | null>;
  documentModels: { name: string; kind: string }[];
  selectedModelIndex: number;
  selectedTreeClassName: string | null;
  editor: editor.ICodeEditor | null;
  translations: any;
  toast: any;
  colorMode: "dark" | "light";
  isDirtyDialogOpen: boolean;
  setDirtyDialogOpen: (v: boolean) => void;
  pendingSelection: string | null;
  setPendingSelection: (v: string | null) => void;
  loadClass: (name: string) => void;
  isOpenFileDialogOpen: boolean;
  setIsOpenFileDialogOpen: (v: boolean) => void;
  openFileButtonRef: React.RefObject<HTMLButtonElement | null>;
  loadingProgress: number;
  loadingMessage: string;
  isAddLibraryOpen: boolean;
  setIsAddLibraryOpen: (v: boolean) => void;
  setContextVersion: React.Dispatch<React.SetStateAction<number>>;
  isFlattenDialogOpen: boolean;
  setFlattenDialogOpen: (v: boolean) => void;
  flattenedCode: string;
  isCloudModalOpen: boolean;
  setIsCloudModalOpen: (v: boolean) => void;
  experimentOverrides: any;
  content: string;
  onCloudResultLoaded: (data: any) => void;
}

export const MorselModals: React.FC<MorselModalsProps> = ({
  dialect = "modelica",
  documentUri,
  onSelectDialect,
  setLastLoadedContent,
  parameterOverrides,
  isShareDialogOpen,
  setShareDialogOpen,
  shareButtonRef,
  documentModels,
  selectedModelIndex,
  selectedTreeClassName,
  editor,
  translations,
  toast,
  colorMode,
  isDirtyDialogOpen,
  setDirtyDialogOpen,
  pendingSelection,
  setPendingSelection,
  loadClass,
  isOpenFileDialogOpen,
  setIsOpenFileDialogOpen,
  openFileButtonRef,
  loadingProgress,
  loadingMessage,
  isAddLibraryOpen,
  setIsAddLibraryOpen,
  setContextVersion,
  isFlattenDialogOpen,
  setFlattenDialogOpen,
  flattenedCode,
  isCloudModalOpen,
  setIsCloudModalOpen,
  experimentOverrides,
  content,
  onCloudResultLoaded,
}) => {
  const buildShareUrl = () => {
    const code = editor?.getValue() ?? content ?? "";
    const title = documentModels[selectedModelIndex]?.name || selectedTreeClassName || "ModelScriptModel";
    const encoded = compressMorselPayload({
      v: 1,
      lang: dialect,
      dialect,
      code,
      title,
    });
    return `${window.location.protocol}//${window.location.host}/playground#m=${encoded}`;
  };

  const resolvedOverridesObj =
    parameterOverrides instanceof Map
      ? Object.fromEntries(parameterOverrides)
      : parameterOverrides && typeof parameterOverrides === "object"
        ? parameterOverrides
        : undefined;

  return (
    <>
      {isShareDialogOpen && (
        <Dialog
          title={translations.shareModelTitle}
          onClose={() => setShareDialogOpen(false)}
          returnFocusRef={shareButtonRef}
          footerButtons={[
            {
              buttonType: "primary",
              content: "Publish to Feed",
              onClick: () => {
                const code = editor?.getValue() ?? "";
                const title = documentModels[selectedModelIndex]?.name || selectedTreeClassName || "ModelScriptModel";
                window.dispatchEvent(
                  new CustomEvent("modelscript:open-compose", {
                    detail: {
                      content: `Interactive physical schematic: **${title}** ⚡`,
                      morselPayload: {
                        code,
                        title,
                        dialect,
                      },
                    },
                  }),
                );
                if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                  window.parent.postMessage(
                    {
                      type: "MODELSCRIPT_SHARE_TO_FEED",
                      payload: {
                        title,
                        content: `Interactive physical schematic: **${title}** ⚡`,
                        morselPayload: { code, title, dialect },
                      },
                    },
                    window.location.origin,
                  );
                }
                setShareDialogOpen(false);
              },
            },
            {
              buttonType: "normal",
              content: "Copy Intranet Embed",
              onClick: async () => {
                const code = editor?.getValue() ?? content ?? "";
                const title = documentModels[selectedModelIndex]?.name || selectedTreeClassName || "ModelScriptModel";
                const origin = `${window.location.protocol}//${window.location.host}`;
                try {
                  const shortLink = await createMorselShortLink({ code, dialect, title, view: "diagram" });
                  const snippet = `<script src="${origin}/static/embed.js" defer></script>\n<modelscript-morsel morsel="${shortLink.id}" height="480px"></modelscript-morsel>`;
                  await navigator.clipboard.writeText(snippet);
                  toast.success("Copied <modelscript-morsel> intranet embed snippet!");
                } catch {
                  const fallbackSrc = buildShareUrl().replace("/playground", "/embed/playground");
                  const snippet = `<script src="${origin}/static/embed.js" defer></script>\n<modelscript-morsel src="${fallbackSrc}" height="480px"></modelscript-morsel>`;
                  await navigator.clipboard.writeText(snippet);
                  toast.success("Copied <modelscript-morsel> embed snippet!");
                }
                setShareDialogOpen(false);
              },
            },
            {
              buttonType: "normal",
              content: translations.copyToClipboard,
              onClick: async () => {
                await navigator.clipboard.writeText(buildShareUrl());
                toast.success(translations.copiedToClipboard);
                setShareDialogOpen(false);
              },
            },
          ]}
        >
          <div style={{ wordBreak: "break-all" }}>{buildShareUrl()}</div>
        </Dialog>
      )}

      {isDirtyDialogOpen && (
        <Dialog
          title={translations.unsavedChanges}
          onClose={() => setDirtyDialogOpen(false)}
          footerButtons={[
            {
              buttonType: "normal",
              content: translations.cancel,
              onClick: () => {
                setDirtyDialogOpen(false);
                setPendingSelection(null);
              },
            },
            {
              buttonType: "danger",
              content: translations.discardChanges,
              onClick: () => {
                setDirtyDialogOpen(false);
                if (pendingSelection) {
                  loadClass(pendingSelection);
                  setPendingSelection(null);
                }
              },
            },
          ]}
        >
          {translations.unsavedChangesMessage}
        </Dialog>
      )}

      {isOpenFileDialogOpen && (
        <Dialog
          title={translations.openFile}
          onClose={() => setIsOpenFileDialogOpen(false)}
          returnFocusRef={openFileButtonRef}
        >
          <OpenFileDropzone
            translations={translations}
            onFileContent={(newContent, filename) => {
              const detectedDialect = (filename ? detectLanguageFromFilename(filename) : null) || dialect;
              editor?.setValue(newContent);
              setLastLoadedContent?.(newContent);
              if (detectedDialect !== dialect) {
                onSelectDialect?.(detectedDialect);
              } else {
                const targetUri = documentUri || `file:///document.${getLanguageExtension(detectedDialect)}`;
                didOpen(targetUri, newContent, detectedDialect);
                setContextVersion((v) => v + 1);
              }
              setIsOpenFileDialogOpen(false);
            }}
            colorMode={colorMode || "light"}
          />
        </Dialog>
      )}

      {loadingProgress < 100 && (
        <div
          id="morsel-app-loader"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colorMode === "dark" ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)",
            zIndex: 9999,
            gap: 12,
          }}
        >
          <div>
            <img
              src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
              alt="ModelScript"
              style={{ marginBottom: 8 }}
            />
          </div>
          <div
            style={{
              width: 300,
              height: 6,
              borderRadius: 3,
              backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${loadingProgress}%`,
                height: "100%",
                borderRadius: 3,
                backgroundColor: "#1f6feb",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span style={{ fontSize: 13, color: colorMode === "dark" ? "#8b949e" : "#656d76" }}>{loadingMessage}</span>
        </div>
      )}

      {isAddLibraryOpen && (
        <AddLibraryModal
          isOpen={isAddLibraryOpen}
          onDismiss={() => setIsAddLibraryOpen(false)}
          translations={translations}
          onInstallPackage={async (packageName, version) => {
            try {
              await installDependency(packageName, version);
              setContextVersion((v) => v + 1);
            } catch (e) {
              console.error("Failed to install package:", e);
              toast.error("Failed to install package: " + (e instanceof Error ? e.message : String(e)));
            }
          }}
          onAddLibrary={async (item, type) => {
            try {
              if (type === "file" && item instanceof File) {
                const buf = new Uint8Array(await item.arrayBuffer());
                await loadLibraryFromBuffer(buf, item.name);
                setContextVersion((v) => v + 1);
                toast.success(`Loaded library '${item.name}'.`);
              } else if (type === "url" && typeof item === "string") {
                const res = await fetch(item);
                if (!res.ok) {
                  throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }
                const buf = new Uint8Array(await res.arrayBuffer());
                const urlFilename = item.split("/").pop()?.split("?")[0] || "RemoteLibrary.mo";
                await loadLibraryFromBuffer(buf, urlFilename);
                setContextVersion((v) => v + 1);
                toast.success(`Loaded library from '${urlFilename}'.`);
              }
            } catch (error) {
              console.error(error);
              toast.error("Failed to add library: " + ((error as any)?.message ?? String(error)));
            }
          }}
        />
      )}

      {isFlattenDialogOpen && (
        <Dialog
          title="Flattened Model"
          onClose={() => setFlattenDialogOpen(false)}
          width="xlarge"
          footerButtons={[
            {
              buttonType: "normal",
              content: "Copy to clipboard",
              onClick: async () => {
                await navigator.clipboard.writeText(flattenedCode);
                toast.success("Copied to clipboard.");
              },
            },
            {
              buttonType: "normal",
              content: "Close",
              onClick: () => setFlattenDialogOpen(false),
            },
          ]}
        >
          <div style={{ height: "60vh", border: "1px solid " + (colorMode === "dark" ? "#30363d" : "#d0d7de") }}>
            <Suspense fallback={null}>
              <CodeEditor
                uri={"flattened.mo"}
                content={flattenedCode}
                setEditor={() => {}}
                theme={colorMode === "dark" ? "vs-dark" : "light"}
                embed={false}
                readOnly={true}
              />
            </Suspense>
          </div>
        </Dialog>
      )}

      <CloudDispatchModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        modelName={selectedTreeClassName || "Model"}
        dialect={dialect}
        sourceCode={editor?.getValue() || content}
        parameterOverrides={resolvedOverridesObj}
        experimentConfig={{
          startTime: experimentOverrides.startTime,
          stopTime: experimentOverrides.stopTime,
          interval: experimentOverrides.interval,
          tolerance: experimentOverrides.tolerance,
          numberOfIntervals: experimentOverrides.numberOfIntervals,
          solver: experimentOverrides.solver,
          parameterOverrides: resolvedOverridesObj,
        }}
        onResultLoaded={onCloudResultLoaded}
      />
    </>
  );
};
