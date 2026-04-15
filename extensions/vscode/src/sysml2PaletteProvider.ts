// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SysML2 element palette tree provider.
// Shows a static tree of SysML2 element types grouped by category.
// Each leaf item is draggable onto the diagram canvas to create a new element.

import * as vscode from "vscode";

// ── SysML2 Element Type Definitions ──

interface SysML2ElementType {
  name: string;
  elementType: string; // Maps to the code generation template key
  icon: string; // codicon name
  description?: string;
}

interface SysML2Category {
  name: string;
  icon: string;
  elements: SysML2ElementType[];
}

const SYSML2_PALETTE: SysML2Category[] = [
  {
    name: "Structural",
    icon: "symbol-structure",
    elements: [
      { name: "Part def", elementType: "PartDefinition", icon: "symbol-class", description: "Block/part type" },
      { name: "Part", elementType: "PartUsage", icon: "symbol-field", description: "Part instance" },
      { name: "Attribute def", elementType: "AttributeDefinition", icon: "symbol-property", description: "Value type" },
      { name: "Attribute", elementType: "AttributeUsage", icon: "symbol-key", description: "Value property" },
      { name: "Port def", elementType: "PortDefinition", icon: "symbol-interface", description: "Port type" },
      { name: "Port", elementType: "PortUsage", icon: "plug", description: "Port instance" },
      { name: "Item def", elementType: "ItemDefinition", icon: "symbol-misc", description: "Item type" },
      { name: "Item", elementType: "ItemUsage", icon: "symbol-value", description: "Item instance" },
      { name: "Enum def", elementType: "EnumerationDefinition", icon: "symbol-enum", description: "Enumeration type" },
      {
        name: "Occurrence def",
        elementType: "OccurrenceDefinition",
        icon: "symbol-event",
        description: "Occurrence type",
      },
    ],
  },
  {
    name: "Behavioral",
    icon: "play-circle",
    elements: [
      { name: "Action def", elementType: "ActionDefinition", icon: "run-all", description: "Action type" },
      { name: "Action", elementType: "ActionUsage", icon: "run", description: "Action instance" },
      {
        name: "State def",
        elementType: "StateDefinition",
        icon: "circle-large-outline",
        description: "State machine type",
      },
      { name: "State", elementType: "StateUsage", icon: "circle-large-filled", description: "State instance" },
      {
        name: "Calculation def",
        elementType: "CalculationDefinition",
        icon: "symbol-function",
        description: "Calculation type",
      },
      {
        name: "Calculation",
        elementType: "CalculationUsage",
        icon: "symbol-method",
        description: "Calculation instance",
      },
    ],
  },
  {
    name: "Requirements",
    icon: "checklist",
    elements: [
      {
        name: "Requirement def",
        elementType: "RequirementDefinition",
        icon: "shield",
        description: "Requirement type",
      },
      { name: "Requirement", elementType: "RequirementUsage", icon: "pass", description: "Requirement instance" },
      { name: "Constraint def", elementType: "ConstraintDefinition", icon: "warning", description: "Constraint type" },
      { name: "Constraint", elementType: "ConstraintUsage", icon: "error", description: "Constraint instance" },
      { name: "Concern def", elementType: "ConcernDefinition", icon: "bell", description: "Concern type" },
      { name: "Concern", elementType: "ConcernUsage", icon: "bell-dot", description: "Concern instance" },
    ],
  },
  {
    name: "Analysis",
    icon: "microscope",
    elements: [
      { name: "Use Case def", elementType: "UseCaseDefinition", icon: "account", description: "Use case type" },
      { name: "Use Case", elementType: "UseCaseUsage", icon: "person", description: "Use case instance" },
      { name: "Case def", elementType: "CaseDefinition", icon: "folder", description: "Case type" },
      { name: "Case", elementType: "CaseUsage", icon: "folder-opened", description: "Case instance" },
      {
        name: "Analysis Case def",
        elementType: "AnalysisCaseDefinition",
        icon: "graph",
        description: "Analysis case type",
      },
      {
        name: "Analysis Case",
        elementType: "AnalysisCaseUsage",
        icon: "graph-line",
        description: "Analysis case instance",
      },
      {
        name: "Verification def",
        elementType: "VerificationCaseDefinition",
        icon: "verified",
        description: "Verification type",
      },
      {
        name: "Verification",
        elementType: "VerificationCaseUsage",
        icon: "check-all",
        description: "Verification instance",
      },
    ],
  },
  {
    name: "Interconnection",
    icon: "link",
    elements: [
      {
        name: "Connection def",
        elementType: "ConnectionDefinition",
        icon: "git-compare",
        description: "Connection type",
      },
      {
        name: "Interface def",
        elementType: "InterfaceDefinition",
        icon: "symbol-interface",
        description: "Interface type",
      },
      {
        name: "Allocation def",
        elementType: "AllocationDefinition",
        icon: "arrow-both",
        description: "Allocation type",
      },
      { name: "Flow def", elementType: "FlowDefinition", icon: "arrow-right", description: "Flow type" },
    ],
  },
  {
    name: "Views",
    icon: "layout",
    elements: [
      { name: "View def", elementType: "ViewDefinition", icon: "preview", description: "View type" },
      { name: "View", elementType: "ViewUsage", icon: "eye", description: "View instance" },
      { name: "Viewpoint def", elementType: "ViewpointDefinition", icon: "target", description: "Viewpoint type" },
      { name: "Viewpoint", elementType: "ViewpointUsage", icon: "telescope", description: "Viewpoint instance" },
      { name: "Rendering def", elementType: "RenderingDefinition", icon: "paintcan", description: "Rendering type" },
      { name: "Rendering", elementType: "RenderingUsage", icon: "color-mode", description: "Rendering instance" },
    ],
  },
];

// ── Tree Items ──

export class SysML2PaletteItem extends vscode.TreeItem {
  constructor(
    public readonly elementInfo:
      | { type: "category"; category: SysML2Category }
      | { type: "element"; element: SysML2ElementType },
  ) {
    if (elementInfo.type === "category") {
      super(elementInfo.category.name, vscode.TreeItemCollapsibleState.Collapsed);
      this.iconPath = new vscode.ThemeIcon(elementInfo.category.icon);
      this.contextValue = "sysml2Category";
    } else {
      super(elementInfo.element.name, vscode.TreeItemCollapsibleState.None);
      this.iconPath = new vscode.ThemeIcon(elementInfo.element.icon);
      this.description = elementInfo.element.description;
      this.contextValue = "sysml2Element";
      this.tooltip = `Drag to diagram or click to add: ${elementInfo.element.name}`;
      // Double-click triggers addToDiagram
      this.command = {
        command: "modelscript.addToDiagram",
        title: "Add to Diagram",
        arguments: [elementInfo.element.elementType, "sysml2"],
      };
    }
  }
}

// ── Tree Data Provider ──

export class SysML2PaletteProvider
  implements vscode.TreeDataProvider<SysML2PaletteItem>, vscode.TreeDragAndDropController<SysML2PaletteItem>
{
  public readonly dragMimeTypes = ["application/json", "text/plain"];
  public readonly dropMimeTypes = [];

  private _onDidChangeTreeData = new vscode.EventEmitter<SysML2PaletteItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  public onDragStart?: (data: { className: string; classKind: string }) => void;

  getTreeItem(element: SysML2PaletteItem): vscode.TreeItem {
    return element;
  }

  async handleDrag(
    source: readonly SysML2PaletteItem[],
    dataTransfer: vscode.DataTransfer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const item = source[0];
    if (!item || item.elementInfo.type !== "element") return;

    const dragData = {
      className: item.elementInfo.element.elementType,
      classKind: "sysml2",
    };

    const payload = JSON.stringify(dragData);
    dataTransfer.set("application/json", new vscode.DataTransferItem(payload));
    dataTransfer.set("text/plain", new vscode.DataTransferItem(payload));

    // Notify diagram webviews to enter placement mode
    this.onDragStart?.(dragData);
  }

  async getChildren(element?: SysML2PaletteItem): Promise<SysML2PaletteItem[]> {
    if (!element) {
      // Root level: show categories
      return SYSML2_PALETTE.map((cat) => new SysML2PaletteItem({ type: "category", category: cat }));
    }

    if (element.elementInfo.type === "category") {
      // Category level: show element types
      return element.elementInfo.category.elements.map((el) => new SysML2PaletteItem({ type: "element", element: el }));
    }

    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
