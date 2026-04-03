import * as fs from "fs";
import { createRequire } from "module";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenCascadeInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TopoDS_Shape = any;

export interface CSGExecutionGraph {
  nodes: CSGNode[];
}

export interface CSGNode {
  type: string;
  uuid: string;
  parameters: Record<string, number>;
}

export class CSGWorker {
  private oc: OpenCascadeInstance;

  async init() {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("opencascade.js/dist/opencascade.wasm.js");
      const initWasm = mod.default || mod;

      const wasmPath = require.resolve("opencascade.js/dist/opencascade.wasm.wasm");
      const wasmBinary = fs.readFileSync(wasmPath);

      this.oc = await initWasm({
        wasmBinary: wasmBinary,
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) return wasmPath;
          return path;
        },
      });
    } catch (_e) {
      console.error(`[CSG] WASM failed to load: ${_e}`);
      throw _e;
    }
  }

  async processGraph(graph: CSGExecutionGraph, outputDir: string) {
    if (!this.oc) await this.init();

    console.log(`[CSG] Processing graph with ${graph.nodes.length} nodes...`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Caches intermediate TopoDS_Shape objects
    const shapeDictionary = new Map<string, TopoDS_Shape>();

    for (const node of graph.nodes) {
      if (node.type === "Stock") {
        // Evaluate input Stock primitive
        const { width, length, height } = node.parameters;

        // 1. Make Box geometry
        const makeBox = new this.oc.BRepPrimAPI_MakeBox_1(width, length, height);
        const solid = makeBox.Solid();

        // Cache the resulting intermediate shape
        shapeDictionary.set(node.uuid, solid);

        // Export to disk for visualization
        this.exportMesh(solid, path.join(outputDir, `${node.uuid}.stl`));
        makeBox.delete();
      }

      if (node.type === "MillingOperation") {
        console.log(`[CSG] Interpreting MillingOperation (UUID: ${node.uuid})...`);
        const { tool_diameter, depth_of_cut } = node.parameters; // feed_rate used in physics, not geometry

        // Find workpiece input geometry (simplified: assuming the latest node)
        // In reality, this would look up node.inputs[0] in shapeDictionary
        const workpieceShape = Array.from(shapeDictionary.values()).pop();
        if (!workpieceShape) continue;

        // 1. Tool Definition (Cylinder)
        // Assuming a simple end-mill dropping in Z
        const makeTool = new this.oc.BRepPrimAPI_MakeCylinder_1(tool_diameter / 2, depth_of_cut);
        const toolShape = makeTool.Solid();

        // 2. Boolean Cut
        const cutAlgo = new this.oc.BRepAlgoAPI_Cut_3(workpieceShape, toolShape);
        cutAlgo.Build();

        if (cutAlgo.IsDone()) {
          const cutShape = cutAlgo.Shape();
          shapeDictionary.set(node.uuid, cutShape);
          this.exportMesh(cutShape, path.join(outputDir, `${node.uuid}.stl`));
        }

        makeTool.delete();
        cutAlgo.delete();
      }
    }
    console.log(`[CSG] Graph processing complete. Meshes saved to ${outputDir}`);
  }

  private exportMesh(shape: TopoDS_Shape, filePath: string) {
    // Generates the rendering triangulation
    const incMesh = new this.oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
    incMesh.Perform();

    // Write out the mesh manually as an STL to bypass Emscripten FS bugs
    let stl = "solid csg_object\n";
    const explorer = new this.oc.TopExp_Explorer_2(
      shape,
      this.oc.TopAbs_ShapeEnum.TopAbs_FACE,
      this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (explorer.More()) {
      const face = this.oc.TopoDS.Face_1(explorer.Current());
      const location = new this.oc.TopLoc_Location_1();
      const hTriangulation = this.oc.BRep_Tool.Triangulation(face, location);

      if (!hTriangulation.IsNull()) {
        const tri = hTriangulation.get();
        const trsf = location.Transformation();

        const nbTriangles = tri.NbTriangles();
        for (let i = 1; i <= nbTriangles; i++) {
          const triangle = tri.Triangle(i);
          const i1 = triangle.Value(1);
          const i2 = triangle.Value(2);
          const i3 = triangle.Value(3);

          let p1 = tri.Node(i1);
          let p2 = tri.Node(i2);
          let p3 = tri.Node(i3);

          p1 = p1.Transformed(trsf);
          p2 = p2.Transformed(trsf);
          p3 = p3.Transformed(trsf);

          // Normal
          const ux = p2.X() - p1.X(),
            uy = p2.Y() - p1.Y(),
            uz = p2.Z() - p1.Z();
          const vx = p3.X() - p1.X(),
            vy = p3.Y() - p1.Y(),
            vz = p3.Z() - p1.Z();
          const nx = uy * vz - uz * vy;
          const ny = uz * vx - ux * vz;
          const nz = ux * vy - uy * vx;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

          stl += `  facet normal ${nx / len} ${ny / len} ${nz / len}\n`;
          stl += `    outer loop\n`;
          stl += `      vertex ${p1.X()} ${p1.Y()} ${p1.Z()}\n`;
          stl += `      vertex ${p2.X()} ${p2.Y()} ${p2.Z()}\n`;
          stl += `      vertex ${p3.X()} ${p3.Y()} ${p3.Z()}\n`;
          stl += `    endloop\n`;
          stl += `  endfacet\n`;

          p1.delete();
          p2.delete();
          p3.delete();
          triangle.delete();
        }
      }
      location.delete();
      face.delete();
      explorer.Next();
    }
    explorer.delete();
    stl += "endsolid csg_object\n";

    fs.writeFileSync(filePath, stl, "utf-8");
    incMesh.delete();
  }
}
