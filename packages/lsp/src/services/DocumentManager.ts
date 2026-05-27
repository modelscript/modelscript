/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Tree as TreeSitterTree } from "web-tree-sitter";

export class DocumentManager {
  public documents: TextDocuments<TextDocument>;
  public documentTrees = new Map<string, any>();
  public lazyLibTrees = new Map<string, any>();
  public sharedContext: any;
  public getSharedCstTreeWrapper: () => any;

  constructor(documents: TextDocuments<TextDocument>, getSharedCstTreeWrapper: () => any) {
    this.documents = documents;
    this.getSharedCstTreeWrapper = getSharedCstTreeWrapper;
  }

  public getDocumentTree(uri: string): TreeSitterTree | null {
    if (this.documentTrees.has(uri)) {
      return this.documentTrees.get(uri)!;
    }
    if (this.lazyLibTrees.has(uri)) {
      return this.lazyLibTrees.get(uri)!;
    }
    return null;
  }

  public getLineIndexForDoc(uri: string): any | null {
    const doc = this.documents.get(uri);
    const tree = this.getDocumentTree(uri);
    if (!doc || !tree) return null;
    return null;
  }
}
