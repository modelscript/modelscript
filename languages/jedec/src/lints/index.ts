// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JEDEC JESD3 Diagnostic Linter (`JED1001`–`JED5006`).
 */

import { JedecErrorCode } from "../errors.js";
import { formatHex16 } from "../parser/checksum.js";
import type { JedecDiagnostic, JedecDocument, JedecSourceSpan } from "../types.js";

export { JedecErrorCode };

export interface JedecLintOptions {
  /** Report warning if `C<hhhh>*` fuse checksum field is absent (default: `false`). */
  requireFuseChecksum?: boolean | undefined;
  /** Report info diagnostic when security fuse `G1*` is blown (default: `true`). */
  reportSecurityFuse?: boolean | undefined;
}

const DEFAULT_SPAN: JedecSourceSpan = { line: 1, column: 1, startOffset: 0, endOffset: 0 };

function pushDiag(
  diags: JedecDiagnostic[],
  spec: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span: JedecSourceSpan = DEFAULT_SPAN,
): void {
  diags.push({
    code: spec.id,
    numericCode: spec.code,
    rule: spec.rule,
    severity: spec.severity,
    message,
    line: span.line,
    column: span.column,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
  });
}

/**
 * Validates a parsed `JedecDocument` against JESD3 structural, checksum, bounds, and test-vector rules.
 */
export function lintJedec(doc: JedecDocument, options?: JedecLintOptions): JedecDiagnostic[] {
  const diags: JedecDiagnostic[] = [];

  // 1. Syntax / missing `*` delimiter / invalid bit or vector characters recorded by parser
  for (const issue of doc.syntaxIssues) {
    if (issue.kind === "missing-delimiter") {
      pushDiag(
        diags,
        JedecErrorCode.MISSING_FIELD_DELIMITER,
        JedecErrorCode.MISSING_FIELD_DELIMITER.message(issue.message),
        issue.span,
      );
    } else if (issue.kind === "invalid-fuse-bit") {
      const [ch, addrStr] = issue.message.split("@");
      const addr = Number.parseInt(addrStr ?? "0", 10);
      pushDiag(
        diags,
        JedecErrorCode.INVALID_FUSE_BIT,
        JedecErrorCode.INVALID_FUSE_BIT.message(ch ?? "?", addr),
        issue.span,
      );
    } else if (issue.kind === "invalid-vector-char") {
      const [ch, vecStr] = issue.message.split("@");
      const vecNum = Number.parseInt(vecStr ?? "0", 10);
      pushDiag(
        diags,
        JedecErrorCode.INVALID_VECTOR_CHAR,
        JedecErrorCode.INVALID_VECTOR_CHAR.message(ch ?? "?", vecNum),
        issue.span,
      );
    } else {
      pushDiag(diags, JedecErrorCode.SYNTAX_ERROR, JedecErrorCode.SYNTAX_ERROR.message(issue.message), issue.span);
    }
  }

  // 2. Mandatory QF fuse count
  if (doc.fuseCount === undefined) {
    pushDiag(diags, JedecErrorCode.MISSING_FUSE_COUNT, JedecErrorCode.MISSING_FUSE_COUNT.message(), DEFAULT_SPAN);
  }

  // 3. Invalid default fuse state F (must be 0 or 1)
  if (doc.rawDefaultFuseState !== undefined && doc.defaultFuseState === undefined) {
    pushDiag(
      diags,
      JedecErrorCode.INVALID_DEFAULT_FUSE_STATE,
      JedecErrorCode.INVALID_DEFAULT_FUSE_STATE.message(doc.rawDefaultFuseState),
      doc.defaultFuseSpan ?? DEFAULT_SPAN,
    );
  }

  // 4. Invalid security fuse G (must be 0 or 1)
  if (doc.rawSecurityFuse !== undefined && doc.securityFuse === undefined) {
    pushDiag(
      diags,
      JedecErrorCode.INVALID_SECURITY_FUSE,
      JedecErrorCode.INVALID_SECURITY_FUSE.message(doc.rawSecurityFuse),
      doc.securityFuseSpan ?? DEFAULT_SPAN,
    );
  }

  // 5. 16-bit C fuse checksum verification
  if (doc.declaredFuseChecksum !== undefined) {
    if ((doc.declaredFuseChecksum & 0xffff) !== (doc.computedFuseChecksum & 0xffff)) {
      pushDiag(
        diags,
        JedecErrorCode.FUSE_CHECKSUM_MISMATCH,
        JedecErrorCode.FUSE_CHECKSUM_MISMATCH.message(
          doc.declaredFuseChecksumHex ?? formatHex16(doc.declaredFuseChecksum),
          formatHex16(doc.computedFuseChecksum),
        ),
        doc.declaredFuseChecksumSpan ?? DEFAULT_SPAN,
      );
    }
  } else if (options?.requireFuseChecksum) {
    pushDiag(diags, JedecErrorCode.MISSING_FUSE_CHECKSUM, JedecErrorCode.MISSING_FUSE_CHECKSUM.message(), DEFAULT_SPAN);
  }

  // 6. 16-bit ETX transmission checksum verification
  if (doc.declaredTransmissionChecksum !== undefined && doc.computedTransmissionChecksum !== undefined) {
    if ((doc.declaredTransmissionChecksum & 0xffff) !== (doc.computedTransmissionChecksum & 0xffff)) {
      pushDiag(
        diags,
        JedecErrorCode.TRANSMISSION_CHECKSUM_MISMATCH,
        JedecErrorCode.TRANSMISSION_CHECKSUM_MISMATCH.message(
          doc.declaredTransmissionChecksumHex ?? formatHex16(doc.declaredTransmissionChecksum),
          formatHex16(doc.computedTransmissionChecksum),
        ),
        doc.declaredTransmissionChecksumSpan ?? DEFAULT_SPAN,
      );
    }
  }

  // 7. L fuse address bounds & overlapping fuse writes
  const fuseCount = doc.fuseCount;
  const writtenMap = fuseCount !== undefined && fuseCount > 0 ? new Uint8Array(fuseCount) : undefined;

  for (const block of doc.fuseBlocks) {
    const startAddr = block.address;
    const endAddr = startAddr + block.bits.length;

    if (fuseCount !== undefined && (startAddr < 0 || endAddr > fuseCount)) {
      pushDiag(
        diags,
        JedecErrorCode.FUSE_ADDRESS_OUT_OF_BOUNDS,
        JedecErrorCode.FUSE_ADDRESS_OUT_OF_BOUNDS.message(startAddr, endAddr, fuseCount),
        block.span,
      );
    }

    if (writtenMap) {
      let overlapCount = 0;
      let firstOverlapAddr = -1;
      const limit = Math.min(endAddr, fuseCount ?? 0);
      for (let addr = Math.max(0, startAddr); addr < limit; addr++) {
        if (writtenMap[addr] === 1) {
          if (firstOverlapAddr === -1) firstOverlapAddr = addr;
          overlapCount++;
        } else {
          writtenMap[addr] = 1;
        }
      }
      if (overlapCount > 0) {
        pushDiag(
          diags,
          JedecErrorCode.OVERLAPPING_FUSE_WRITE,
          JedecErrorCode.OVERLAPPING_FUSE_WRITE.message(firstOverlapAddr, overlapCount),
          block.span,
        );
      }
    }
  }

  // 8. Test vectors V vs QP pin count and QV max vector count
  if (doc.testVectors.length > 0 && doc.pinCount === undefined) {
    pushDiag(
      diags,
      JedecErrorCode.MISSING_PIN_COUNT_FOR_VECTORS,
      JedecErrorCode.MISSING_PIN_COUNT_FOR_VECTORS.message(doc.testVectors.length),
      doc.testVectors[0]?.span ?? DEFAULT_SPAN,
    );
  }

  if (doc.pinCount !== undefined) {
    for (const vec of doc.testVectors) {
      if (vec.pins.length !== doc.pinCount) {
        pushDiag(
          diags,
          JedecErrorCode.VECTOR_LENGTH_MISMATCH,
          JedecErrorCode.VECTOR_LENGTH_MISMATCH.message(vec.number, vec.pins.length, doc.pinCount),
          vec.span,
        );
      }
    }
  }

  if (doc.maxVectors !== undefined && doc.testVectors.length > doc.maxVectors) {
    pushDiag(
      diags,
      JedecErrorCode.VECTOR_COUNT_EXCEEDS_QV,
      JedecErrorCode.VECTOR_COUNT_EXCEEDS_QV.message(doc.testVectors.length, doc.maxVectors),
      doc.testVectors[doc.maxVectors]?.span ?? doc.maxVectorsSpan ?? DEFAULT_SPAN,
    );
  }

  // 9. Security fuse blown advisory
  if (doc.securityFuse === 1 && (options?.reportSecurityFuse ?? true)) {
    pushDiag(
      diags,
      JedecErrorCode.SECURITY_FUSE_BLOWN,
      JedecErrorCode.SECURITY_FUSE_BLOWN.message(),
      doc.securityFuseSpan ?? DEFAULT_SPAN,
    );
  }

  return diags;
}
