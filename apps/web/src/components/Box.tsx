/* eslint-disable @typescript-eslint/no-explicit-any */
import styled from "styled-components";

export interface BoxProps {
  display?: "block" | "inline" | "inline-block" | "flex" | "inline-flex" | "grid" | "none";
  flexDirection?: "row" | "row-reverse" | "column" | "column-reverse";
  alignItems?: string;
  justifyContent?: string;
  gap?: string | number;
  p?: string | number;
  px?: string | number;
  py?: string | number;
  m?: string | number;
  mx?: string | number;
  my?: string | number;
  mt?: string | number;
  mb?: string | number;
  ml?: string | number;
  mr?: string | number;
  width?: string | number;
  height?: string | number;
  minHeight?: string | number;
  maxHeight?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  backgroundColor?: string;
  bg?: string;
  border?: string;
  borderWidth?: string | number;
  borderStyle?: string;
  borderColor?: string;
  borderRadius?: string | number;
  borderTop?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRight?: string;
  flex?: string | number;
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  opacity?: number;
  fontWeight?: string | number;
  fontSize?: string | number;
  textAlign?: "left" | "right" | "center" | "justify" | "initial" | "inherit";
  color?: string;
  position?: "static" | "relative" | "absolute" | "fixed" | "sticky";
  top?: string | number;
  bottom?: string | number;
  left?: string | number;
  right?: string | number;
  zIndex?: number;
  boxShadow?: string;
  textOverflow?: string;
  whiteSpace?: string;
  sx?: any;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

const styleProps = new Set([
  "display",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gap",
  "p",
  "px",
  "py",
  "m",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "width",
  "height",
  "minHeight",
  "maxHeight",
  "minWidth",
  "maxWidth",
  "backgroundColor",
  "bg",
  "border",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderRadius",
  "borderTop",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "flex",
  "flexWrap",
  "opacity",
  "fontWeight",
  "fontSize",
  "textAlign",
  "color",
  "position",
  "top",
  "bottom",
  "left",
  "right",
  "zIndex",
  "boxShadow",
  "textOverflow",
  "whiteSpace",
  "sx",
]);

const Box = styled.div.withConfig({
  shouldForwardProp: (prop) => !styleProps.has(prop),
})<BoxProps>`
  display: ${(props) => props.display};
  text-align: ${(props) => props.textAlign};
  flex-direction: ${(props) => props.flexDirection};
  align-items: ${(props) => props.alignItems};
  justify-content: ${(props) => props.justifyContent};
  gap: ${(props) => (typeof props.gap === "number" ? `${props.gap * 4}px` : props.gap)};
  padding: ${(props) => (typeof props.p === "number" ? `${props.p * 4}px` : props.p)};
  padding-left: ${(props) => (typeof props.px === "number" ? `${props.px * 4}px` : props.px || props.p)};
  padding-right: ${(props) => (typeof props.px === "number" ? `${props.px * 4}px` : props.px || props.p)};
  padding-top: ${(props) => (typeof props.py === "number" ? `${props.py * 4}px` : props.py || props.p)};
  padding-bottom: ${(props) => (typeof props.py === "number" ? `${props.py * 4}px` : props.py || props.p)};
  margin: ${(props) => (typeof props.m === "number" ? `${props.m * 4}px` : props.m)};
  margin-left: ${(props) =>
    typeof props.ml === "number"
      ? `${props.ml * 4}px`
      : props.ml !== undefined
        ? props.ml
        : typeof props.mx === "number"
          ? `${props.mx * 4}px`
          : props.mx || props.m};
  margin-right: ${(props) =>
    typeof props.mr === "number"
      ? `${props.mr * 4}px`
      : props.mr !== undefined
        ? props.mr
        : typeof props.mx === "number"
          ? `${props.mx * 4}px`
          : props.mx || props.m};
  margin-top: ${(props) =>
    typeof props.mt === "number"
      ? `${props.mt * 4}px`
      : props.mt !== undefined
        ? props.mt
        : typeof props.my === "number"
          ? `${props.my * 4}px`
          : props.my || props.m};
  margin-bottom: ${(props) =>
    typeof props.mb === "number"
      ? `${props.mb * 4}px`
      : props.mb !== undefined
        ? props.mb
        : typeof props.my === "number"
          ? `${props.my * 4}px`
          : props.my || props.m};
  width: ${(props) => (typeof props.width === "number" ? `${props.width}px` : props.width)};
  height: ${(props) => (typeof props.height === "number" ? `${props.height}px` : props.height)};
  min-height: ${(props) => (typeof props.minHeight === "number" ? `${props.minHeight}px` : props.minHeight)};
  background-color: ${(props) => props.bg || props.backgroundColor};
  color: ${(props) => props.color};
  border: ${(props) => props.border};
  border-width: ${(props) => (typeof props.borderWidth === "number" ? `${props.borderWidth}px` : props.borderWidth)};
  border-style: ${(props) => props.borderStyle};
  border-color: ${(props) => props.borderColor};
  border-top: ${(props) => props.borderTop};
  border-bottom: ${(props) => props.borderBottom};
  border-left: ${(props) => props.borderLeft};
  border-right: ${(props) => props.borderRight};
  border-radius: ${(props) =>
    typeof props.borderRadius === "number" ? `${props.borderRadius * 4}px` : props.borderRadius};
  flex: ${(props) => props.flex};
  flex-wrap: ${(props) => props.flexWrap};
  opacity: ${(props) => props.opacity};
  font-weight: ${(props) => props.fontWeight};
  font-size: ${(props) => (typeof props.fontSize === "number" ? `${props.fontSize}px` : props.fontSize)};
  position: ${(props) => props.position};
  top: ${(props) => (typeof props.top === "number" ? `${props.top}px` : props.top)};
  bottom: ${(props) => (typeof props.bottom === "number" ? `${props.bottom}px` : props.bottom)};
  left: ${(props) => (typeof props.left === "number" ? `${props.left}px` : props.left)};
  right: ${(props) => (typeof props.right === "number" ? `${props.right}px` : props.right)};
  z-index: ${(props) => props.zIndex};
  box-shadow: ${(props) => props.boxShadow};
  text-overflow: ${(props) => props.textOverflow};
  white-space: ${(props) => props.whiteSpace};
  min-width: ${(props) => (typeof props.minWidth === "number" ? `${props.minWidth}px` : props.minWidth)};
  max-width: ${(props) => (typeof props.maxWidth === "number" ? `${props.maxWidth}px` : props.maxWidth)};
  max-height: ${(props) => (typeof props.maxHeight === "number" ? `${props.maxHeight}px` : props.maxHeight)};
`;

export default Box;
