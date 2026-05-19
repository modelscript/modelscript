// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Protégé-style OWL2 Property Hierarchy tree view.
// Displays ObjectProperty and DataProperty hierarchies from
// parsed OWL2-FSS ontologies in a navigable sidebar tree.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export interface OWL2PropertyNode {
  iri: string;
  label: string;
  propertyType: "object" | "data" | "annotation";
  hasChildren: boolean;
  domain: string[];
  range: string[];
  characteristics: string[]; // "Transitive", "Functional", "Symmetric", etc.
  inverseOf?: string;
}

function propertyNodeIcon(node: OWL2PropertyNode): vscode.ThemeIcon {
  switch (node.propertyType) {
    case "object":
      return new vscode.ThemeIcon("symbol-property", new vscode.ThemeColor("charts.blue"));
    case "data":
      return new vscode.ThemeIcon("symbol-field", new vscode.ThemeColor("charts.green"));
    case "annotation":
      return new vscode.ThemeIcon("symbol-string", new vscode.ThemeColor("charts.purple"));
    default:
      return new vscode.ThemeIcon("symbol-property");
  }
}

export class OWL2PropertyItem extends vscode.TreeItem {
  constructor(
    public readonly node: OWL2PropertyNode,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(node.label, collapsibleState);
    this.tooltip = buildPropertyTooltip(node);
    this.description = buildPropertyDescription(node);
    this.contextValue = `owl2-${node.propertyType}-property`;
    this.iconPath = propertyNodeIcon(node);

    this.command = {
      command: "modelscript.owl2.goToDeclaration",
      title: "Go to Declaration",
      arguments: [node.iri],
    };
  }
}

function buildPropertyDescription(node: OWL2PropertyNode): string {
  const parts: string[] = [];
  if (node.characteristics.length > 0) {
    parts.push(node.characteristics.join(", "));
  }
  if (node.inverseOf) {
    parts.push(`⇆ ${node.inverseOf}`);
  }
  return parts.join(" · ");
}

function buildPropertyTooltip(node: OWL2PropertyNode): string {
  const lines = [node.iri];
  if (node.domain.length > 0) lines.push(`Domain: ${node.domain.join(", ")}`);
  if (node.range.length > 0) lines.push(`Range: ${node.range.join(", ")}`);
  if (node.characteristics.length > 0) lines.push(`Characteristics: ${node.characteristics.join(", ")}`);
  if (node.inverseOf) lines.push(`Inverse: ${node.inverseOf}`);
  return lines.join("\n");
}

export class OWL2PropertyHierarchyProvider implements vscode.TreeDataProvider<OWL2PropertyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OWL2PropertyItem | undefined | null>();
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

  getTreeItem(element: OWL2PropertyItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OWL2PropertyItem): Promise<OWL2PropertyItem[]> {
    if (!this.documentUri) return [];

    try {
      const nodes: OWL2PropertyNode[] = await this.client.sendRequest("modelscript/owl2/propertyHierarchy", {
        uri: this.documentUri,
        parentIri: element?.node.iri ?? null,
        propertyType: element?.node.propertyType ?? null,
      });

      return nodes.map(
        (node) =>
          new OWL2PropertyItem(
            node,
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );
    } catch (e) {
      console.error("[owl2-property-hierarchy] Error fetching children:", e);
      return [];
    }
  }
}
