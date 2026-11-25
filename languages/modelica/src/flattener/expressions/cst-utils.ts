// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - CST Expression Utilities.
 *
 * Thin barrel re-exporting cohesive, strictly acyclic submodules under `./cst/`.
 */

export {
  collapseAsciiWhitespace,
  firstAsciiToken,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentStart,
  isAsciiIdentifier,
  isAsciiWhitespaceCode,
} from "../../ascii.js";

export type { CstNodeLike, DbConstantResult, DbConstantValue, ParsedRawLiteral } from "./cst/types.js";

export {
  containsWholeWordOutsideStrings,
  countWordOccurrencesOutsideStrings,
  expandModelicaTextMacros,
  extractAsciiIdentifiers,
  extractBracketSubscripts,
  extractTrailingBrackets,
  firstBracketedIdentifier,
  formatArenaValForMod,
  generateArrayIndices,
  generateArrayTuples,
  getIndexedElementText,
  hasColonSubscript,
  isDottedComponentRefWithSubscripts,
  isDottedIdentifierChain,
  isSignedAsciiIntText,
  isSignedAsciiNumberText,
  isValidDottedComponentPath,
  leadingIdentifierBeforeDot,
  parseBinaryIdentSubtraction,
  parseIdentSubscriptText,
  parseNamedArgAssignment,
  parseNamedCallArgsFromText,
  parseRawLiteralArg,
  parseSizeCallIdentDim,
  parseTrailingNumericSubscripts,
  parseTrailingSingleIntSubscript,
  readUnsignedNumberLength,
  replaceWordOutsideStrings,
  spaceAfterCommas,
  splitBraceCommasAndTrim,
  splitTopLevel,
  splitTopLevelArgs,
  startsWithSignedDecimalFloat,
  stripAnnotation,
  stripArraySubscripts,
  stripAsciiWhitespace,
  stripComments,
  stripCommentsAndStrings,
  stripLeadingDot,
  stripLeadingDots,
  stripLeadingEquals,
  stripLeadingMinusWs,
  stripMathPackagePrefix,
  stripOuterDoubleQuotes,
  stripOuterSingleQuotes,
  stripTrailingArraySubscripts,
  tokenizeCommentStrippedWords,
} from "./cst/text-scanning.js";

export {
  evalArithmeticString,
  evalArithmeticText,
  evalBinaryNumericOp,
  evalScalarBuiltinCall,
} from "./cst/arithmetic-eval.js";

export {
  collectReferencedRootIdentsFromExprCst,
  cstContainsNodeType,
  cstHasError,
  extractBindingExprFromDeclCst,
  extractCallTargetsFromExpr,
  extractComponentNameFromClauseCst,
  extractFunctionCallArgExprNodesCst,
  extractModArgBindingExprCst,
  flattenColonNodes,
  getArrayLiteralItems,
  hasClassHeaderKeywordCst,
  hasEquationAssignmentForNameCst,
  isEnumClassDefCst,
  isInsideForIndex,
  parseStandaloneExpressionCst,
  unwrapParenExprCst,
} from "./cst/cst-traversal.js";

export {
  getDaeArrayDimCount,
  getDaeArrayDimSize,
  getDaeDimSize,
  getVarPrefixSet,
  isIntegerTypeSpec,
  resolveScopedName,
} from "./cst/name-resolution.js";

export {
  extractEnumLiteralsFromCst,
  getBaseEnumSymbol,
  getCompDeclSubEnumInfo,
  getEnumLiteralIndex,
  getSymbolEnumLiterals,
  parseEnumLiteralsText,
  resolveEnumType,
} from "./cst/enum-resolution.js";

export {
  beginExternalCstEval,
  endExternalCstEval,
  evaluateCSTNumber,
  extractDbConstantValue,
  lookupDbConstant,
} from "./cst/constant-eval.js";

export {
  checkIfExprTypeMismatch,
  copyExprBetweenDaes,
  evaluateEnumRange,
  expandDottedArrayMemberRef,
  expandVarToArrayCtor,
  isDefinitelyScalarExpr,
} from "./cst/array-subscripts.js";
