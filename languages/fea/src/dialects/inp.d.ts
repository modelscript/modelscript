import type { FeaDialect, FeaModelData, MaterializeOptions } from "../types.js";
/**
 * Standard FEA Input Deck (.inp) / CalculiX dialect implementation.
 */
export declare class InpDialect implements FeaDialect {
    readonly id = "inp";
    readonly name = "Standard FEA Input Deck (.inp) / CalculiX";
    readonly extensions: string[];
    /**
     * Materializes an Abaqus/CalculiX `.inpt` template by evaluating embedded `{{ ... }}` expressions.
     */
    materialize(templateText: string, options?: MaterializeOptions): string;
    /**
     * Parses an Abaqus/CalculiX `.inp` input deck into nodes, elements, node/element sets,
     * material constitutive properties, fixed boundary conditions, and nodal loads.
     */
    parse(deckText: string): FeaModelData;
}
/**
 * Convenience helper to parse a standard FEA (.inp) / CalculiX deck.
 */
export declare function parseInpDeck(deckText: string): FeaModelData;
/**
 * Convenience helper to materialize a standard FEA (.inp) / CalculiX deck template.
 */
export declare function materializeCalculixDeck(templateText: string, options?: MaterializeOptions): string;
/**
 * Type alias for parsed Abaqus/CalculiX `.inp` deck model data.
 */
export type InpDeckData = FeaModelData;
//# sourceMappingURL=inp.d.ts.map