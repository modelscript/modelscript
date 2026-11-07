import type { FeaDialect, FeaModelData, MaterializeOptions } from "../types.js";
/**
 * Bulk Data (.bdf / .dat) FEA deck dialect implementation.
 */
export declare class BdfDialect implements FeaDialect {
    readonly id = "bdf";
    readonly name = "FEA Bulk Data Deck (.bdf / .dat)";
    readonly extensions: string[];
    /**
     * Materializes a NASTRAN Bulk Data `.bdf` template by evaluating embedded `{{ ... }}` expressions.
     */
    materialize(templateText: string, options?: MaterializeOptions): string;
    /**
     * Parses a NASTRAN Bulk Data (`.bdf` / `.dat`) deck (supporting both free-field comma-separated
     * and 8-column small-field formats with continuation cards) into `FeaModelData`.
     */
    parse(deckText: string): FeaModelData;
}
//# sourceMappingURL=bdf.d.ts.map