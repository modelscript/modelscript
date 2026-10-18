// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WebGPUSimulationRunner } from "@modelscript/simulate";
import { Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";

interface ZeroCopyWebGPUViewerProps {
  // If runner is provided, run in main thread (for VS Code Webview fallback)
  runner?: WebGPUSimulationRunner | undefined;
  // If uri and className are provided, run via OffscreenCanvas in the LSP worker (for Morsel Web IDE)
  uri?: string | undefined;
  className?: string | undefined;
  width?: string | undefined;
  height?: string | undefined;
}

const SHADER_CODE = `
@group(0) @binding(0) var<storage, read> sim_state: array<f32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var out: VertexOutput;
    
    let total_states = f32(arrayLength(&sim_state));
    let x = (f32(vertexIndex) / max(total_states - 1.0, 1.0)) * 2.0 - 1.0;
    let y = sim_state[vertexIndex] * 0.1;

    out.position = vec4<f32>(x, y, 0.0, 1.0);
    
    let r = clamp(y + 0.5, 0.0, 1.0);
    let b = clamp(0.5 - y, 0.0, 1.0);
    out.color = vec3<f32>(r, 0.5, b);
    
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
`;

export const ZeroCopyWebGPUViewer: React.FC<ZeroCopyWebGPUViewerProps> = ({
  runner,
  uri,
  className,
  width = "100%",
  height = "400px",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasTransferredRef = useRef(false);
  const [status, setStatus] = useState("Initializing...");

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    let cancelled = false;
    let animationFrameId: number | null = null;
    let standaloneBuffer: GPUBuffer | null = null;
    let standaloneDevice: GPUDevice | null = null;

    if (runner) {
      // MAIN THREAD FALLBACK (VS Code Webview)
      setTimeout(() => setStatus("Running on Main Thread (VS Code Fallback)"), 0);
      const initMainThread = async () => {
        if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
          setStatus("WebGPU is not supported on this browser or origin (requires secure context HTTPS).");
          return;
        }

        const context = canvas.getContext("webgpu");
        if (!context) {
          setStatus("WebGPU context not available.");
          return;
        }

        const device = runner.device;
        const format = navigator.gpu.getPreferredCanvasFormat();

        context.configure({ device, format, alphaMode: "premultiplied" });

        const shaderModule = device.createShaderModule({ code: SHADER_CODE });
        const pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module: shaderModule, entryPoint: "vs_main" },
          fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
          primitive: { topology: "line-strip" },
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: runner.stateBuffer } }],
        });

        const numVars = runner.buffers.varCount;
        let currentTime = 0;
        const dt = 0.001;

        const render = () => {
          if (cancelled) return;

          for (let i = 0; i < 10; i++) {
            runner.stepSimulation(dt, currentTime);
            currentTime += dt;
          }

          const commandEncoder = device.createCommandEncoder();
          const textureView = context.getCurrentTexture().createView();
          const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
              {
                view: textureView,
                clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });
          renderPass.setPipeline(pipeline);
          renderPass.setBindGroup(0, bindGroup);
          renderPass.draw(numVars, 1, 0, 0);
          renderPass.end();

          device.queue.submit([commandEncoder.finish()]);
          animationFrameId = requestAnimationFrame(render);
        };
        render();
      };
      void initMainThread();
    } else if (uri) {
      // OFFSCREEN CANVAS (LSP Web Worker via side-channel)
      if (hasTransferredRef.current) {
        setStatus("Running via OffscreenCanvas (LSP Worker)");
        return;
      }

      setTimeout(() => setStatus("Running via OffscreenCanvas (LSP Worker)"), 0);
      try {
        if (!canvas.transferControlToOffscreen) {
          setStatus("OffscreenCanvas is not supported in this browser.");
          return;
        }
        const offscreen = canvas.transferControlToOffscreen();
        hasTransferredRef.current = true;
        // Dispatch global event for lsp-worker.ts to catch and forward
        window.dispatchEvent(
          new CustomEvent("START_ZERO_COPY_LSP", {
            detail: { canvas: offscreen, uri, className },
          }),
        );
      } catch (e: unknown) {
        setTimeout(
          () => setStatus("OffscreenCanvas initialization error: " + (e instanceof Error ? e.message : String(e))),
          0,
        );
      }
    } else {
      // STANDALONE PROCEDURAL WEBGPU WAVE SIMULATION
      const initStandalone = async () => {
        if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
          setStatus("WebGPU is not supported on this browser or origin.");
          return;
        }
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter || cancelled) {
            setStatus("WebGPU adapter unavailable.");
            return;
          }
          const device = await adapter.requestDevice();
          if (cancelled) {
            device.destroy();
            return;
          }
          standaloneDevice = device;
          const context = canvas.getContext("webgpu");
          if (!context) {
            setStatus("WebGPU context not available.");
            return;
          }
          const format = navigator.gpu.getPreferredCanvasFormat();
          context.configure({ device, format, alphaMode: "premultiplied" });

          const numStates = 256;
          const stateArray = new Float32Array(numStates);
          const gpuBuffer = device.createBuffer({
            size: stateArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          standaloneBuffer = gpuBuffer;

          const shaderModule = device.createShaderModule({ code: SHADER_CODE });
          const pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: { module: shaderModule, entryPoint: "vs_main" },
            fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
            primitive: { topology: "line-strip" },
          });
          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: gpuBuffer } }],
          });

          setStatus(`Running WebGPU Solver (${className || "Standalone Harmonic Field"})`);
          let t = 0;
          const render = () => {
            if (cancelled) return;
            t += 0.03;
            for (let i = 0; i < numStates; i++) {
              const x = (i / (numStates - 1)) * Math.PI * 4;
              stateArray[i] = Math.sin(x - t) * Math.cos(x * 0.35 + t * 0.5) * 6.0;
            }
            device.queue.writeBuffer(gpuBuffer, 0, stateArray);

            const commandEncoder = device.createCommandEncoder();
            const textureView = context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
              colorAttachments: [
                {
                  view: textureView,
                  clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 },
                  loadOp: "clear",
                  storeOp: "store",
                },
              ],
            });
            renderPass.setPipeline(pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(numStates, 1, 0, 0);
            renderPass.end();

            device.queue.submit([commandEncoder.finish()]);
            animationFrameId = requestAnimationFrame(render);
          };
          render();
        } catch (err: unknown) {
          setStatus("WebGPU initialization error: " + (err instanceof Error ? err.message : String(err)));
        }
      };
      void initStandalone();
    }

    return () => {
      cancelled = true;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      standaloneBuffer?.destroy();
      standaloneDevice?.destroy();
    };
  }, [runner, uri, className]);

  return (
    <Box width={width} height={height} borderRadius="8px" overflow="hidden" position="relative">
      <Box
        position="absolute"
        top={16}
        left={16}
        bg="var(--color-canvas-overlay)"
        p={2}
        borderRadius="6px"
        boxShadow="var(--color-shadow-medium)"
      >
        <Text fontSize="12px" fontWeight="bold">
          Zero-Copy GPU Render
        </Text>
        <Text fontSize="10px" display="block" color="var(--color-fg-muted)">
          {status}
        </Text>
      </Box>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </Box>
  );
};

export default ZeroCopyWebGPUViewer;
