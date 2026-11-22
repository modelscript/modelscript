// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Off-main-thread Web Worker runner for layered Sugiyama diagram layout.
 * Falls back transparently to synchronous main-thread execution in Node, SSR, or
 * strict-CSP webview environments where `blob:` workers are disallowed.
 */

export interface WorkerLayoutNodeInput {
  id: string;
  width: number;
  height: number;
}

export interface WorkerLayoutEdgeInput {
  source: string;
  target: string;
  sourcePortFrac?: number | undefined;
  targetPortFrac?: number | undefined;
}

export interface WorkerLayoutOptions {
  rankdir?: "LR" | "TB" | "RL" | "BT" | undefined;
  ranksep?: number | undefined;
  nodesep?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface WorkerLayoutResult {
  nodes: { id: string; x: number; y: number }[];
  usedWorker: boolean;
}

const WORKER_SCRIPT_SOURCE = `
self.onmessage = function(ev) {
  try {
    var payload = ev.data || {};
    var model = payload.model || { nodes: [], edges: [] };
    var options = payload.options || {};
    var rankdir = options.rankdir || "LR";
    var ranksep = Math.max(20, options.ranksep || 80);
    var nodesep = Math.max(16, options.nodesep || 60);
    var horizontal = rankdir === "LR" || rankdir === "RL";
    var reversed = rankdir === "RL" || rankdir === "BT";

    var nodeMap = new Map();
    var outAdj = new Map();
    var inAdj = new Map();
    for (var i = 0; i < model.nodes.length; i++) {
      var n = model.nodes[i];
      nodeMap.set(n.id, n);
      outAdj.set(n.id, []);
      inAdj.set(n.id, []);
    }
    for (var j = 0; j < model.edges.length; j++) {
      var e = model.edges[j];
      if (e.source === e.target || !nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
      outAdj.get(e.source).push({ to: e.target, srcFrac: e.sourcePortFrac != null ? e.sourcePortFrac : 0.5, tgtFrac: e.targetPortFrac != null ? e.targetPortFrac : 0.5 });
      inAdj.get(e.target).push({ from: e.source, srcFrac: e.sourcePortFrac != null ? e.sourcePortFrac : 0.5, tgtFrac: e.targetPortFrac != null ? e.targetPortFrac : 0.5 });
    }

    var visitState = new Map();
    var acyclicOut = new Map();
    for (var i2 = 0; i2 < model.nodes.length; i2++) {
      var id2 = model.nodes[i2].id;
      visitState.set(id2, 0);
      acyclicOut.set(id2, []);
    }
    function dfs(u) {
      visitState.set(u, 1);
      var list = outAdj.get(u) || [];
      for (var k = 0; k < list.length; k++) {
        var v = list[k].to;
        var st = visitState.get(v) || 0;
        if (st === 0) {
          acyclicOut.get(u).push(v);
          dfs(v);
        } else if (st === 2) {
          acyclicOut.get(u).push(v);
        }
      }
      visitState.set(u, 2);
    }
    for (var i3 = 0; i3 < model.nodes.length; i3++) {
      var id3 = model.nodes[i3].id;
      if (visitState.get(id3) === 0) dfs(id3);
    }

    var inDeg = new Map();
    for (var i4 = 0; i4 < model.nodes.length; i4++) inDeg.set(model.nodes[i4].id, 0);
    acyclicOut.forEach(function(targets) {
      for (var k = 0; k < targets.length; k++) {
        inDeg.set(targets[k], (inDeg.get(targets[k]) || 0) + 1);
      }
    });

    var layerOf = new Map();
    var queue = [];
    for (var i5 = 0; i5 < model.nodes.length; i5++) {
      var id5 = model.nodes[i5].id;
      if ((inDeg.get(id5) || 0) === 0) {
        layerOf.set(id5, 0);
        queue.push(id5);
      }
    }
    var head = 0;
    while (head < queue.length) {
      var u = queue[head++];
      var lu = layerOf.get(u) || 0;
      var targets = acyclicOut.get(u) || [];
      for (var k2 = 0; k2 < targets.length; k2++) {
        var v2 = targets[k2];
        var nextL = Math.max(layerOf.get(v2) || 0, lu + 1);
        layerOf.set(v2, nextL);
        var d = (inDeg.get(v2) || 1) - 1;
        inDeg.set(v2, d);
        if (d === 0) queue.push(v2);
      }
    }
    for (var i6 = 0; i6 < model.nodes.length; i6++) {
      if (!layerOf.has(model.nodes[i6].id)) layerOf.set(model.nodes[i6].id, 0);
    }

    var maxLayer = 0;
    layerOf.forEach(function(l) { if (l > maxLayer) maxLayer = l; });
    var layers = [];
    for (var l = 0; l <= maxLayer; l++) layers.push([]);
    for (var i7 = 0; i7 < model.nodes.length; i7++) {
      var id7 = model.nodes[i7].id;
      layers[layerOf.get(id7) || 0].push(id7);
    }

    // Barycenter crossing minimization (4 sweeps)
    for (var pass = 0; pass < 4; pass++) {
      for (var lIdx = 1; lIdx <= maxLayer; lIdx++) {
        var prevOrder = new Map();
        for (var p = 0; p < layers[lIdx - 1].length; p++) prevOrder.set(layers[lIdx - 1][p], p);
        layers[lIdx].sort(function(a, b) {
          function bary(id) {
            var preds = inAdj.get(id) || [];
            var sum = 0, cnt = 0;
            for (var m = 0; m < preds.length; m++) {
              if (prevOrder.has(preds[m].from)) { sum += prevOrder.get(preds[m].from) + preds[m].srcFrac; cnt++; }
            }
            return cnt > 0 ? sum / cnt : 1e9;
          }
          return bary(a) - bary(b);
        });
      }
      for (var lIdx2 = maxLayer - 1; lIdx2 >= 0; lIdx2--) {
        var nextOrder = new Map();
        for (var p2 = 0; p2 < layers[lIdx2 + 1].length; p2++) nextOrder.set(layers[lIdx2 + 1][p2], p2);
        layers[lIdx2].sort(function(a, b) {
          function bary2(id) {
            var succs = outAdj.get(id) || [];
            var sum = 0, cnt = 0;
            for (var m = 0; m < succs.length; m++) {
              if (nextOrder.has(succs[m].to)) { sum += nextOrder.get(succs[m].to) + succs[m].tgtFrac; cnt++; }
            }
            return cnt > 0 ? sum / cnt : 1e9;
          }
          return bary2(a) - bary2(b);
        });
      }
    }

    var resultNodes = [];
    var primaryCursor = 0;
    for (var li = 0; li <= maxLayer; li++) {
      var layerIdx = reversed ? (maxLayer - li) : li;
      var ids = layers[layerIdx];
      var maxPrimary = 0;
      var secondaryCursor = 0;
      for (var ni = 0; ni < ids.length; ni++) {
        var nd = nodeMap.get(ids[ni]);
        var w = nd.width || 80;
        var h = nd.height || 60;
        var primaryDim = horizontal ? w : h;
        var secondaryDim = horizontal ? h : w;
        if (primaryDim > maxPrimary) maxPrimary = primaryDim;
        var cx = horizontal ? (primaryCursor + primaryDim / 2) : (secondaryCursor + secondaryDim / 2);
        var cy = horizontal ? (secondaryCursor + secondaryDim / 2) : (primaryCursor + primaryDim / 2);
        resultNodes.push({ id: nd.id, x: Math.round(cx), y: Math.round(cy) });
        secondaryCursor += secondaryDim + nodesep;
      }
      primaryCursor += maxPrimary + ranksep;
    }

    self.postMessage({ ok: true, nodes: resultNodes });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
`;

/**
 * Executes layered Sugiyama layout inside a disposable Web Worker when available,
 * falling back to `fallbackFn` synchronously when Workers or Blob URLs are unavailable
 * or blocked by CSP.
 */
export async function runLayeredLayoutInWorker(
  model: {
    nodes: WorkerLayoutNodeInput[];
    edges: WorkerLayoutEdgeInput[];
  },
  options: WorkerLayoutOptions,
  fallbackFn: () => { nodes: { id: string; x: number; y: number }[] },
): Promise<WorkerLayoutResult> {
  if (
    typeof Worker === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return { ...fallbackFn(), usedWorker: false };
  }

  let blobUrl: string | null = null;
  let worker: Worker | null = null;
  const timeoutMs = options.timeoutMs ?? 4000;

  try {
    const blob = new Blob([WORKER_SCRIPT_SOURCE], { type: "application/javascript" });
    blobUrl = URL.createObjectURL(blob);
    worker = new Worker(blobUrl);

    const nodes = await new Promise<{ id: string; x: number; y: number }[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Layout worker timed out"));
      }, timeoutMs);

      worker!.onmessage = (ev: MessageEvent) => {
        clearTimeout(timer);
        if (ev.data?.ok && Array.isArray(ev.data.nodes)) {
          resolve(ev.data.nodes);
        } else {
          reject(new Error(String(ev.data?.error ?? "Unknown layout worker error")));
        }
      };

      worker!.onerror = (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err?.message ?? "Worker error")));
      };

      worker!.postMessage({ model, options });
    });

    return { nodes, usedWorker: true };
  } catch {
    return { ...fallbackFn(), usedWorker: false };
  } finally {
    try {
      worker?.terminate();
    } catch {
      // ignore termination errors
    }
    if (blobUrl) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // ignore revoke errors
      }
    }
  }
}
