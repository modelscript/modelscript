// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WebGPUSimulationRunner } from "@modelscript/simulate";
import { Label, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Box from "../Box";

export interface ZeroCopyWebGPUViewerProps {
  // If runner is provided, run in main thread (for VS Code Webview fallback)
  runner?: WebGPUSimulationRunner | undefined;
  // If uri and className are provided, run via OffscreenCanvas in the LSP worker (for Morsel Web IDE)
  uri?: string | undefined;
  className?: string | undefined;
  width?: string | undefined;
  height?: string | undefined;
  // Static or recorded tensor field data for inspection when no live WebGPUSimulationRunner is attached
  initialFieldData?: Float32Array | number[] | undefined;
  viewConfig?:
    | {
        initialFieldData?: Float32Array | number[] | undefined;
        uri?: string | undefined;
        className?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
}

const CPU_FALLBACK_STATUS = "CPU Analytical Preview (No WebGPU Runner Attached)";

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

function renderCanvas2DFallback(canvas: HTMLCanvasElement, data: Float32Array): void {
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return;

  const w = canvas.width || 640;
  const h = canvas.height || 360;
  ctx2d.fillStyle = "#0d0d12";
  ctx2d.fillRect(0, 0, w, h);

  if (data.length === 0) return;

  ctx2d.strokeStyle = "#22d3ee";
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();

  const n = data.length;
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(n - 1, 1)) * w;
    const normY = Math.max(-1, Math.min(1, (data[i] ?? 0) * 0.1));
    const y = h * 0.5 - normY * (h * 0.42);
    if (i === 0) {
      ctx2d.moveTo(x, y);
    } else {
      ctx2d.lineTo(x, y);
    }
  }
  ctx2d.stroke();
}

export const ZeroCopyWebGPUViewer: React.FC<ZeroCopyWebGPUViewerProps> = ({
  runner,
  uri: propUri,
  className: propClassName,
  width = "100%",
  height = "400px",
  initialFieldData: propFieldData,
  viewConfig,
}) => {
  const uri = propUri ?? (typeof viewConfig?.uri === "string" ? viewConfig.uri : undefined);
  const className = propClassName ?? (typeof viewConfig?.className === "string" ? viewConfig.className : undefined);
  const rawFieldData = propFieldData ?? viewConfig?.initialFieldData;

  const staticTensor = useMemo<Float32Array | null>(() => {
    if (!rawFieldData) return null;
    if (rawFieldData instanceof Float32Array) {
      return rawFieldData.length > 0 ? rawFieldData : null;
    }
    if (Array.isArray(rawFieldData) && rawFieldData.length > 0) {
      return new Float32Array(rawFieldData.map((v) => Number(v) || 0));
    }
    return null;
  }, [rawFieldData]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasTransferredRef = useRef(false);
  const [status, setStatus] = useState<string>(() => (runner ? "Initializing..." : CPU_FALLBACK_STATUS));

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    let cancelled = false;
    let animationFrameId: number | null = null;
    let standaloneBuffer: GPUBuffer | null = null;
    let standaloneDevice: GPUDevice | null = null;

    if (runner) {
      // MAIN THREAD ZERO-COPY WEBGPU RUNNER
      setStatus("Zero-Copy GPU Render (WebGPUSimulationRunner Attached)");
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

      setStatus("Running via OffscreenCanvas (LSP Worker)");
      try {
        if (!canvas.transferControlToOffscreen) {
          setStatus(CPU_FALLBACK_STATUS);
          return;
        }
        const offscreen = canvas.transferControlToOffscreen();
        hasTransferredRef.current = true;
        window.dispatchEvent(
          new CustomEvent("START_ZERO_COPY_LSP", {
            detail: { canvas: offscreen, uri, className },
          }),
        );
      } catch (e: unknown) {
        setStatus("OffscreenCanvas initialization error: " + (e instanceof Error ? e.message : String(e)));
      }
    } else {
      // NO WEBGPU SIMULATION RUNNER ATTACHED: CPU ANALYTICAL PREVIEW OR RECORDED TENSOR FIELD
      setStatus(CPU_FALLBACK_STATUS);

      const initFallbackPreview = async () => {
        const numStates = staticTensor ? staticTensor.length : 256;
        const stateArray = new Float32Array(numStates);
        if (staticTensor) {
          stateArray.set(staticTensor);
        }

        if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
          if (staticTensor) {
            renderCanvas2DFallback(canvas, stateArray);
            return;
          }
          let t = 0;
          const renderCpu2D = () => {
            if (cancelled) return;
            t += 0.03;
            for (let i = 0; i < numStates; i++) {
              const x = (i / Math.max(numStates - 1, 1)) * Math.PI * 4;
              stateArray[i] = Math.sin(x - t) * Math.cos(x * 0.35 + t * 0.5) * 6.0;
            }
            renderCanvas2DFallback(canvas, stateArray);
            animationFrameId = requestAnimationFrame(renderCpu2D);
          };
          renderCpu2D();
          return;
        }

        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter || cancelled) {
            renderCanvas2DFallback(canvas, stateArray);
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
            renderCanvas2DFallback(canvas, stateArray);
            return;
          }
          const format = navigator.gpu.getPreferredCanvasFormat();
          context.configure({ device, format, alphaMode: "premultiplied" });

          const byteLength = Math.max(16, stateArray.byteLength);
          const gpuBuffer = device.createBuffer({
            size: byteLength,
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

          const drawFrame = () => {
            device.queue.writeBuffer(gpuBuffer, 0, stateArray.buffer, stateArray.byteOffset, stateArray.byteLength);
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
          };

          if (staticTensor) {
            drawFrame();
            return;
          }

          let t = 0;
          const render = () => {
            if (cancelled) return;
            t += 0.03;
            for (let i = 0; i < numStates; i++) {
              const x = (i / Math.max(numStates - 1, 1)) * Math.PI * 4;
              stateArray[i] = Math.sin(x - t) * Math.cos(x * 0.35 + t * 0.5) * 6.0;
            }
            drawFrame();
            animationFrameId = requestAnimationFrame(render);
          };
          render();
        } catch {
          renderCanvas2DFallback(canvas, stateArray);
        }
      };
      void initFallbackPreview();
    }

    return () => {
      cancelled = true;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      standaloneBuffer?.destroy();
      standaloneDevice?.destroy();
    };
  }, [runner, uri, className, staticTensor]);

  const isZeroCopyActive = Boolean(runner || uri);

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
        display="flex"
        flexDirection="column"
        gap={1}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <Text fontSize="12px" fontWeight="bold">
            {isZeroCopyActive ? "Zero-Copy GPU Render" : CPU_FALLBACK_STATUS}
          </Text>
          <Label variant={isZeroCopyActive ? "success" : "attention"}>
            {isZeroCopyActive
              ? "Zero-Copy GPU"
              : staticTensor
                ? `Recorded Tensor (${staticTensor.length} pts)`
                : "CPU Analytical Fallback"}
          </Label>
        </Box>
        <Text fontSize="10px" display="block" color="var(--color-fg-muted)">
          {status}
        </Text>
      </Box>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </Box>
  );
};

export default ZeroCopyWebGPUViewer;
