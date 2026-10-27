// SPDX-License-Identifier: AGPL-3.0-or-later

import "@primer/octicons-react";
import "@primer/react";
import "react";

declare module "../../../../node_modules/@primer/octicons-react/dist/icons.js" {
  interface IconProps {
    style?: React.CSSProperties | undefined;
    title?: string | undefined;
    color?: string | undefined;
    onClick?: React.MouseEventHandler<SVGSVGElement> | undefined;
  }
}

declare module "../../../../node_modules/@primer/react/dist/Dialog/Dialog.js" {
  interface DialogProps {
    isOpen?: boolean | undefined;
    onDismiss?: (() => void) | undefined;
    onClose?: ((gesture: "close-button" | "escape") => void) | undefined;
    "aria-labelledby"?: string | undefined;
    "aria-label"?: string | undefined;
    sx?: Record<string, any> | undefined;
  }
}

declare module "@primer/octicons-react" {
  interface OcticonProps {
    style?: React.CSSProperties | undefined;
    title?: string | React.ReactElement<any> | undefined;
    color?: string | undefined;
  }
}

export interface PrimerSystemStyleProps {
  sx?: Record<string, any> | undefined;
  noWrap?: boolean | undefined;
  onDismiss?: (() => void) | undefined;
  p?: string | number | undefined;
  px?: string | number | undefined;
  py?: string | number | undefined;
  pt?: string | number | undefined;
  pb?: string | number | undefined;
  pl?: string | number | undefined;
  pr?: string | number | undefined;
  m?: string | number | undefined;
  mx?: string | number | undefined;
  my?: string | number | undefined;
  mt?: string | number | undefined;
  mb?: string | number | undefined;
  ml?: string | number | undefined;
  mr?: string | number | undefined;
  color?: string | undefined;
  bg?: string | undefined;
  background?: string | undefined;
  backgroundColor?: string | undefined;
  fontSize?: string | number | undefined;
  fontWeight?: string | number | undefined;
  fontFamily?: string | undefined;
  lineHeight?: string | number | undefined;
  letterSpacing?: string | number | undefined;
  textAlign?: string | undefined;
  fontStyle?: string | undefined;
  textTransform?: string | undefined;
  textDecoration?: string | undefined;
  display?: string | undefined;
  width?: string | number | undefined;
  height?: string | number | undefined;
  minWidth?: string | number | undefined;
  maxWidth?: string | number | undefined;
  minHeight?: string | number | undefined;
  maxHeight?: string | number | undefined;
  size?: any;
  border?: string | undefined;
  borderTop?: string | undefined;
  borderRight?: string | undefined;
  borderBottom?: string | undefined;
  borderLeft?: string | undefined;
  borderColor?: string | undefined;
  borderRadius?: string | number | undefined;
  borderWidth?: string | number | undefined;
  borderStyle?: string | undefined;
  boxShadow?: string | undefined;
  flex?: string | number | undefined;
  flexGrow?: number | undefined;
  flexShrink?: number | undefined;
  flexBasis?: string | number | undefined;
  flexDirection?: string | undefined;
  flexWrap?: string | undefined;
  alignItems?: string | undefined;
  alignSelf?: string | undefined;
  justifyContent?: string | undefined;
  justifySelf?: string | undefined;
  gap?: string | number | undefined;
  rowGap?: string | number | undefined;
  columnGap?: string | number | undefined;
  gridGap?: string | number | undefined;
  gridTemplateColumns?: string | undefined;
  gridTemplateRows?: string | undefined;
  gridColumn?: string | undefined;
  gridRow?: string | undefined;
  position?: string | undefined;
  top?: string | number | undefined;
  right?: string | number | undefined;
  bottom?: string | number | undefined;
  left?: string | number | undefined;
  zIndex?: number | undefined;
  overflow?: string | undefined;
  overflowX?: string | undefined;
  overflowY?: string | undefined;
  textOverflow?: string | undefined;
  whiteSpace?: string | undefined;
  wordBreak?: string | undefined;
  opacity?: number | undefined;
  cursor?: string | undefined;
  userSelect?: string | undefined;
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> extends PrimerSystemStyleProps {}

  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, any>;
    }
  }
}

declare module "@primer/react" {
  interface BoxProps extends PrimerSystemStyleProps {
    style?: React.CSSProperties | undefined;
    [key: string]: any;
  }
}

// Minimal WebGPU ambient declarations for browser environments without @webgpu/types
declare global {
  interface GPUBuffer {
    destroy(): void;
  }
  interface GPUDevice {
    createBuffer(descriptor: Record<string, any>): GPUBuffer;
    createBindGroup(descriptor: Record<string, any>): any;
    createShaderModule(descriptor: { code: string }): any;
    createRenderPipeline(descriptor: Record<string, any>): any;
    createCommandEncoder(): any;
    queue: {
      writeBuffer(
        buffer: GPUBuffer,
        bufferOffset: number,
        data: BufferSource,
        dataOffset?: number,
        size?: number,
      ): void;
      submit(commandBuffers: any[]): void;
    };
    destroy(): void;
  }
  interface GPUCanvasContext {
    configure(configuration: Record<string, any>): void;
    getCurrentTexture(): { createView(): any };
  }
  interface GPU {
    getPreferredCanvasFormat(): string;
    requestAdapter(options?: Record<string, any>): Promise<{ requestDevice(): Promise<GPUDevice> } | null>;
  }

  var GPUBufferUsage: {
    readonly MAP_READ: number;
    readonly MAP_WRITE: number;
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
    readonly INDEX: number;
    readonly VERTEX: number;
    readonly UNIFORM: number;
    readonly STORAGE: number;
    readonly INDIRECT: number;
    readonly QUERY_RESOLVE: number;
  };
  interface Navigator {
    gpu?: GPU | undefined;
  }
  interface HTMLCanvasElement {
    getContext(contextId: "webgpu"): GPUCanvasContext | null;
  }
}
