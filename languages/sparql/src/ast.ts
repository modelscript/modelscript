// SPDX-License-Identifier: AGPL-3.0-or-later

export interface GenericSyntaxNode {
  type: string;
  text?: string | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  isError?: boolean | undefined;
  hasError?: boolean | (() => boolean) | undefined;
  children?: GenericSyntaxNode[] | undefined;
  childCount?: number | undefined;
  child?: ((index: number) => GenericSyntaxNode | null) | undefined;
}

export type SparqlTerm =
  | { termType: "NamedNode"; value: string }
  | { termType: "Literal"; value: string; datatype?: string | undefined; language?: string | undefined }
  | { termType: "BlankNode"; value: string }
  | { termType: "Variable"; value: string };

export type SparqlPropertyPath =
  | { kind: "iri"; iri: string }
  | { kind: "inverse"; path: SparqlPropertyPath }
  | { kind: "zeroOrMore"; path: SparqlPropertyPath }
  | { kind: "oneOrMore"; path: SparqlPropertyPath }
  | { kind: "zeroOrOne"; path: SparqlPropertyPath }
  | { kind: "sequence"; steps: SparqlPropertyPath[] }
  | { kind: "alternation"; branches: SparqlPropertyPath[] }
  | { kind: "negatedPropertySet"; iris: string[] };

export interface SparqlTriplePattern {
  subject: SparqlTerm;
  predicate: SparqlTerm | { termType: "PropertyPath"; path: SparqlPropertyPath };
  object: SparqlTerm;
}

export type SparqlExpr =
  | { kind: "term"; term: SparqlTerm }
  | { kind: "unary"; op: "!" | "+" | "-"; arg: SparqlExpr }
  | {
      kind: "binary";
      op: "||" | "&&" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/";
      left: SparqlExpr;
      right: SparqlExpr;
    }
  | { kind: "in"; negated: boolean; expr: SparqlExpr; list: SparqlExpr[] }
  | { kind: "call"; fn: string; distinct?: boolean | undefined; star?: boolean | undefined; args: SparqlExpr[] };

export type SparqlGraphPattern =
  | { kind: "bgp"; triples: SparqlTriplePattern[] }
  | { kind: "group"; patterns: SparqlGraphPattern[] }
  | { kind: "subselect"; query: SparqlQuery }
  | { kind: "optional"; pattern: SparqlGraphPattern }
  | { kind: "union"; branches: SparqlGraphPattern[] }
  | { kind: "minus"; pattern: SparqlGraphPattern }
  | { kind: "graph"; graph: SparqlTerm; pattern: SparqlGraphPattern }
  | { kind: "service"; silent: boolean; endpoint: SparqlTerm; pattern: SparqlGraphPattern }
  | { kind: "filter"; expr: SparqlExpr }
  | { kind: "bind"; expr: SparqlExpr; variable: string }
  | { kind: "values"; variables: string[]; rows: Array<Array<SparqlTerm | null>> };

export interface SparqlProjectionItem {
  variable: string;
  expr?: SparqlExpr | undefined;
}

export interface SparqlOrderCondition {
  expr: SparqlExpr;
  direction: "ASC" | "DESC";
}

export interface SparqlSolutionModifier {
  groupBy: Array<{ expr: SparqlExpr; alias?: string | undefined }>;
  having: SparqlExpr[];
  orderBy: SparqlOrderCondition[];
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SparqlQuery {
  queryType: "SELECT" | "CONSTRUCT" | "DESCRIBE" | "ASK" | "INSERT_DATA" | "DELETE_DATA" | "MODIFY";
  base?: string | undefined;
  prefixes: Map<string, string>;
  distinct?: boolean | undefined;
  reduced?: boolean | undefined;
  star?: boolean | undefined;
  projections?: SparqlProjectionItem[] | undefined;
  template?: SparqlTriplePattern[] | undefined;
  deleteTemplate?: SparqlTriplePattern[] | undefined;
  insertTemplate?: SparqlTriplePattern[] | undefined;
  describeTargets?: SparqlTerm[] | undefined;
  where: SparqlGraphPattern;
  modifier: SparqlSolutionModifier;
  trailingValues?: { variables: string[]; rows: Array<Array<SparqlTerm | null>> } | undefined;
  hasServiceClause: boolean;
}

const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export function getChildren(node: GenericSyntaxNode): GenericSyntaxNode[] {
  if (Array.isArray(node.children)) return node.children;
  if (typeof node.childCount === "number" && typeof node.child === "function") {
    const out: GenericSyntaxNode[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) out.push(c);
    }
    return out;
  }
  return [];
}

export function getText(node: GenericSyntaxNode, sourceText?: string): string {
  if (node.text !== undefined) return node.text.trim();
  const start = node.startOffset ?? node.startIndex;
  const end = node.endOffset ?? node.endIndex;
  if (sourceText !== undefined && typeof start === "number" && typeof end === "number") {
    return sourceText.slice(start, end).trim();
  }
  return getChildren(node)
    .map((c) => getText(c, sourceText))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function unescapeStringLiteral(raw: string): string {
  const inner = raw.slice(1, -1);
  return inner.replace(/\\(["'\\nrt])/g, (_m, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "r") return "\r";
    if (ch === "t") return "\t";
    return ch;
  });
}

function resolveIri(raw: string, prefixes: ReadonlyMap<string, string>, base?: string): string {
  const clean = raw.trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    const inner = clean.slice(1, -1);
    if (base && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(inner)) {
      try {
        return new URL(inner, base).toString();
      } catch {
        return base + inner;
      }
    }
    return inner;
  }
  const colonIdx = clean.indexOf(":");
  if (colonIdx !== -1) {
    const pfx = clean.slice(0, colonIdx + 1);
    const local = clean.slice(colonIdx + 1);
    const ns = prefixes.get(pfx);
    if (ns !== undefined) return ns + local;
  }
  return clean;
}

/**
 * Lowers a parsed `@modelscript/sparql` WASM GLR CST into a typed `SparqlQuery` algebra object.
 */
export function lowerSparqlCst(rootNode: GenericSyntaxNode, sourceText?: string): SparqlQuery {
  const prefixes = new Map<string, string>();
  let base: string | undefined;
  let hasServiceClause = false;
  let bnodeCounter = 0;
  const freshBnode = (): SparqlTerm => ({ termType: "BlankNode", value: `b${++bnodeCounter}` });
  const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
  const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
  const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";

  const textOf = (n: GenericSyntaxNode): string => getText(n, sourceText);

  const lowerTerm = (node: GenericSyntaxNode, extraTriples?: SparqlTriplePattern[]): SparqlTerm => {
    const t = node.type;
    if (t === "VarOrTerm" || t === "DataBlockValue" || t === "PrimaryExpression") {
      const ch = getChildren(node);
      if (ch.length === 1) return lowerTerm(ch[0]!, extraTriples);
    }
    if (t === "BlankNodePropertyList") {
      const bnode = freshBnode();
      if (extraTriples) {
        const propList = getChildren(node).find((c) => c.type === "PropertyListNotEmpty");
        if (propList) extraTriples.push(...lowerPropertyList(bnode, propList));
      }
      return bnode;
    }
    if (t === "Collection") {
      const items = getChildren(node).filter((c) => c.type === "VarOrTerm");
      if (items.length === 0) return { termType: "NamedNode", value: RDF_NIL };
      const head = freshBnode();
      if (extraTriples) {
        let cur = head;
        for (let i = 0; i < items.length; i++) {
          const val = lowerTerm(items[i]!, extraTriples);
          extraTriples.push({ subject: cur, predicate: { termType: "NamedNode", value: RDF_FIRST }, object: val });
          const nextNode: SparqlTerm = i + 1 < items.length ? freshBnode() : { termType: "NamedNode", value: RDF_NIL };
          extraTriples.push({ subject: cur, predicate: { termType: "NamedNode", value: RDF_REST }, object: nextNode });
          cur = nextNode;
        }
      }
      return head;
    }
    if (t === "VAR") {
      return { termType: "Variable", value: textOf(node).slice(1) };
    }
    if (t === "Iri" || t === "IRIREF" || t === "PNAME_LN" || t === "PNAME_NS") {
      return { termType: "NamedNode", value: resolveIri(textOf(node), prefixes, base) };
    }
    if (t === "BLANK_NODE_LABEL") {
      return { termType: "BlankNode", value: textOf(node).slice(2) };
    }
    if (t === "BooleanLiteral") {
      return {
        termType: "Literal",
        value: textOf(node).toLowerCase(),
        datatype: `${XSD_NS}boolean`,
      };
    }
    if (t === "NumericLiteral" || t === "INTEGER" || t === "DECIMAL_OR_DOUBLE") {
      const raw = textOf(node);
      const dt = /[eE]/.test(raw) ? `${XSD_NS}double` : raw.includes(".") ? `${XSD_NS}decimal` : `${XSD_NS}integer`;
      return { termType: "Literal", value: raw, datatype: dt };
    }
    if (t === "RDFLiteral") {
      const ch = getChildren(node);
      const strNode = ch.find((c) => c.type === "STRING_LITERAL");
      const langNode = ch.find((c) => c.type === "LANGTAG");
      const dtNode = ch.find((c) => c.type === "Iri" || c.type === "IRIREF" || c.type === "PNAME_LN");
      const value = strNode ? unescapeStringLiteral(textOf(strNode)) : textOf(node);
      if (langNode) {
        return { termType: "Literal", value, language: textOf(langNode).slice(1) };
      }
      if (dtNode) {
        return { termType: "Literal", value, datatype: resolveIri(textOf(dtNode), prefixes, base) };
      }
      return { termType: "Literal", value, datatype: `${XSD_NS}string` };
    }
    if (t === "STRING_LITERAL") {
      return { termType: "Literal", value: unescapeStringLiteral(textOf(node)), datatype: `${XSD_NS}string` };
    }
    const raw = textOf(node);
    if (raw.startsWith("?") || raw.startsWith("$")) {
      return { termType: "Variable", value: raw.slice(1) };
    }
    return { termType: "NamedNode", value: resolveIri(raw, prefixes, base) };
  };

  const lowerPath = (node: GenericSyntaxNode): SparqlPropertyPath => {
    const t = node.type;
    if (t === "PathAlternative") {
      const seqs = getChildren(node).filter((c) => c.type === "PathSequence");
      const branches = seqs.map(lowerPath);
      return branches.length === 1 ? branches[0]! : { kind: "alternation", branches };
    }
    if (t === "PathSequence") {
      const elts = getChildren(node).filter((c) => c.type === "PathEltOrInverse");
      const steps = elts.map(lowerPath);
      return steps.length === 1 ? steps[0]! : { kind: "sequence", steps };
    }
    if (t === "PathEltOrInverse") {
      const ch = getChildren(node);
      const isInv = ch.some((c) => textOf(c) === "^");
      const elt = ch.find((c) => c.type === "PathElt");
      const inner = elt ? lowerPath(elt) : { kind: "iri" as const, iri: resolveIri(textOf(node), prefixes, base) };
      return isInv ? { kind: "inverse", path: inner } : inner;
    }
    if (t === "PathElt") {
      const ch = getChildren(node);
      const prim = ch.find((c) => c.type === "PathPrimary");
      const mod = ch.find((c) => c.type === "PathMod");
      const basePath = prim ? lowerPath(prim) : { kind: "iri" as const, iri: resolveIri(textOf(node), prefixes, base) };
      const modText = mod ? textOf(mod) : "";
      if (modText === "+") return { kind: "oneOrMore", path: basePath };
      if (modText === "*") return { kind: "zeroOrMore", path: basePath };
      if (modText === "?") return { kind: "zeroOrOne", path: basePath };
      return basePath;
    }
    if (t === "PathNegatedPropertySet") {
      const iris: string[] = [];
      const collectNeg = (n: GenericSyntaxNode): void => {
        if (n.type === "Iri" || n.type === "IRIREF" || n.type === "PNAME_LN" || n.type === "PNAME_NS") {
          iris.push(resolveIri(textOf(n), prefixes, base));
          return;
        }
        if (textOf(n) === "a" && getChildren(n).length === 0) {
          iris.push(RDF_TYPE);
          return;
        }
        for (const c of getChildren(n)) collectNeg(c);
      };
      collectNeg(node);
      return { kind: "negatedPropertySet", iris };
    }
    if (t === "PathPrimary") {
      const ch = getChildren(node);
      const neg = ch.find((c) => c.type === "PathNegatedPropertySet");
      if (neg) return lowerPath(neg);
      const alt = ch.find((c) => c.type === "PathAlternative");
      if (alt) return lowerPath(alt);
      const raw = textOf(node);
      if (raw === "a") return { kind: "iri", iri: RDF_TYPE };
      return { kind: "iri", iri: resolveIri(raw, prefixes, base) };
    }
    const raw = textOf(node);
    if (raw === "a") return { kind: "iri", iri: RDF_TYPE };
    return { kind: "iri", iri: resolveIri(raw, prefixes, base) };
  };

  const lowerExpr = (node: GenericSyntaxNode): SparqlExpr => {
    const t = node.type;
    const ch = getChildren(node);

    if (t === "Expression" || t === "Constraint") {
      if (ch.length === 1) return lowerExpr(ch[0]!);
    }
    if (t === "BrackettedExpression") {
      const inner = ch.find((c) => c.type === "Expression");
      if (inner) return lowerExpr(inner);
    }
    if (t === "ConditionalOrExpression") {
      const operands = ch.filter((c) => c.type === "ConditionalOrExpression" || c.type === "ConditionalAndExpression");
      if (operands.length === 1) return lowerExpr(operands[0]!);
      if (operands.length >= 2)
        return { kind: "binary", op: "||", left: lowerExpr(operands[0]!), right: lowerExpr(operands[1]!) };
    }
    if (t === "ConditionalAndExpression") {
      const operands = ch.filter((c) => c.type === "ConditionalAndExpression" || c.type === "RelationalExpression");
      if (operands.length === 1) return lowerExpr(operands[0]!);
      if (operands.length >= 2)
        return { kind: "binary", op: "&&", left: lowerExpr(operands[0]!), right: lowerExpr(operands[1]!) };
    }
    if (t === "RelationalExpression") {
      const adds = ch.filter((c) => c.type === "AdditiveExpression");
      const rawTokens = ch.map((c) => textOf(c).toUpperCase());
      if (rawTokens.includes("IN")) {
        const negated = rawTokens.includes("NOT");
        const exprListNode = ch.find((c) => c.type === "ExpressionList");
        const list = exprListNode ? collectExprList(exprListNode) : [];
        return { kind: "in", negated, expr: lowerExpr(adds[0]!), list };
      }
      if (adds.length === 1) return lowerExpr(adds[0]!);
      if (adds.length >= 2) {
        const opToken = ch.find((c) => ["=", "!=", "<=", ">=", "<", ">"].includes(textOf(c)));
        const op = (opToken ? textOf(opToken) : "=") as "=" | "!=" | "<=" | ">=" | "<" | ">";
        return { kind: "binary", op, left: lowerExpr(adds[0]!), right: lowerExpr(adds[1]!) };
      }
    }
    if (t === "AdditiveExpression") {
      const ops = ch.filter((c) => c.type === "AdditiveExpression" || c.type === "MultiplicativeExpression");
      if (ops.length === 1) return lowerExpr(ops[0]!);
      if (ops.length >= 2) {
        const opTok = ch.find((c) => textOf(c) === "+" || textOf(c) === "-");
        const op = (opTok ? textOf(opTok) : "+") as "+" | "-";
        return { kind: "binary", op, left: lowerExpr(ops[0]!), right: lowerExpr(ops[1]!) };
      }
    }
    if (t === "MultiplicativeExpression") {
      const ops = ch.filter((c) => c.type === "MultiplicativeExpression" || c.type === "UnaryExpression");
      if (ops.length === 1) return lowerExpr(ops[0]!);
      if (ops.length >= 2) {
        const opTok = ch.find((c) => textOf(c) === "*" || textOf(c) === "/");
        const op = (opTok ? textOf(opTok) : "*") as "*" | "/";
        return { kind: "binary", op, left: lowerExpr(ops[0]!), right: lowerExpr(ops[1]!) };
      }
    }
    if (t === "UnaryExpression") {
      const prim = ch.find((c) => c.type === "PrimaryExpression");
      const firstTok = ch[0] ? textOf(ch[0]) : "";
      if ((firstTok === "!" || firstTok === "+" || firstTok === "-") && prim) {
        return { kind: "unary", op: firstTok, arg: lowerExpr(prim) };
      }
      if (prim) return lowerExpr(prim);
    }
    if (t === "PrimaryExpression") {
      if (ch.length === 1) return lowerExpr(ch[0]!);
    }
    if (t === "BuiltInCall") {
      const fnNode = ch.find((c) => c.type === "IDENT");
      const fn = (fnNode ? textOf(fnNode) : "").toUpperCase();
      const distinct = ch.some((c) => textOf(c).toUpperCase() === "DISTINCT");
      const star = ch.some((c) => textOf(c) === "*");
      const listNode = ch.find((c) => c.type === "ExpressionList");
      const args = listNode ? collectExprList(listNode) : [];
      return { kind: "call", fn, distinct, star, args };
    }
    return { kind: "term", term: lowerTerm(node) };
  };

  const collectExprList = (node: GenericSyntaxNode): SparqlExpr[] => {
    const out: SparqlExpr[] = [];
    const walk = (n: GenericSyntaxNode): void => {
      if (n.type === "Expression") {
        out.push(lowerExpr(n));
        return;
      }
      for (const c of getChildren(n)) walk(c);
    };
    walk(node);
    return out;
  };

  const lowerPropertyList = (subject: SparqlTerm, propListNode: GenericSyntaxNode): SparqlTriplePattern[] => {
    const triples: SparqlTriplePattern[] = [];
    const pairs: GenericSyntaxNode[] = [];
    const collectPairs = (n: GenericSyntaxNode): void => {
      if (n.type === "BlankNodePropertyList" || n.type === "Collection") return;
      if (n.type === "PropertyObjectPair") {
        pairs.push(n);
        return;
      }
      for (const c of getChildren(n)) collectPairs(c);
    };
    collectPairs(propListNode);

    for (const pair of pairs) {
      const pCh = getChildren(pair);
      const verbNode = pCh.find((c) => c.type === "VerbPathOrSimple");
      const objListNode = pCh.find((c) => c.type === "ObjectList");
      if (!verbNode || !objListNode) continue;

      const vCh = getChildren(verbNode);
      let predicate: SparqlTriplePattern["predicate"];
      if (vCh[0]?.type === "VAR") {
        predicate = lowerTerm(vCh[0]);
      } else if (vCh[0]?.type === "PathAlternative") {
        const path = lowerPath(vCh[0]);
        predicate =
          path.kind === "iri" ? { termType: "NamedNode", value: path.iri } : { termType: "PropertyPath", path };
      } else {
        predicate = { termType: "NamedNode", value: resolveIri(textOf(verbNode), prefixes, base) };
      }

      const objNodes: GenericSyntaxNode[] = [];
      const collectObjs = (n: GenericSyntaxNode): void => {
        if (n.type === "VarOrTerm") {
          objNodes.push(n);
          return;
        }
        for (const c of getChildren(n)) collectObjs(c);
      };
      collectObjs(objListNode);

      for (const oNode of objNodes) {
        const extra: SparqlTriplePattern[] = [];
        const objTerm = lowerTerm(oNode, extra);
        triples.push({ subject, predicate, object: objTerm });
        triples.push(...extra);
      }
    }
    return triples;
  };

  const lowerTriplesSameSubject = (node: GenericSyntaxNode): SparqlTriplePattern[] => {
    const triples: SparqlTriplePattern[] = [];
    const ch = getChildren(node);
    const subjNode = ch.find((c) => c.type === "VarOrTerm");
    const propListNode = ch.find((c) => c.type === "PropertyListNotEmpty");
    if (!subjNode || !propListNode) return triples;
    const subject = lowerTerm(subjNode, triples);
    triples.push(...lowerPropertyList(subject, propListNode));
    return triples;
  };

  const lowerValuesClause = (
    node: GenericSyntaxNode,
  ): { variables: string[]; rows: Array<Array<SparqlTerm | null>> } => {
    const variables: string[] = [];
    const rows: Array<Array<SparqlTerm | null>> = [];
    const directVars = getChildren(node).filter((c) => c.type === "VAR");
    const rowNodes: GenericSyntaxNode[] = [];
    const singleValues: GenericSyntaxNode[] = [];

    const walk = (n: GenericSyntaxNode): void => {
      if (n.type === "ValuesRow") {
        rowNodes.push(n);
        return;
      }
      if (n.type === "DataBlockValue") {
        singleValues.push(n);
        return;
      }
      for (const c of getChildren(n)) walk(c);
    };
    for (const c of getChildren(node)) {
      if (c.type === "VAR") continue;
      walk(c);
    }

    // Collect variables from direct children or nested repeat
    const collectVars = (n: GenericSyntaxNode): void => {
      if (n.type === "ValuesRow" || n.type === "DataBlockValue") return;
      if (n.type === "VAR") {
        variables.push(textOf(n).slice(1));
        return;
      }
      for (const c of getChildren(n)) collectVars(c);
    };
    if (directVars.length > 0) {
      for (const v of directVars) variables.push(textOf(v).slice(1));
    } else {
      collectVars(node);
    }

    if (rowNodes.length > 0) {
      for (const rNode of rowNodes) {
        const vals: Array<SparqlTerm | null> = [];
        const collectRowVals = (n: GenericSyntaxNode): void => {
          if (n.type === "DataBlockValue") {
            vals.push(textOf(n).toUpperCase() === "UNDEF" ? null : lowerTerm(n));
            return;
          }
          for (const c of getChildren(n)) collectRowVals(c);
        };
        collectRowVals(rNode);
        rows.push(vals);
      }
    } else if (singleValues.length > 0) {
      for (const sv of singleValues) {
        rows.push([textOf(sv).toUpperCase() === "UNDEF" ? null : lowerTerm(sv)]);
      }
    }

    return { variables, rows };
  };

  const lowerSelectLike = (selectNode: GenericSyntaxNode): SparqlQuery => {
    const selClause = getChildren(selectNode).find((c) => c.type === "SelectClause");
    const selCh = selClause ? getChildren(selClause) : [];
    const distinct = selCh.some((c) => textOf(c).toUpperCase() === "DISTINCT");
    const reduced = selCh.some((c) => textOf(c).toUpperCase() === "REDUCED");
    const star = selCh.some((c) => textOf(c) === "*");
    const projections: SparqlProjectionItem[] = [];

    if (!star && selClause) {
      const collectProj = (n: GenericSyntaxNode): void => {
        if (n.type === "SelectProjection") {
          const pCh = getChildren(n);
          const exprNode = pCh.find((c) => c.type === "Expression");
          const varNode = pCh.find((c) => c.type === "VAR");
          if (exprNode && varNode) {
            projections.push({ variable: textOf(varNode).slice(1), expr: lowerExpr(exprNode) });
          } else if (varNode) {
            projections.push({ variable: textOf(varNode).slice(1) });
          }
          return;
        }
        for (const c of getChildren(n)) collectProj(c);
      };
      collectProj(selClause);
    }

    const wcNode = getChildren(selectNode).find((c) => c.type === "WhereClause");
    const wgNode = wcNode ? getChildren(wcNode).find((c) => c.type === "GroupGraphPattern") : undefined;
    const subWhere: SparqlGraphPattern = wgNode ? lowerGroupGraphPattern(wgNode) : { kind: "group", patterns: [] };
    const subModNode = getChildren(selectNode).find((c) => c.type === "SolutionModifier");
    const subMod = lowerSolutionModifier(subModNode);
    const subValNode = getChildren(selectNode).find((c) => c.type === "ValuesClause");
    const subVal = subValNode ? lowerValuesClause(subValNode) : undefined;

    return {
      queryType: "SELECT",
      base,
      prefixes,
      distinct,
      reduced,
      star,
      projections,
      where: subWhere,
      modifier: subMod,
      trailingValues: subVal,
      hasServiceClause,
    };
  };

  const lowerGroupGraphPattern = (node: GenericSyntaxNode): SparqlGraphPattern => {
    const subSel = getChildren(node).find((c) => c.type === "SubSelect");
    if (subSel) {
      return { kind: "subselect", query: lowerSelectLike(subSel) };
    }
    const patterns: SparqlGraphPattern[] = [];
    let pendingTriples: SparqlTriplePattern[] = [];

    const flushTriples = (): void => {
      if (pendingTriples.length > 0) {
        patterns.push({ kind: "bgp", triples: pendingTriples });
        pendingTriples = [];
      }
    };

    const items: GenericSyntaxNode[] = [];
    const collectItems = (n: GenericSyntaxNode): void => {
      if (n.type === "GraphPatternItem") {
        items.push(n);
        return;
      }
      for (const c of getChildren(n)) {
        if (c.type !== "GroupGraphPattern") collectItems(c);
      }
    };
    collectItems(node);

    for (const item of items) {
      const inner = getChildren(item)[0];
      if (!inner) continue;
      switch (inner.type) {
        case "TriplesSameSubject": {
          pendingTriples.push(...lowerTriplesSameSubject(inner));
          break;
        }
        case "OptionalGraphPattern": {
          flushTriples();
          const grp = getChildren(inner).find((c) => c.type === "GroupGraphPattern");
          if (grp) patterns.push({ kind: "optional", pattern: lowerGroupGraphPattern(grp) });
          break;
        }
        case "MinusGraphPattern": {
          flushTriples();
          const grp = getChildren(inner).find((c) => c.type === "GroupGraphPattern");
          if (grp) patterns.push({ kind: "minus", pattern: lowerGroupGraphPattern(grp) });
          break;
        }
        case "GraphGraphPattern": {
          flushTriples();
          const gCh = getChildren(inner);
          const gTermNode = gCh.find((c) => c.type === "VAR" || c.type === "Iri");
          const grp = gCh.find((c) => c.type === "GroupGraphPattern");
          if (gTermNode && grp) {
            patterns.push({ kind: "graph", graph: lowerTerm(gTermNode), pattern: lowerGroupGraphPattern(grp) });
          }
          break;
        }
        case "ServiceGraphPattern": {
          flushTriples();
          hasServiceClause = true;
          const sCh = getChildren(inner);
          const silent = sCh.some((c) => textOf(c).toUpperCase() === "SILENT");
          const epNode = sCh.find((c) => c.type === "VAR" || c.type === "Iri");
          const grp = sCh.find((c) => c.type === "GroupGraphPattern");
          if (epNode && grp) {
            patterns.push({
              kind: "service",
              silent,
              endpoint: lowerTerm(epNode),
              pattern: lowerGroupGraphPattern(grp),
            });
          }
          break;
        }
        case "GroupOrUnionGraphPattern": {
          flushTriples();
          const branches: SparqlGraphPattern[] = [];
          const collectGroups = (n: GenericSyntaxNode): void => {
            if (n.type === "GroupGraphPattern") {
              branches.push(lowerGroupGraphPattern(n));
              return;
            }
            for (const c of getChildren(n)) collectGroups(c);
          };
          collectGroups(inner);
          if (branches.length === 1) {
            patterns.push(branches[0]!);
          } else if (branches.length > 1) {
            patterns.push({ kind: "union", branches });
          }
          break;
        }
        case "FilterClause": {
          flushTriples();
          const constr = getChildren(inner).find((c) => c.type === "Constraint");
          if (constr) patterns.push({ kind: "filter", expr: lowerExpr(constr) });
          break;
        }
        case "BindClause": {
          flushTriples();
          const bCh = getChildren(inner);
          const exprNode = bCh.find((c) => c.type === "Expression");
          const varNode = bCh.find((c) => c.type === "VAR");
          if (exprNode && varNode) {
            patterns.push({ kind: "bind", expr: lowerExpr(exprNode), variable: textOf(varNode).slice(1) });
          }
          break;
        }
        case "ValuesClause": {
          flushTriples();
          const v = lowerValuesClause(inner);
          patterns.push({ kind: "values", ...v });
          break;
        }
      }
    }

    flushTriples();
    if (patterns.length === 1) return patterns[0]!;
    return { kind: "group", patterns };
  };

  const lowerSolutionModifier = (node?: GenericSyntaxNode): SparqlSolutionModifier => {
    const mod: SparqlSolutionModifier = { groupBy: [], having: [], orderBy: [] };
    if (!node) return mod;

    const walk = (n: GenericSyntaxNode): void => {
      if (n.type === "GroupCondition") {
        const gCh = getChildren(n);
        const exprNode = gCh.find((c) => c.type === "Expression" || c.type === "BuiltInCall" || c.type === "VAR");
        const aliasVars = gCh.filter((c) => c.type === "VAR");
        const hasAs = gCh.some((c) => textOf(c).toUpperCase() === "AS");
        if (exprNode) {
          mod.groupBy.push({
            expr: lowerExpr(exprNode),
            alias: hasAs && aliasVars.length > 0 ? textOf(aliasVars[aliasVars.length - 1]!).slice(1) : undefined,
          });
        }
        return;
      }
      if (n.type === "HavingClause") {
        for (const c of getChildren(n)) {
          if (c.type === "Constraint") mod.having.push(lowerExpr(c));
          else walk(c);
        }
        return;
      }
      if (n.type === "OrderCondition") {
        const oCh = getChildren(n);
        const isDesc = oCh.some((c) => textOf(c).toUpperCase() === "DESC");
        const exprNode = oCh.find(
          (c) => c.type === "BrackettedExpression" || c.type === "Constraint" || c.type === "VAR",
        );
        if (exprNode) {
          mod.orderBy.push({ expr: lowerExpr(exprNode), direction: isDesc ? "DESC" : "ASC" });
        }
        return;
      }
      if (n.type === "LimitClause") {
        const num = getChildren(n).find((c) => c.type === "INTEGER");
        if (num) mod.limit = parseInt(textOf(num), 10);
        return;
      }
      if (n.type === "OffsetClause") {
        const num = getChildren(n).find((c) => c.type === "INTEGER");
        if (num) mod.offset = parseInt(textOf(num), 10);
        return;
      }
      for (const c of getChildren(n)) walk(c);
    };
    walk(node);
    return mod;
  };

  // 1. Collect Prologue (BASE & PREFIX)
  const walkPrologue = (n: GenericSyntaxNode): void => {
    if (n.type === "BaseDecl") {
      const iriNode = getChildren(n).find((c) => c.type === "IRIREF");
      if (iriNode) base = textOf(iriNode).slice(1, -1);
      return;
    }
    if (n.type === "PrefixDecl") {
      const pNode = getChildren(n).find((c) => c.type === "PNAME_NS");
      const iriNode = getChildren(n).find((c) => c.type === "IRIREF");
      if (pNode && iriNode) {
        prefixes.set(textOf(pNode), textOf(iriNode).slice(1, -1));
      }
      return;
    }
    for (const c of getChildren(n)) {
      if (c.type === "Prologue" || c.type === "BaseDecl" || c.type === "PrefixDecl" || c.type === "QueryUnit") {
        walkPrologue(c);
      } else if (c.type === "repeat" || c.type.startsWith("_")) {
        walkPrologue(c);
      }
    }
  };
  walkPrologue(rootNode);

  // 2. Find main query form node
  const findNode = (n: GenericSyntaxNode, types: string[]): GenericSyntaxNode | null => {
    if (types.includes(n.type)) return n;
    for (const c of getChildren(n)) {
      const found = findNode(c, types);
      if (found) return found;
    }
    return null;
  };

  const queryNode = findNode(rootNode, [
    "SelectQuery",
    "ConstructQuery",
    "DescribeQuery",
    "AskQuery",
    "InsertDataUpdate",
    "DeleteDataUpdate",
    "ModifyUpdate",
  ]);
  if (!queryNode) {
    return {
      queryType: "SELECT",
      base,
      prefixes,
      star: true,
      where: { kind: "group", patterns: [] },
      modifier: { groupBy: [], having: [], orderBy: [] },
      hasServiceClause,
    };
  }

  const collectTriplesIn = (n: GenericSyntaxNode): SparqlTriplePattern[] => {
    const out: SparqlTriplePattern[] = [];
    const walk = (cur: GenericSyntaxNode): void => {
      if (cur.type === "TriplesSameSubject") {
        out.push(...lowerTriplesSameSubject(cur));
        return;
      }
      for (const c of getChildren(cur)) walk(c);
    };
    walk(n);
    return out;
  };

  if (queryNode.type === "InsertDataUpdate") {
    return {
      queryType: "INSERT_DATA",
      base,
      prefixes,
      insertTemplate: collectTriplesIn(queryNode),
      where: { kind: "group", patterns: [] },
      modifier: { groupBy: [], having: [], orderBy: [] },
      hasServiceClause,
    };
  }

  if (queryNode.type === "DeleteDataUpdate") {
    return {
      queryType: "DELETE_DATA",
      base,
      prefixes,
      deleteTemplate: collectTriplesIn(queryNode),
      where: { kind: "group", patterns: [] },
      modifier: { groupBy: [], having: [], orderBy: [] },
      hasServiceClause,
    };
  }

  if (queryNode.type === "ModifyUpdate") {
    const ch = getChildren(queryNode);
    const deleteTemplate: SparqlTriplePattern[] = [];
    const insertTemplate: SparqlTriplePattern[] = [];
    let mode: "none" | "delete" | "insert" = "none";
    for (const c of ch) {
      const txt = textOf(c).toUpperCase();
      if (txt === "DELETE") {
        mode = "delete";
      } else if (txt === "INSERT") {
        mode = "insert";
      } else if (c.type === "WhereClause") {
        mode = "none";
      } else if (c.type === "TriplesBlock" || c.type === "TriplesSameSubject") {
        if (mode === "delete") deleteTemplate.push(...collectTriplesIn(c));
        else if (mode === "insert") insertTemplate.push(...collectTriplesIn(c));
      } else if (mode !== "none" && getChildren(c).length > 0) {
        const subTriples = collectTriplesIn(c);
        if (mode === "delete") deleteTemplate.push(...subTriples);
        else if (mode === "insert") insertTemplate.push(...subTriples);
      }
    }
    const wcNode = ch.find((c) => c.type === "WhereClause");
    const wgNode = wcNode ? getChildren(wcNode).find((c) => c.type === "GroupGraphPattern") : undefined;
    return {
      queryType: "MODIFY",
      base,
      prefixes,
      deleteTemplate,
      insertTemplate,
      where: wgNode ? lowerGroupGraphPattern(wgNode) : { kind: "group", patterns: [] },
      modifier: { groupBy: [], having: [], orderBy: [] },
      hasServiceClause,
    };
  }

  if (queryNode.type === "SelectQuery") {
    return lowerSelectLike(queryNode);
  }

  const whereClauseNode = getChildren(queryNode).find((c) => c.type === "WhereClause");
  const whereGroupNode = whereClauseNode
    ? getChildren(whereClauseNode).find((c) => c.type === "GroupGraphPattern")
    : undefined;
  const where: SparqlGraphPattern = whereGroupNode
    ? lowerGroupGraphPattern(whereGroupNode)
    : { kind: "group", patterns: [] };

  const modNode = getChildren(queryNode).find((c) => c.type === "SolutionModifier");
  const modifier = lowerSolutionModifier(modNode);
  const trailingValNode = getChildren(queryNode).find((c) => c.type === "ValuesClause");
  const trailingValues = trailingValNode ? lowerValuesClause(trailingValNode) : undefined;

  if (queryNode.type === "ConstructQuery") {
    const tmplNode = getChildren(queryNode).find((c) => c.type === "ConstructTemplate");
    const template: SparqlTriplePattern[] = [];
    if (tmplNode) {
      const collectTmpl = (n: GenericSyntaxNode): void => {
        if (n.type === "TriplesSameSubject") {
          template.push(...lowerTriplesSameSubject(n));
          return;
        }
        for (const c of getChildren(n)) collectTmpl(c);
      };
      collectTmpl(tmplNode);
    }
    return {
      queryType: "CONSTRUCT",
      base,
      prefixes,
      template,
      where,
      modifier,
      trailingValues,
      hasServiceClause,
    };
  }

  if (queryNode.type === "DescribeQuery") {
    const dCh = getChildren(queryNode);
    const star = dCh.some((c) => textOf(c) === "*");
    const describeTargets: SparqlTerm[] = [];
    if (!star) {
      const collectTargets = (n: GenericSyntaxNode): void => {
        if (
          n.type === "WhereClause" ||
          n.type === "DatasetClause" ||
          n.type === "SolutionModifier" ||
          n.type === "ValuesClause"
        ) {
          return;
        }
        if (n.type === "VAR" || n.type === "Iri") {
          describeTargets.push(lowerTerm(n));
          return;
        }
        for (const c of getChildren(n)) collectTargets(c);
      };
      collectTargets(queryNode);
    }
    return {
      queryType: "DESCRIBE",
      base,
      prefixes,
      star,
      describeTargets,
      where,
      modifier,
      trailingValues,
      hasServiceClause,
    };
  }

  return {
    queryType: "ASK",
    base,
    prefixes,
    where,
    modifier,
    trailingValues,
    hasServiceClause,
  };
}
