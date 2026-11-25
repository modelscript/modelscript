<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/asn1

**Maturity:** Beta · **Extensions:** `.asn`, `.asn1`, `.mib` · **Docs:** [modelscript.org/languages/asn1](https://modelscript.org/languages/asn1)

Native **ASN.1 (ISO/ITU-T X.208 / X.680 Abstract Syntax Notation One + X.690 BER/DER TLV Codec, 1984)** compiler, binary wire codec, schema analyzer, and interactive visualizer for ModelScript. Features a native WebAssembly GLR parser (`parser.wasm`), canonical BER/DER Tag-Length-Value binary encoder & decoder (including base-128 VLQ `OBJECT IDENTIFIER`, minimal two's-complement `INTEGER`, definite short/long length, and lexicographic `SET` sorting), 17 schema & wire diagnostics (`ASN11001`–`ASN15006`), wire-size byte bounds & DAE bandwidth lowering, projections to ITU-T Z.100 SDL-88 `NEWTYPE`, C99 structs, and JSON Schema, plus an interactive React + SVG Type Graph & BER/DER TLV Inspector panel.

---

## Core Capabilities

- **WASM GLR Grammar & Recursive-Descent Parser (`asn1Language`, `parseAsn1`)**: Parses ASN.1 modules (`DEFINITIONS`, `AUTOMATIC`/`EXPLICIT`/`IMPLICIT TAGS`, `BEGIN`/`END`, `IMPORTS`/`EXPORTS`, `::=`, `SEQUENCE`, `SEQUENCE OF`, `SET`, `SET OF`, `CHOICE`, `ENUMERATED`, `INTEGER`, `BOOLEAN`, `REAL`, `NULL`, `OCTET STRING`, `BIT STRING`, `OBJECT IDENTIFIER`, `UTF8String`/`IA5String`/`PrintableString`, context/application/private tags `[n]`, `OPTIONAL`, `DEFAULT`, `SIZE`, range `(a..b)`, `--` comments).
- **Canonical X.690 BER/DER TLV Codec (`encodeDer`, `decodeBer`, `encodeOidContent`, `decodeOidContent`, `encodeDerIntegerContent`, `encodeLength`)**: Exact byte-level X.690 DER encoder and permissive BER decoder with canonicality verification.
- **Schema & Wire Linter (`lintAsn1`, `Asn1ErrorCode`)**: 17 diagnostic rules (`ASN11001`–`ASN15006`) covering syntax errors, duplicate types/fields/enums, undefined type references, cyclic non-optional dependencies, duplicate context tags in `CHOICE`/`SET`, ambiguous consecutive untagged `OPTIONAL` fields, invalid `SIZE`/range constraints, non-canonical DER lengths/booleans/integers, and invalid OID root arcs.
- **Type Dependency Graph, Wire-Size Bounds & DAE Lowering (`buildAsn1TypeGraph`, `computeWireSizeBounds`, `verifyDerRoundTrip`, `lowerAsn1ToDae`, `asn1ToDae`)**: Computes min/max BER/DER wire byte bounds and TLV overhead per type and lowers bandwidth & traffic accumulation equations directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections (`asn1ToSdl`, `asn1ToC`, `asn1ToJsonSchema`)**: Projects ASN.1 modules to ITU-T Z.100 SDL-88 `NEWTYPE`, C99 `typedef struct`/`enum`/`union` headers, and JSON Schema Draft 2020-12.
- **Cleanroom Standard Library (`@modelscript/asn1-std-lib`)**: X.680 universal tags (`0x01` BOOLEAN through `0x31` SET) and classic 1980s protocol schemas (SNMPv1 PDU, X.509 `AlgorithmIdentifier` & `Validity`, IEC 61850 GOOSE PDU) with SVG icons and AssemblyScript WASM runtime.
- **Interactive Visualization & LSP (`renderAsn1DiagramSvg`, `renderBerTlvSvg`, `Asn1Panel`, `validateAsn1`, `getAsn1DocumentSymbols`, `getAsn1Hover`, `getAsn1Completions`)**: Pure SVG schema type-dependency graph, color-coded BER/DER TLV byte-layout breakdown, and React panel for VS Code / Ansatz.

---

## Semantic & Wire Lint Rules (`ASN11001`–`ASN15006`)

| Code       | Rule                        | Severity  | Description                                                                    |
| :--------- | :-------------------------- | :-------- | :----------------------------------------------------------------------------- |
| `ASN11001` | `syntax-error`              | `error`   | Syntax error in ASN.1 module.                                                  |
| `ASN11002` | `unterminated-module`       | `error`   | Missing `BEGIN` or `END` delimiter in ASN.1 module.                            |
| `ASN12001` | `duplicate-type-definition` | `error`   | Duplicate type assignment in module scope.                                     |
| `ASN12002` | `duplicate-field-name`      | `error`   | Duplicate field name in `SEQUENCE`/`SET`/`CHOICE`.                             |
| `ASN12003` | `duplicate-enum-value`      | `error`   | Duplicate `ENUMERATED` or named-number name/integer value.                     |
| `ASN12004` | `undefined-type-reference`  | `error`   | Reference to an undefined ASN.1 type.                                          |
| `ASN13001` | `cyclic-type-dependency`    | `error`   | Cyclic non-optional type dependency causing infinite wire size.                |
| `ASN13002` | `duplicate-context-tag`     | `error`   | Duplicate tag `[n]` in `CHOICE`/`SET`/`SEQUENCE` causing decoding ambiguity.   |
| `ASN13003` | `ambiguous-optional-fields` | `warning` | Consecutive untagged `OPTIONAL` fields with identical outer tag.               |
| `ASN14001` | `invalid-size-constraint`   | `error`   | Invalid `SIZE` constraint (`min > max` or negative bound).                     |
| `ASN14002` | `invalid-integer-range`     | `error`   | Invalid integer range (`min > max`).                                           |
| `ASN15001` | `non-canonical-der-length`  | `error`   | Non-canonical DER length (indefinite `0x80` or non-minimal long form).         |
| `ASN15002` | `non-canonical-der-boolean` | `error`   | Non-canonical DER `BOOLEAN` byte (must be `0x00` or `0xFF`).                   |
| `ASN15003` | `non-canonical-der-integer` | `error`   | Non-canonical DER `INTEGER` (redundant leading sign octet).                    |
| `ASN15004` | `invalid-oid-arcs`          | `error`   | Invalid `OBJECT IDENTIFIER` root arcs (`arc0 > 2` or `arc0 < 2 && arc1 > 39`). |
| `ASN15005` | `truncated-tlv`             | `error`   | Truncated BER/DER TLV payload exceeding available buffer.                      |
| `ASN15006` | `trailing-tlv-bytes`        | `warning` | Trailing unparsed bytes after top-level BER/DER TLV.                           |

---

## Programmatic Usage

```typescript
import {
  parseAsn1,
  encodeDer,
  decodeBer,
  bytesToHex,
  lintAsn1,
  computeWireSizeBounds,
  asn1ToDae,
  asn1ToSdl,
  asn1ToC,
  asn1ToJsonSchema,
  renderAsn1DiagramSvg,
} from "@modelscript/asn1";

const der = encodeDer({
  kind: "sequence",
  items: [{ kind: "oid", value: "1.2.840.113549.1.1.1" }, { kind: "null" }],
});
console.log(bytesToHex(der)); // 30 0D 06 09 2A 86 48 86 F7 0D 01 01 01 05 00
```
