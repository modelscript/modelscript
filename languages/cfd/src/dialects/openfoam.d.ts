import type { CfdDialect, CfdModelData, MaterializeOptions } from "../types.js";
/**
 * OpenFOAM case dictionary dialect implementation.
 * Supports recursive hierarchical dictionary parsing, `boundaryField` patch extraction,
 * and solver directive extraction.
 */
export declare class OpenFoamDialect implements CfdDialect {
    readonly id = "openfoam";
    readonly name = "OpenFOAM Case Dictionaries";
    readonly extensions: string[];
    /**
     * Materializes an OpenFOAM dictionary template by evaluating embedded `{{ ... }}` expressions.
     */
    materialize(templateText: string, options?: MaterializeOptions): string;
    /**
     * Parses an OpenFOAM dictionary into flattened dot-notated directives and classified boundary patches.
     */
    parse(content: string): CfdModelData;
    /**
     * Recursively parses nested `{ ... }` OpenFOAM sub-dictionaries and semicolon-terminated entries.
     */
    private parseDictionary;
    /**
     * Flattens a hierarchical `FoamDict` into dot-separated key paths in `directives` and `rawDirectives`.
     */
    private flattenDict;
}
//# sourceMappingURL=openfoam.d.ts.map