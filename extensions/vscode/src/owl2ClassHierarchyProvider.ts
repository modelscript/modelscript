// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Protégé-style OWL2 Class Hierarchy tree view.
// Communicates with the LSP server to extract class subsumption
// hierarchy from parsed OWL2-FSS ontologies and displays them
// as a navigable tree in the sidebar.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export interface OWL2ClassNode {
  iri: string;
  label: string;
  hasChildren: boolean;
  isDefinedClass: boolean;
  superClasses: string[];
  disjointWith: string[];
  equivalentTo: string[];
}

function classNodeIcon(node: OWL2ClassNode): vscode.ThemeIcon {
  if (node.isDefinedClass) {
    // Defined classes (with EquivalentClasses axioms) get a distinct icon
    return new vscode.ThemeIcon("symbol-class", new vscode.ThemeColor("charts.yellow"));
  }
  return new vscode.ThemeIcon("symbol-class", new vscode.ThemeColor("charts.orange"));
}

export class OWL2ClassItem extends vscode.TreeItem {
  constructor(
    public readonly node: OWL2ClassNode,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(node.label, collapsibleState);
    this.tooltip = node.iri;
    this.description = node.isDefinedClass ? "≡ defined" : "";
    this.contextValue = "owl2-class";
    this.iconPath = classNodeIcon(node);

    // Clicking navigates to the Declaration in the source file
    this.command = {
      command: "modelscript.owl2.goToDeclaration",
      title: "Go to Declaration",
      arguments: [node.iri],
    };
  }
}

export class OWL2ClassHierarchyProvider implements vscode.TreeDataProvider<OWL2ClassItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OWL2ClassItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private documentUri: string | undefined;

  constructor(private readonly client: LanguageClient) {}

  refresh(uri?: string): void {
    if (uri) this.documentUri = uri;
    this._onDidChangeTreeData.fire(undefined);
  }

  setDocumentUri(uri: string): void {
    if (this.documentUri !== uri) {
      this.documentUri = uri;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: OWL2ClassItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OWL2ClassItem): Promise<OWL2ClassItem[]> {
    if (!this.documentUri) return [];

    try {
      const nodes: OWL2ClassNode[] = await this.client.sendRequest("modelscript/owl2/classHierarchy", {
        uri: this.documentUri,
        parentIri: element?.node.iri ?? null,
      });

      return nodes.map(
        (node) =>
          new OWL2ClassItem(
            node,
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );
    } catch (e) {
      console.error("[owl2-class-hierarchy] Error fetching children:", e);
      return [];
    }
  }
}
