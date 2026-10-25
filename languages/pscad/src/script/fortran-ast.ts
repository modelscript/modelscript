// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fortran AST and Lexer / Parser for PSCAD component script segments.
 * Delegated to first-class DSL package @modelscript/fortran.
 */

export {
  FortranAstParser,
  parseFortranScript,
  tokenizeFortran,
  type FortranExpr,
  type FortranStmt,
} from "@modelscript/fortran";
