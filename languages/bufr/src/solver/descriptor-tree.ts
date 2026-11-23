// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatBufrDescriptor, lookupTableB, lookupTableD, parseBufrDescriptor } from "../catalog/wmo-tables.js";
import type { BufrDescriptor, BufrExpandedElement, BufrTableBEntry, BufrTableDEntry } from "../types.js";

export interface ExpandDescriptorOptions {
  customTableB?: ReadonlyMap<string, BufrTableBEntry>;
  customTableD?: ReadonlyMap<string, BufrTableDEntry>;
  /** Optional provider for delayed replication counts (0-31-001 / 0-31-002) in sequential order */
  delayedCounts?: number[];
  /** Maximum expansion depth to prevent cyclic Table D recursion */
  maxDepth?: number;
}

export interface ExpandDescriptorResult {
  elements: BufrExpandedElement[];
  unknownDescriptors: BufrDescriptor[];
  replicationErrors: Array<{ descriptor: BufrDescriptor; message: string }>;
}

/**
 * Expands a list of WMO BUFR Section 3 F-X-Y descriptors into flat Table B elements,
 * resolving Table D sequences (F=3), fixed & delayed replications (F=1),
 * and Table C data-width / scale change operators (F=2).
 */
export function expandBufrDescriptors(
  descriptors: readonly BufrDescriptor[],
  options: ExpandDescriptorOptions = {},
): ExpandDescriptorResult {
  const customB = options.customTableB;
  const customD = options.customTableD;
  const delayedCounts = options.delayedCounts ? [...options.delayedCounts] : [];
  const maxDepth = options.maxDepth ?? 16;

  const elements: BufrExpandedElement[] = [];
  const unknownDescriptors: BufrDescriptor[] = [];
  const replicationErrors: Array<{ descriptor: BufrDescriptor; message: string }> = [];

  let addBitWidth = 0;
  let addScale = 0;
  let delayedCursor = 0;

  function expandList(list: readonly BufrDescriptor[], seqPath: string[], depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    let i = 0;
    while (i < list.length) {
      const desc = list[i]!;
      i++;

      if (desc.f === 0) {
        // Table B element descriptor
        const entry = lookupTableB(desc.code, customB);
        if (!entry) {
          unknownDescriptors.push(desc);
        }
        const isDelayFactor = desc.x === 31 && (desc.y === 1 || desc.y === 2);
        const effWidth = entry
          ? entry.isString || isDelayFactor
            ? entry.bitWidth
            : Math.max(1, entry.bitWidth + addBitWidth)
          : 16;
        const effScale = entry ? (entry.isString || isDelayFactor ? entry.scale : entry.scale + addScale) : 0;
        const effRef = entry ? entry.referenceValue : 0;

        elements.push({
          descriptor: desc,
          tableB: entry,
          effectiveScale: effScale,
          effectiveReferenceValue: effRef,
          effectiveBitWidth: effWidth,
          sequencePath: [...seqPath],
          isDelayedReplicationCount: isDelayFactor,
        });
      } else if (desc.f === 1) {
        // Replication descriptor: 1-XX-YYY (XX descriptors repeated YYY times; YYY=0 => delayed)
        const countToReplicate = desc.x;
        let repeatTimes = desc.y;

        if (repeatTimes === 0) {
          // Delayed replication: next descriptor must be 0-31-001 or 0-31-002
          const factorDesc = list[i];
          if (!factorDesc || factorDesc.f !== 0 || factorDesc.x !== 31 || (factorDesc.y !== 1 && factorDesc.y !== 2)) {
            replicationErrors.push({
              descriptor: desc,
              message: `Delayed replication '${desc.code}' must be immediately followed by 0-31-001 or 0-31-002`,
            });
            continue;
          }
          i++; // consume delayed replication factor descriptor
          const factorEntry = lookupTableB(factorDesc.code, customB);
          elements.push({
            descriptor: factorDesc,
            tableB: factorEntry,
            effectiveScale: 0,
            effectiveReferenceValue: 0,
            effectiveBitWidth: factorEntry?.bitWidth ?? 8,
            sequencePath: [...seqPath],
            isDelayedReplicationCount: true,
          });

          const provided = delayedCounts[delayedCursor];
          delayedCursor++;
          if (provided === undefined) {
            repeatTimes = 1; // default single expansion when no data values are supplied
          } else if (!Number.isInteger(provided) || provided < 0) {
            replicationErrors.push({
              descriptor: desc,
              message: `Delayed replication count '${provided}' must be a non-negative integer`,
            });
            repeatTimes = 0;
          } else {
            repeatTimes = provided;
          }
        }

        if (i + countToReplicate > list.length) {
          replicationErrors.push({
            descriptor: desc,
            message: `Replication '${desc.code}' requests ${countToReplicate} descriptor(s) but only ${list.length - i} remain`,
          });
          continue;
        }

        const slice = list.slice(i, i + countToReplicate);
        i += countToReplicate;

        for (let r = 0; r < repeatTimes; r++) {
          const beforeLen = elements.length;
          expandList(slice, [...seqPath, `${desc.code}[${r}]`], depth + 1);
          for (let k = beforeLen; k < elements.length; k++) {
            elements[k]!.replicationIndex = r;
          }
        }
      } else if (desc.f === 2) {
        // Table C operator descriptor
        if (desc.x === 1) {
          // 2-01-YYY: Change data width (YYY=0 resets; else add YYY - 128 bits)
          addBitWidth = desc.y === 0 ? 0 : desc.y - 128;
        } else if (desc.x === 2) {
          // 2-02-YYY: Change scale (YYY=0 resets; else add YYY - 128)
          addScale = desc.y === 0 ? 0 : desc.y - 128;
        } else if (desc.x === 5) {
          // 2-05-YYY: Signify YYY-byte CCITT IA5 character string
          elements.push({
            descriptor: desc,
            tableB: {
              code: desc.code,
              f: 0,
              x: desc.x,
              y: desc.y,
              name: "Signify character",
              unit: "CCITT IA5",
              scale: 0,
              referenceValue: 0,
              bitWidth: desc.y * 8,
              isString: true,
            },
            effectiveScale: 0,
            effectiveReferenceValue: 0,
            effectiveBitWidth: desc.y * 8,
            sequencePath: [...seqPath],
          });
        }
      } else if (desc.f === 3) {
        // Table D sequence descriptor
        const seqEntry = lookupTableD(desc.code, customD);
        if (!seqEntry) {
          unknownDescriptors.push(desc);
          continue;
        }
        const childDescs: BufrDescriptor[] = [];
        for (const childCode of seqEntry.descriptors) {
          const parsed = parseBufrDescriptor(childCode, desc.line, desc.startOffset, desc.endOffset);
          if (parsed) {
            childDescs.push(parsed);
          } else {
            unknownDescriptors.push({
              f: 0,
              x: 0,
              y: 0,
              code: formatBufrDescriptor(0, 0, 0),
              line: desc.line,
            });
          }
        }
        expandList(childDescs, [...seqPath, desc.code], depth + 1);
      }
    }
  }

  expandList(descriptors, [], 0);
  return { elements, unknownDescriptors, replicationErrors };
}
