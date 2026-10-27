// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense } from "react";
import AddLibraryModal from "../AddLibraryModal";
import { CloudDispatchModal } from "../CloudDispatchModal";
import { detectLanguageFromFilename } from "../constants";
import OpenFileDropzone from "../OpenFileDropzone";
import { installDependency, loadLibraryFromBuffer } from "../util/lsp-bridge";

const CodeEditor = React.lazy(() => import("../Code"));

export interface MorselModalsProps {
  dialect?: string | undefined;
  onSelectDialect?: ((dialect: string) => void) | undefined;
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
  onSelectDialect,
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
              content: translations.copyToClipboard,
              onClick: async () => {
                await navigator.clipboard.writeText(
                  `${window.location.protocol}//${window.location.host}/#${dialect}=${encodeURIComponent(editor?.getValue() ?? "")}`,
                );
                toast.success(translations.copiedToClipboard);
                setShareDialogOpen(false);
              },
            },
          ]}
        >
          <div
            style={{ wordBreak: "break-all" }}
          >{`${window.location.protocol}//${window.location.host}/#${dialect}=${encodeURIComponent(editor?.getValue() ?? "")}`}</div>
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
              if (filename) {
                const detected = detectLanguageFromFilename(filename);
                if (detected && detected !== dialect) {
                  onSelectDialect?.(detected);
                }
              }
              editor?.setValue(newContent);
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
          <a href="https://github.com/modelscript/modelscript" target="_blank" rel="noopener noreferrer">
            <img
              src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
              alt="Morsel"
              style={{ marginBottom: 8 }}
            />
          </a>
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
        sourceCode={editor?.getValue() || content}
        experimentConfig={{
          startTime: experimentOverrides.startTime,
          stopTime: experimentOverrides.stopTime,
          interval: experimentOverrides.interval,
        }}
        onResultLoaded={onCloudResultLoaded}
      />
    </>
  );
};
