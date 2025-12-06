// SPDX-License-Identifier: AGPL-3.0-or-later

import { type DataUrl } from "parse-data-url";
import { ContentType, decodeDataUrl, encodeDataUrl, ModelicaClassInstance } from "@modelscript/modelscript";
import { Dialog, IconButton, Label, PageHeader, SegmentedControl, useTheme } from "@primer/react";
import { editor } from "monaco-editor";
import {
  CodeIcon,
  LinkExternalIcon,
  MoonIcon,
  ShareAndroidIcon,
  SplitViewIcon,
  SunIcon,
  UnwrapIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import CodeEditor from "./code";
import DiagramEditor from "./diagram";

interface MorselEditorProps {
  dataUrl: DataUrl | null;
  embed: boolean;
}

enum View {
  CODE,
  DIAGRAM,
  SPLIT,
}

export default function MorselEditor(props: MorselEditorProps) {
  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [isEmbedDialogOpen, setEmbedDialogOpen] = useState(false);
  const embedButtonRef = useRef<HTMLButtonElement>(null);
  const [content] = decodeDataUrl(props.dataUrl ?? null);
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);
  const [classInstance, setClassInstance] = useState<ModelicaClassInstance | null>(null);
  const [view, setView] = useState<View>(View.SPLIT);
  const { colorMode, setColorMode } = useTheme();
  useEffect(() => {
    setColorMode(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      return "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
  return (
    <>
      <title>Morsel | ModelScript.org</title>
      <div className="d-flex flex-column" style={{ height: "100vh" }}>
        <div className="border-bottom">
          <PageHeader className={props.embed ? "p-2" : "p-3"}>
            <PageHeader.TitleArea>
              <PageHeader.LeadingVisual>
                <img
                  src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
                  alt="Morsel"
                  title="Morsel"
                  style={{ cursor: props.embed ? "default" : "pointer" }}
                  onClick={() => {
                    if (!props.embed) {
                      window.location.href = "/";
                    }
                  }}
                />
              </PageHeader.LeadingVisual>
            </PageHeader.TitleArea>
            <PageHeader.Actions>
              <Label size="small" variant="success" className="mx-1">
                Modelica
              </Label>
              <SegmentedControl size="small">
                <SegmentedControl.IconButton
                  icon={UnwrapIcon}
                  aria-label="Code View"
                  title="Code View"
                  onClick={() => setView(View.CODE)}
                ></SegmentedControl.IconButton>
                <SegmentedControl.IconButton
                  icon={SplitViewIcon}
                  aria-label="Split View"
                  title="Split View"
                  defaultSelected
                  onClick={() => setView(View.SPLIT)}
                ></SegmentedControl.IconButton>
                <SegmentedControl.IconButton
                  icon={WorkflowIcon}
                  aria-label="Diagram"
                  title="Diagram View"
                  onClick={() => setView(View.DIAGRAM)}
                ></SegmentedControl.IconButton>
              </SegmentedControl>
              <IconButton
                icon={ShareAndroidIcon}
                size="small"
                variant="invisible"
                aria-label="Share Morsel"
                ref={shareButtonRef}
                onClick={() => setShareDialogOpen(!isShareDialogOpen)}
              />
              {isShareDialogOpen && (
                <Dialog
                  title="Share Morsel"
                  onClose={() => setShareDialogOpen(false)}
                  returnFocusRef={shareButtonRef}
                  footerButtons={[
                    {
                      buttonType: "normal",
                      content: "Copy to clipboard",
                      onClick: async () => {
                        await navigator.clipboard.writeText(
                          `${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}`,
                        );
                        alert("Copied to clipboard.");
                        setShareDialogOpen(false);
                      },
                    },
                  ]}
                >
                  <div
                    style={{ wordBreak: "break-all" }}
                  >{`${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}`}</div>
                </Dialog>
              )}
              <IconButton
                icon={colorMode === "dark" ? SunIcon : MoonIcon}
                size="small"
                variant="invisible"
                aria-label={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
                onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
              />
              {!props.embed && (
                <IconButton
                  icon={CodeIcon}
                  size="small"
                  variant="invisible"
                  aria-label="Embed Morsel"
                  ref={embedButtonRef}
                  onClick={() => setEmbedDialogOpen(!isEmbedDialogOpen)}
                />
              )}
              {isEmbedDialogOpen && (
                <Dialog
                  title="Embed Morsel"
                  onClose={() => setEmbedDialogOpen(false)}
                  returnFocusRef={embedButtonRef}
                  footerButtons={[
                    {
                      buttonType: "normal",
                      content: "Copy to clipboard",
                      onClick: async () => {
                        await navigator.clipboard.writeText(
                          `<iframe width="600" height="400" src="${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}"></iframe>`,
                        );
                        alert("Copied to clipboard.");
                        setEmbedDialogOpen(false);
                      },
                    },
                  ]}
                >
                  <div
                    style={{ wordBreak: "break-all" }}
                  >{`<iframe width="600" height="400" src="${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}"></iframe>`}</div>
                </Dialog>
              )}
              {props.embed && (
                <IconButton
                  icon={LinkExternalIcon}
                  size="small"
                  variant="invisible"
                  aria-label="Open Morsel"
                  onClick={() => window.open("/", "_blank")}
                />
              )}
            </PageHeader.Actions>
          </PageHeader>
        </div>
        <div className="d-flex flex-1" style={{ minHeight: 0 }}>
          <div
            className={[View.CODE, View.SPLIT].indexOf(view) === -1 ? "d-none" : "flex-1"}
            style={{ width: view === View.CODE ? "100%" : "50%" }}
          >
            <CodeEditor
              embed={props.embed}
              setClassInstance={setClassInstance}
              setEditor={setEditor}
              content={content}
              theme={colorMode === "dark" ? "vs-dark" : "light"}
            />
          </div>
          <div className={[View.SPLIT].indexOf(view) === -1 ? "d-none" : "border-left"}></div>
          <div
            className={[View.DIAGRAM, View.SPLIT].indexOf(view) === -1 ? "d-none" : "flex-1"}
            style={{ width: view == View.DIAGRAM ? "100%" : "50%" }}
          >
            <DiagramEditor classInstance={classInstance} theme={colorMode === "dark" ? "vs-dark" : "light"} />
          </div>
        </div>
      </div>
    </>
  );
}
