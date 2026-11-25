// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense } from "react";
import { useEditorHost } from "../../host";
import AddLibraryModal from "../AddLibraryModal";
import { AnsatzEditorLoadingScreen } from "../AnsatzEditorLoadingScreen";
import { CloudDispatchModal } from "../CloudDispatchModal";
import { getLanguageExtension } from "../constants";
import OpenModelModal from "../OpenModelModal";
import type { ExperimentOverrides } from "../SimulationParameters";
import type { Translations } from "../util/i18n";
import { didOpen, installDependency, loadLibraryFromBuffer, uninstallDependency } from "../util/lsp-bridge";
import { compressAnsatzPayload } from "../util/permalink";

const CodeEditor = React.lazy(() => import("../Code"));

export interface AnsatzModalsToast {
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

export interface AnsatzModalsProps {
  dialect?: string | undefined;
  documentUri?: string | undefined;
  onSelectDialect?: ((dialect: string) => void) | undefined;
  onSelectTreeClassName?: ((name: string | null) => void) | undefined;
  onPlaceComponent?: ((snippet: string, className?: string) => void) | undefined;
  setLastLoadedContent?: ((v: string) => void) | undefined;
  parameterOverrides?: Map<string, number> | Record<string, number> | undefined;
  isShareDialogOpen: boolean;
  setShareDialogOpen: (v: boolean) => void;
  shareButtonRef: React.RefObject<HTMLButtonElement | null>;
  documentModels: { name: string; kind: string }[];
  selectedModelIndex: number;
  selectedTreeClassName: string | null;
  editor: editor.ICodeEditor | null;
  translations: Translations;
  toast: AnsatzModalsToast;
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
  addLibraryInitialViewMode?: "components" | "libraries" | "import" | undefined;
  setContextVersion: React.Dispatch<React.SetStateAction<number>>;
  isFlattenDialogOpen: boolean;
  setFlattenDialogOpen: (v: boolean) => void;
  flattenedCode: string;
  isCloudModalOpen: boolean;
  setIsCloudModalOpen: (v: boolean) => void;
  experimentOverrides: ExperimentOverrides;
  content: string;
  onCloudResultLoaded: (data: Record<string, unknown>) => void;
}

export const AnsatzModals: React.FC<AnsatzModalsProps> = ({
  dialect = "modelica",
  documentUri,
  onSelectDialect,
  onSelectTreeClassName,
  onPlaceComponent,
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
  openFileButtonRef: _openFileButtonRef,
  loadingProgress,
  loadingMessage,
  isAddLibraryOpen,
  setIsAddLibraryOpen,
  addLibraryInitialViewMode,
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
  const editorHost = useEditorHost();
  const buildShareUrl = () => {
    const code = editor?.getValue() ?? content ?? "";
    const title = documentModels[selectedModelIndex]?.name || selectedTreeClassName || "ModelScriptModel";
    const encoded = compressAnsatzPayload({
      v: 1,
      lang: dialect,
      dialect,
      code,
      title,
    });
    return `${window.location.protocol}//${window.location.host}/ansatz#m=${encoded}`;
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
                      ansatzPayload: {
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
                        ansatzPayload: { code, title, dialect },
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
                  const shortLink = editorHost.createShortLink
                    ? await editorHost.createShortLink({ code, dialect, title, view: "diagram" })
                    : null;
                  if (!shortLink?.id && !shortLink?.shortCode) throw new Error("Shortlink unavailable");
                  const snippet = `<script src="${origin}/static/embed.js" defer></script>\n<ansatz-editor ansatz="${shortLink.id ?? shortLink.shortCode}" height="480px"></ansatz-editor>`;
                  await navigator.clipboard.writeText(snippet);
                  toast.success("Copied <ansatz-editor> intranet embed snippet!");
                } catch {
                  const fallbackSrc = buildShareUrl()
                    .replace("/editor", "/embed/editor")
                    .replace("/editor", "/embed/editor")
                    .replace("/ansatz", "/embed/editor");
                  const snippet = `<script src="${origin}/static/embed.js" defer></script>\n<ansatz-editor src="${fallbackSrc}" height="480px"></ansatz-editor>`;
                  await navigator.clipboard.writeText(snippet);
                  toast.success("Copied <ansatz-editor> embed snippet!");
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
          onClose={() => {
            setDirtyDialogOpen(false);
            setPendingSelection(null);
          }}
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

      <OpenModelModal
        isOpen={isOpenFileDialogOpen}
        onClose={() => setIsOpenFileDialogOpen(false)}
        colorMode={colorMode}
        currentDialect={dialect}
        currentDocumentUri={documentUri}
        currentContent={editor?.getValue() ?? content}
        documentModels={documentModels}
        selectedTreeClassName={selectedTreeClassName}
        onSelectWorkspaceClass={(clsName) => {
          onSelectTreeClassName?.(clsName);
        }}
        onOpenLibraryHub={() => setIsAddLibraryOpen(true)}
        toast={toast}
        onOpenModel={(payload) => {
          const targetDialect = payload.dialect || dialect;
          editor?.setValue(payload.code);
          setLastLoadedContent?.(payload.code);
          if (payload.className) {
            onSelectTreeClassName?.(payload.className);
          }
          if (targetDialect !== dialect) {
            onSelectDialect?.(targetDialect);
          } else {
            const targetUri = documentUri || `file:///document.${getLanguageExtension(targetDialect)}`;
            didOpen(targetUri, payload.code, targetDialect);
            setContextVersion((v) => v + 1);
          }
          if (typeof window !== "undefined") {
            const viewCmd =
              payload.targetView === "diagram"
                ? "view:diagram"
                : payload.targetView === "code"
                  ? "view:code"
                  : "view:split";
            window.dispatchEvent(new CustomEvent("modelscript:ansatz-command", { detail: { action: viewCmd } }));
          }
        }}
      />

      {loadingProgress < 100 && (
        <AnsatzEditorLoadingScreen
          colorMode={colorMode}
          loadingProgress={loadingProgress}
          loadingMessage={loadingMessage}
        />
      )}

      {isAddLibraryOpen && (
        <AddLibraryModal
          isOpen={isAddLibraryOpen}
          initialViewMode={addLibraryInitialViewMode}
          onDismiss={() => setIsAddLibraryOpen(false)}
          translations={translations}
          documentUri={documentUri}
          dialect={dialect}
          colorMode={colorMode}
          onPlaceComponent={onPlaceComponent}
          onInstallPackage={async (packageName, version) => {
            await installDependency(packageName, version);
            setContextVersion((v) => v + 1);
            try {
              const channel = new BroadcastChannel("modelscript:host-bridge");
              channel.postMessage({
                type: "MODELSCRIPT_INSTALL_PACKAGE",
                name: packageName,
                version: version || "latest",
                requestId: `ansatz-${Date.now()}`,
              });
              channel.close();
            } catch {
              // ignore if BroadcastChannel unsupported
            }
          }}
          onUninstallPackage={async (packageName) => {
            await uninstallDependency(packageName);
            setContextVersion((v) => v + 1);
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
              toast.error("Failed to add library: " + (error instanceof Error ? error.message : String(error)));
              throw error;
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
