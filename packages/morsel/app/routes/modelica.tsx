/* eslint-disable @typescript-eslint/no-explicit-any */
import { Editor } from "@monaco-editor/react";
import { ChecklistIcon, PlusIcon, ShareAndroidIcon } from "@primer/octicons-react";
import { Button, Dialog, IconButton, PageHeader, PageLayout, useConfirm } from "@primer/react";
import { useCallback, useEffect, useRef, useState } from "react";
import pako from "pako";

export function meta() {
  return [{ title: "ModelScript Morsel" }];
}

export default function Modelica() {
  const [title, setTitle] = useState("");
  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const onShareDialogClose = useCallback(() => setShareDialogOpen(false), []);
  const [isFlattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const flattenButtonRef = useRef<HTMLButtonElement>(null);
  const onFlattenDialogClose = useCallback(() => setFlattenDialogOpen(false), []);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  useEffect(() => {
    document.title = title.length > 0 ? title : "ModelScript Morsel";
  }, [title]);
  const confirmNew = useConfirm();
  const onNewButtonClick = useCallback(async () => {
    if (
      await confirmNew({
        title: "New morsel",
        content: "This action will clear the contents of the existing morsel. Click OK to proceed.",
      })
    ) {
      setTitle("");
      if (editorRef.current) {
        editorRef.current.getModel().setValue("");
      }
    }
  }, [confirmNew]);
  const handleEditorWillMount = (monaco: any) => {
    monacoRef.current = monaco;
    monaco.languages.register({
      id: "modelica",
    });
  };
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    const url = new URL(window.location.href);
    const m = url.searchParams.get("m");
    if (m) {
      editorRef.current.setValue(decode(m));
    }
    const t = url.searchParams.get("t");
    if (t) {
      setTitle(decode(t));
    }
    url.search = "";
    history.replaceState({}, "", url.href);
  };
  return (
    <>
      <div className="d-flex flex-column" style={{ height: "100vh" }}>
        <div className="border-bottom">
          <PageHeader className="p-3 container-lg ">
            <PageHeader.TitleArea>
              <PageHeader.LeadingVisual className="w-32 me-1 ">
                <img src="/brand.png" />
              </PageHeader.LeadingVisual>
              <PageHeader.Title
                children={
                  <input
                    type="text"
                    className="px-2"
                    minLength={1}
                    maxLength={20}
                    style={{
                      color: "var(--fgColor-accent)",
                      fontFamily: "var(--fontStack-monospace)",
                      fontWeight: "var(--base-text-weight-light)",
                    }}
                    placeholder="Enter title"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                  />
                }
              ></PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Actions>
              <Button
                variant="primary"
                leadingVisual={ChecklistIcon}
                ref={flattenButtonRef}
                onClick={() => setFlattenDialogOpen(!isFlattenDialogOpen)}
              >
                Flatten
              </Button>
              <IconButton
                aria-label="Share Morsel"
                icon={ShareAndroidIcon}
                ref={shareButtonRef}
                onClick={() => setShareDialogOpen(!isShareDialogOpen)}
              />
              <IconButton aria-label="New morsel" icon={PlusIcon} onClick={onNewButtonClick} />
            </PageHeader.Actions>
          </PageHeader>
        </div>
        {isShareDialogOpen && (
          <Dialog
            title="Share morsel"
            subtitle={title}
            onClose={onShareDialogClose}
            returnFocusRef={shareButtonRef}
            footerButtons={[
              {
                buttonType: "normal",
                content: "Copy to clipboard",
                onClick: async () => {
                  await navigator.clipboard.writeText(url(editorRef, title));
                  alert("Copied to clipboard.");
                  onShareDialogClose();
                },
              },
            ]}
          >
            <div style={{ wordBreak: "break-all" }}>{url(editorRef, title)}</div>
          </Dialog>
        )}
        {isFlattenDialogOpen && (
          <Dialog
            title="Flatten morsel"
            subtitle={title}
            onClose={onFlattenDialogClose}
            returnFocusRef={flattenButtonRef}
            height="large"
          >
            <Dialog.Body style={{ height: "100%" }}>
              <Editor
                height="100%"
                defaultLanguage="modelica"
                options={{ lineNumbers: "off", minimap: { enabled: false }, readOnly: true }}
              ></Editor>
            </Dialog.Body>
          </Dialog>
        )}
        <PageLayout containerWidth="xlarge" className="flex-1 bgColor-inset" style={{ height: "100%" }}>
          <PageLayout.Content className="bgColor-inset" style={{ height: "100%" }}>
            <Editor
              height="99%"
              beforeMount={handleEditorWillMount}
              onMount={handleEditorDidMount}
              defaultLanguage="modelica"
              className="border"
            ></Editor>
          </PageLayout.Content>
        </PageLayout>
      </div>
    </>
  );
}

function decode(base64url: string): string {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const buffer = Buffer.from(base64, "base64");
  return new TextDecoder().decode(pako.inflateRaw(buffer));
}

function encode(text: string): string {
  console.log("encode", text);
  const buffer = pako.deflateRaw(Buffer.from(text, "utf8"));
  const base64 = Buffer.from(buffer).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_");
}

function url(editorRef: any, title: any): string {
  const url = new URL(window.location.href);
  const m = encode(editorRef.current.getValue());
  const t = title.length === 0 ? encode("Untitled") : encode(title);
  return `${url.protocol}//${url.host}/modelica?m=${m}&t=${t}`;
}
