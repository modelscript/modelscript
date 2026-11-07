import type { IWorkspaceIndex, SymbolEntry, SymbolIndex } from "@modelscript/runtime";
export interface ScadDependency {
    type: "include" | "use";
    targetPath: string;
    startOffset: number;
    endOffset: number;
}
export interface ScadFileInfo {
    uri: string;
    sourceText?: string | undefined;
    index: SymbolIndex;
    modules: Map<string, SymbolEntry>;
    functions: Map<string, SymbolEntry>;
    variables: Map<string, SymbolEntry>;
    dependencies: ScadDependency[];
}
/**
 * Multi-File Workspace Indexer for OpenSCAD (.scad) models.
 *
 * Implements IWorkspaceIndex tracking document versions, structural revisions,
 * exported modules, functions, and variables across `include <...>` and `use <...>`
 * directives without regex hacks.
 */
export declare class ScadWorkspaceIndex implements IWorkspaceIndex {
    private _version;
    private _structuralRevision;
    private fileIndices;
    private fileInfos;
    private fileBaseIds;
    private nextFileSlot;
    get version(): number;
    get structuralRevision(): number;
    get fileCount(): number;
    has(uri: string): boolean;
    getFileIndex(uri: string): SymbolIndex | undefined;
    getFileInfo(uri: string): ScadFileInfo | undefined;
    getFileSource(uri: string): string | undefined;
    getDependencies(uri: string): ScadDependency[];
    /**
     * Resolves an `include <targetPath>` or `use <targetPath>` path to a registered URI in the workspace index.
     */
    resolveDependencyUri(targetPath: string, fromUri?: string): string | undefined;
    resolveDependencyInfo(targetPath: string, fromUri?: string): ScadFileInfo | undefined;
    register(uri: string, _loader?: () => unknown): void;
    reindexDocument(uri: string, loader?: () => unknown): void;
    /**
     * Parses an OpenSCAD source file and registers all declared modules, functions, variables,
     * and include/use dependencies in the workspace index.
     */
    indexFile(uri: string, text: string): SymbolIndex;
    toSymbolIndex(): SymbolIndex;
    toUnified(): SymbolIndex;
    toUnifiedAsync(): Promise<SymbolIndex>;
    toUnifiedPartial(): SymbolIndex;
    getSkeletonIndex(): SymbolIndex;
    /**
     * Resolves a module, function, or variable visible from the given document URI,
     * taking `include <...>` and `use <...>` into account.
     */
    resolveVisibleSymbol(name: string, fromUri: string): SymbolEntry | undefined;
}
//# sourceMappingURL=workspace-index.d.ts.map