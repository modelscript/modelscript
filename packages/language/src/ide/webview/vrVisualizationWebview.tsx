// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from "react";
import * as ReactDOM from "react-dom/client";
// @ts-expect-error No type definitions available for vtk.js
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
// @ts-expect-error No type definitions available for vtk.js
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
// @ts-expect-error No type definitions available for vtk.js
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
// @ts-expect-error No type definitions available for vtk.js
import vtkXMLImageDataReader from "@kitware/vtk.js/IO/XML/XMLImageDataReader";
// @ts-expect-error No type definitions available for vtk.js
import vtkImageMarchingCubes from "@kitware/vtk.js/Filters/General/ImageMarchingCubes";
// @ts-expect-error No type definitions available for vtk.js
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";

import mqtt from "mqtt";
import "./vrVisualizationWebview.css";

const App = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [time, setTime] = React.useState<number>(0);
  const [participant, setParticipant] = React.useState<string>("Waiting for data...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vtkContext = React.useRef<any>(null);
  const mqttClient = React.useRef<mqtt.MqttClient | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;

    // Initialize WebXR / VTK.js FullScreenRenderWindow
    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
      rootContainer: containerRef.current,
      background: [0.1, 0.1, 0.12],
    });

    const renderer = fullScreenRenderer.getRenderer();
    const renderWindow = fullScreenRenderer.getRenderWindow();

    // Setup the pipeline
    const reader = vtkXMLImageDataReader.newInstance();

    // Marching cubes to extract the isosurface of alpha.polymer (melt front)
    const marchingCubes = vtkImageMarchingCubes.newInstance({
      contourValue: 0.5,
      computeNormals: true,
    });
    marchingCubes.setInputConnection(reader.getOutputPort());

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(marchingCubes.getOutputPort());
    // Map coloring to Temperature field
    mapper.setScalarModeToUsePointFieldData();
    mapper.setColorByArrayName("T");

    const lookupTable = vtkColorTransferFunction.newInstance();
    // Cold plastic (blue) to Hot melt (red)
    lookupTable.addRGBPoint(300, 0.0, 0.0, 1.0);
    lookupTable.addRGBPoint(500, 1.0, 0.0, 0.0);
    mapper.setLookupTable(lookupTable);

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    actor.getProperty().setOpacity(0.85);

    renderer.addActor(actor);
    renderer.resetCamera();
    renderWindow.render();

    vtkContext.current = {
      fullScreenRenderer,
      renderer,
      renderWindow,
      reader,
    };

    // Initialize MQTT subscription
    const client = mqtt.connect("ws://localhost:1892"); // Use WebSocket port
    mqttClient.current = client;

    client.on("connect", () => {
      console.log("[VR Webview] Connected to MQTT broker.");
      client.subscribe("modelscript/site/+/area/+/line/+/cell/+/vtk"); // Wildcard for VTK topic
    });

    client.on("message", (topic, payload) => {
      // Topic structure: modelscript/site/default/area/default/line/session123/cell/cfd_provider/vtk
      const parts = topic.split("/");
      const participantId = parts[parts.length - 2];
      setParticipant(participantId);

      // The VTK payload might include the time as a prefix or we just display the latest
      // For this implementation, we will just parse the VTK payload.
      try {
        const textDecoder = new TextDecoder("utf-8");
        const xmlString = textDecoder.decode(payload);

        vtkContext.current.reader.parseAsText(xmlString);
        vtkContext.current.renderer.resetCamera();
        vtkContext.current.renderWindow.render();
      } catch (e) {
        console.error("[VR Webview] Failed to parse VTK data:", e);
      }
    });

    const handleMessage = (event: MessageEvent) => {
      // Fallback for vscode postMessage if needed
      const message = event.data;
      if (message.command === "vtkData") {
        setTime(message.time);
        setParticipant(message.participantId);

        try {
          const u8 = new Uint8Array(message.vtkData);
          const textDecoder = new TextDecoder("utf-8");
          const xmlString = textDecoder.decode(u8);

          vtkContext.current.reader.parseAsText(xmlString);
          vtkContext.current.renderer.resetCamera();
          vtkContext.current.renderWindow.render();
        } catch (e) {
          console.error("Failed to parse VTK data:", e);
        }
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      client.end();
      window.removeEventListener("message", handleMessage);
      fullScreenRenderer.delete();
      actor.delete();
      mapper.delete();
      marchingCubes.delete();
      reader.delete();
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "hidden", position: "absolute", zIndex: 1 }}
      />
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          zIndex: 10,
          background: "rgba(0,0,0,0.6)",
          padding: "10px",
          borderRadius: "4px",
          color: "#fff",
          fontFamily: "monospace",
        }}
      >
        <div>Participant: {participant}</div>
        <div>Time: {time.toFixed(4)} s</div>
        <div style={{ fontSize: "0.8em", color: "#aaa", marginTop: "4px" }}>
          Isosurface: alpha.polymer = 0.5
          <br />
          Color mapping: Temperature (T)
        </div>
      </div>
    </div>
  );
};

const rootEl = document.getElementById("container");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}
