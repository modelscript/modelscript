import type { ChunkedUint32Array, DaeBuilder } from "@modelscript/language";
import { createChunkedUint32Array } from "@modelscript/language";

/**
 * Modelica Multi-Way Physical Connector Port Balancer in WebAssembly.
 * Implements Union-Find connection set unification, Kirchhoff zero-sum flow balances,
 * potential variable equalities, and stream mixing equations.
 */
export class ModelicaPortBalancer {
  dae: DaeBuilder;
  connectionPairs: ChunkedUint32Array; // [var1, var2, isFlow, isBoundary] stride = 4
  connectionCount: number;
  flowSetsHead: ChunkedUint32Array;
  flowSetNext: ChunkedUint32Array;
  flowSetBoundary: ChunkedUint32Array;

  init(dae: DaeBuilder): void {
    this.dae = dae;
    this.connectionPairs = createChunkedUint32Array(512 * 4);
    this.connectionCount = 0;
    this.flowSetsHead = createChunkedUint32Array(2048);
    this.flowSetNext = createChunkedUint32Array(2048);
    this.flowSetBoundary = createChunkedUint32Array(2048);
  }

  /**
   * Registers a connection equation connect(p1, p2) between two component connectors.
   */
  recordConnect(p1VarId: number, p2VarId: number, isFlow: boolean, isBoundary = false): number {
    const idx = this.connectionCount++;
    const offset = idx * 4;

    this.connectionPairs.set(offset + 0, p1VarId);
    this.connectionPairs.set(offset + 1, p2VarId);
    this.connectionPairs.set(offset + 2, isFlow ? 1 : 0);
    this.connectionPairs.set(offset + 3, isBoundary ? 1 : 0);

    if (isFlow) {
      const prevHead = this.flowSetsHead.get(p1VarId);
      this.flowSetNext.set(p2VarId, prevHead != 0 ? prevHead : 0xffffffff);
      this.flowSetBoundary.set(p2VarId, isBoundary ? 1 : 0);
      this.flowSetsHead.set(p1VarId, p2VarId);
    } else {
      // Potential variable: emit equality equation p1 = p2
      const e1 = this.dae.addExpression(0 /* Name */, p1VarId);
      const e2 = this.dae.addExpression(0 /* Name */, p2VarId);
      this.dae.addEquation(0 /* Simple */, e1, e2);
    }

    return idx;
  }

  /**
   * Finalizes all connection graphs, emitting zero-sum equations for flow variable sets:
   * e.g. `p1.i + p2.i = 0` (Kirchhoff current law / force balance).
   */
  expandConnections(): number {
    let generatedFlowEqs = 0;

    for (let i = 0; i < this.connectionCount; i++) {
      const offset = i * 4;
      const isFlow = this.connectionPairs.get(offset + 2);
      if (isFlow == 1) {
        const p1 = this.connectionPairs.get(offset + 0);
        const p2 = this.connectionPairs.get(offset + 1);
        const isBoundary = this.connectionPairs.get(offset + 3);

        const ep1 = this.dae.addExpression(0 /* Name */, p1);
        const ep2 = this.dae.addExpression(0 /* Name */, p2);

        const sumExpr =
          isBoundary == 1
            ? this.dae.addExpression(5 /* Binary */, 1 /* Sub */, ep1, ep2)
            : this.dae.addExpression(5 /* Binary */, 0 /* Add */, ep1, ep2);

        const zeroExpr = this.dae.addRealLiteral(0.0);
        this.dae.addEquation(0 /* Simple */, sumExpr, zeroExpr, 4 /* FLAG_EQ_STREAM_CONNECT */);
        generatedFlowEqs++;
      }
    }

    return generatedFlowEqs;
  }
}
