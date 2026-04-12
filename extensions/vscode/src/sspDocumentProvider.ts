// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Virtual document provider for `.ssp` files.
 *
 * Renders SSP archives as readonly Modelica block definitions by extracting
 * the `SystemStructure.ssd` from the ZIP and converting components, connections,
 * and parameters into a readable Modelica system diagram syntax.
 */

import { inflateRaw } from "pako";
import * as vscode from "vscode";
import { parseSsd, SspSystem } from "./sspParser";

/** URI scheme for virtual SSP documents. */
export const SSP_VIEW_SCHEME = "ssp-view";

/** Generate a Modelica block definition from SSP metadata. */
function generateModelicaSspBlock(ssp: SspSystem): string {
  const lines: string[] = [];

  lines.push("// ── System Structure and Parameterization (SSP) ────────────────────");
  lines.push("// This is a readonly view of the SSP archive contents.");
  lines.push("");

  if (ssp.description) {
    lines.push(`model ${ssp.name} "${ssp.description}"`);
  } else {
    lines.push(`model ${ssp.name}`);
  }

  // Generate component types
  if (ssp.components.length > 0) {
    lines.push("");
    lines.push("  // ── Component Types ──");
    for (const comp of ssp.components) {
      lines.push(`  ${comp.source ? `/* ${comp.source} */ ` : ""}block ${comp.name}_type`);

      const inputs = comp.connectors.filter((c) => c.kind === "input");
      const outputs = comp.connectors.filter((c) => c.kind === "output" || c.kind === "inout");

      let i = 0;
      for (const conn of inputs) {
        const y = 100 - ((i + 1) * 200) / (inputs.length + 1);
        lines.push(
          `    input ${conn.type} ${conn.name} annotation(Placement(transformation(extent={{-110, ${Math.round(y) - 10}}, {-90, ${Math.round(y) + 10}}})));`,
        );
        i++;
      }

      let j = 0;
      for (const conn of outputs) {
        const causality = conn.kind === "inout" ? "inout" : "output";
        const y = 100 - ((j + 1) * 200) / (outputs.length + 1);
        lines.push(
          `    ${causality} ${conn.type} ${conn.name} annotation(Placement(transformation(extent={{90, ${Math.round(y) - 10}}, {110, ${Math.round(y) + 10}}})));`,
        );
        j++;
      }

      // Add FMU Icon and Diagram annotations
      lines.push(`    annotation(`);
      lines.push(
        `      Icon(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}), graphics = {Rectangle(extent = {{-100, 100}, {100, -100}}, lineColor = {0, 0, 0}, fillColor = {255, 230, 204}, fillPattern = FillPattern.Solid), Text(extent = {{-100, 24}, {100, -24}}, textString = "${comp.name}")}),`,
      );
      lines.push(`      Diagram(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}))`);
      lines.push(`    );`);
      lines.push(`  end ${comp.name}_type;`);
      lines.push("");
    }

    lines.push("  // ── Component Instances ──");
    let xOffset = -60;
    for (const comp of ssp.components) {
      lines.push(
        `  ${comp.name}_type ${comp.name} annotation(Placement(transformation(extent={{${xOffset}, -20}, {${xOffset + 40}, 20}})));`,
      );
      xOffset += 60;
    }
    lines.push("");
  }

  // Generate Parameter Bindings
  if (ssp.parameterBindings.length > 0) {
    lines.push("  // ── Parameter Bindings ──");
    for (const pb of ssp.parameterBindings) {
      if (pb.source) {
        lines.push(`  // Binding set from: ${pb.source}`);
      } else {
        lines.push(`  // Parameter Binding`);
      }
      for (const p of pb.values) {
        // Need to add these parameters to the block model or component instance?
        // In SSP, they usually map to components. We'll just list them as global parameters here.
        lines.push(`  parameter ${p.type} ${p.name} = ${p.value};`);
      }
    }
    lines.push("");
  }

  // Connect equations
  if (ssp.connections.length > 0) {
    lines.push("equation");
    lines.push("  // ── Connections ──");
    for (const conn of ssp.connections) {
      lines.push(`  connect(${conn.startElement}.${conn.startConnector}, ${conn.endElement}.${conn.endConnector});`);
    }
  }

  lines.push(`end ${ssp.name};`);
  lines.push("");
  return lines.join("\n");
}

// ── Lightweight ZIP reader (browser-safe, uses pako) ──

/**
 * Extract a file from a ZIP archive by name.
 * Supports STORED (method 0) and DEFLATED (method 8) entries.
 */
function extractFromZip(zipData: Uint8Array, targetName: string): Uint8Array | null {
  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData[i] === 0x50 && zipData[i + 1] === 0x4b && zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  let pos = cdOffset;
  while (pos < cdEnd) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const fileName = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + fileNameLength));

    if (fileName === targetName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
      const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        return zipData.subarray(dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        try {
          return inflateRaw(zipData.subarray(dataStart, dataStart + compressedSize));
        } catch {
          return null;
        }
      }
      return null;
    }
    pos += 46 + fileNameLength + extraLength + commentLength;
  }
  return null;
}

/** Extract SystemStructure.ssd from SSP bytes and generate Modelica code. */
function sspBytesToModelica(name: string, sspBytes: Uint8Array): string {
  try {
    const xmlData = extractFromZip(sspBytes, "SystemStructure.ssd");
    if (!xmlData) return `// Error: SystemStructure.ssd not found in ${name}.ssp\n`;
    const xml = new TextDecoder().decode(xmlData);
    const ssp = parseSsd(xml);
    return generateModelicaSspBlock(ssp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `// Error reading ${name}.ssp: ${msg}\n`;
  }
}

// ── TextDocumentContentProvider ──

/**
 * Provides virtual readonly text content for SSP files.
 * URIs: \`ssp-view:/System\` → Modelica block text.
 */
export class SspContentProvider implements vscode.TextDocumentContentProvider {
  private cache = new Map<string, string>();
  private bytesCache = new Map<string, Uint8Array>();

  /** Register content from raw SSP bytes. */
  registerSsp(name: string, sspBytes: Uint8Array): void {
    this.cache.set(name, sspBytesToModelica(name, sspBytes));
    this.bytesCache.set(name, sspBytes);
  }

  /** Get pre-registered SSP bytes by name. */
  getSspBytes(name: string): Uint8Array | undefined {
    return this.bytesCache.get(name);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const name = uri.path.replace(/^\//, "");
    return this.cache.get(name) ?? `// Loading ${name}.ssp...\n`;
  }
}

// ── Custom Editor (redirect to virtual document) ──

/** Minimal custom document for the redirect editor. */
class SspDocument implements vscode.CustomDocument {
  constructor(
    readonly uri: vscode.Uri,
    readonly name: string,
    readonly sspBytes: Uint8Array,
  ) {}
  dispose(): void {
    // CustomDocument lifecycle — nothing to clean up
  }
}

/**
 * Custom readonly editor that intercepts \`.ssp\` file opens and redirects
 * to a \`ssp-view:\` virtual text document with Modelica syntax highlighting.
 */
export class SspEditorProvider implements vscode.CustomReadonlyEditorProvider<SspDocument> {
  static readonly viewType = "modelscript.sspViewer";

  constructor(private contentProvider: SspContentProvider) {}

  async openCustomDocument(uri: vscode.Uri): Promise<SspDocument> {
    const name =
      uri.path
        .split("/")
        .pop()
        ?.replace(/\\.ssp$/, "") ?? "SSP";

    // Use pre-registered bytes if available, otherwise read from filesystem
    let sspBytes = this.contentProvider.getSspBytes(name);
    if (!sspBytes) {
      try {
        sspBytes = await vscode.workspace.fs.readFile(uri);
      } catch (e) {
        console.warn(`[ssp-editor] Failed to read ${uri.toString()}:`, e);
        sspBytes = new Uint8Array(0);
      }
    }
    return new SspDocument(uri, name, sspBytes);
  }

  async resolveCustomEditor(document: SspDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    // Register the content in the virtual document provider
    this.contentProvider.registerSsp(document.name, document.sspBytes);

    // Open the virtual text document with Modelica syntax highlighting
    const virtualUri = vscode.Uri.parse(`${SSP_VIEW_SCHEME}:/${document.name}`);
    const doc = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.languages.setTextDocumentLanguage(doc, "modelica");
    await vscode.window.showTextDocument(doc, {
      viewColumn: webviewPanel.viewColumn,
      preview: false,
    });

    // Close the webview panel — the text editor has replaced it
    webviewPanel.dispose();
  }
}
