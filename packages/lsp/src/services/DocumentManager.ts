/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Parser, Tree as TreeSitterTree } from "web-tree-sitter";

export class DocumentManager {
  public documents: TextDocuments<TextDocument>;
  public documentTrees = new Map<string, any>();
  public lazyLibTrees = new Map<string, any>();
  public sharedContext: any;
  public modelicaParser: Parser | null = null;
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

  public updateDocumentTree(uri: string, newText: string): any {
    const oldTree = this.getDocumentTree(uri);
    let newTree: any;
    if (oldTree && this.modelicaParser) {
      newTree = this.modelicaParser.parse(newText, oldTree);
    } else {
      newTree = this.modelicaParser!.parse(newText);
    }

    if (uri.startsWith("modelscript-lib://")) {
      this.lazyLibTrees.set(uri, newTree);
    } else {
      this.documentTrees.set(uri, newTree);
    }
    return newTree;
  }

  public getLineIndexForDoc(uri: string): any | null {
    const doc = this.documents.get(uri);
    const tree = this.getDocumentTree(uri);
    if (!doc || !tree) return null;
    return null;
  }
}
