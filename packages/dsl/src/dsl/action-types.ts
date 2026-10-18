// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Language Actions & UI Manifest DSL.
 */

export type ActionCategory = "transform" | "simulate" | "query" | "verify" | "geometry" | "export" | "custom";

export interface ActionInputDefinition {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string | undefined;
  required?: boolean | undefined;
  default?: any;
  enum?: string[] | undefined;
  items?: { type: "string" | "number" | "boolean" } | undefined;
  properties?: Record<string, ActionInputDefinition> | undefined;
}

export interface ActionOutputDefinition {
  type: "text" | "json" | "timeseries" | "mesh" | "diff" | "void";
  description?: string | undefined;
}

export interface ActionUIManifest {
  /** Toolbar button in the top-right of the editor */
  editorTitle?:
    | {
        icon: string; // Codicon string, e.g. "$(play)" or "$(symbol-structure)"
        group?: string | undefined; // e.g. "navigation@1", "navigation@2"
        when?: string | undefined; // VS Code context key expression, defaults to `resourceLangId == ${lang.id}`
      }
    | undefined;
  /** Context menu item in editor right-click */
  editorContextMenu?:
    | {
        group?: string | undefined; // e.g. "1_modification", "2_run"
        when?: string | undefined;
      }
    | undefined;
  /** Context menu item in file explorer tree */
  explorerContextMenu?:
    | {
        group?: string | undefined; // e.g. "navigation"
        when?: string | undefined; // e.g. `resourceExtname == .mo`
      }
    | undefined;
  /** Command palette item */
  commandPalette?:
    | {
        category?: string | undefined; // e.g. "Modelica"
        when?: string | undefined;
      }
    | undefined;
  /** Keyboard shortcut */
  keybinding?:
    | {
        key: string; // e.g. "ctrl+shift+f5", "f5"
        mac?: string | undefined; // e.g. "cmd+shift+f5"
        when?: string | undefined;
      }
    | undefined;
  /** Language Model Tool declaration for VS Code Copilot / Chat */
  languageModelTool?:
    | {
        name?: string | undefined; // Tool name, e.g. "modelscript_simulate" (defaults to `modelscript_${action.id}`)
        displayName?: string | undefined;
        modelDescription?: string | undefined;
      }
    | undefined;
}

export interface ActionExecutionContext {
  uri?: string | undefined;
  languageId: string;
  documentText?: string | undefined;
  cstNode?: any;
  symbolIndex?: any;
  queryEngine?: any;
  workspaceManager?: any;
  connection?: any;
  notifyProgress?: ((message: string, increment?: number) => void) | undefined;
  [key: string]: any;
}

export interface LanguageAction<TInputs extends Record<string, any> = Record<string, any>, TOutputs = any> {
  id: string; // e.g. "flatten", "simulate", "query", "parse"
  title: string; // e.g. "Flatten Model to DAE"
  description: string;
  category: ActionCategory;
  inputs?: Record<string, ActionInputDefinition> | undefined;
  output?: ActionOutputDefinition | undefined;
  ui?: ActionUIManifest | undefined;
  execute?: ((context: ActionExecutionContext, inputs: TInputs) => Promise<TOutputs> | TOutputs) | undefined;
}

export function languageAction<TInputs extends Record<string, any> = Record<string, any>, TOutputs = any>(
  action: LanguageAction<TInputs, TOutputs>,
): LanguageAction<TInputs, TOutputs> {
  return action;
}

/**
 * Standard preset action definition for opening the visual 2D diagram view (Method 2).
 */
export function diagramAction(options?: Partial<LanguageAction>): LanguageAction {
  return {
    id: "open_diagram",
    title: options?.title || "Open Diagram",
    description: options?.description || "Opens the graphical 2D diagram view.",
    category: "query",
    ui: {
      editorTitle: {
        icon: "$(open-preview)",
        group: "navigation@0",
      },
      ...options?.ui,
    },
    ...options,
  };
}
