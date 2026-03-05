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
  flex?: string | number;
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  opacity?: number;
  fontWeight?: string | number;
  fontSize?: string | number;
  textAlign?: "left" | "right" | "center" | "justify" | "initial" | "inherit";
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

const Box = styled.div<BoxProps>`
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
  margin-left: ${(props) => (typeof props.mx === "number" ? `${props.mx * 4}px` : props.mx || props.m)};
  margin-right: ${(props) => (typeof props.mx === "number" ? `${props.mx * 4}px` : props.mx || props.m)};
  margin-top: ${(props) => (typeof props.my === "number" ? `${props.my * 4}px` : props.mt || props.my || props.m)};
  margin-bottom: ${(props) => (typeof props.my === "number" ? `${props.my * 4}px` : props.mb || props.my || props.m)};
  width: ${(props) => (typeof props.width === "number" ? `${props.width}px` : props.width)};
  height: ${(props) => (typeof props.height === "number" ? `${props.height}px` : props.height)};
  min-height: ${(props) => (typeof props.minHeight === "number" ? `${props.minHeight}px` : props.minHeight)};
  background-color: ${(props) => props.bg || props.backgroundColor};
  border: ${(props) => props.border};
  border-width: ${(props) => (typeof props.borderWidth === "number" ? `${props.borderWidth}px` : props.borderWidth)};
  border-style: ${(props) => props.borderStyle};
  border-color: ${(props) => props.borderColor};
  border-radius: ${(props) =>
    typeof props.borderRadius === "number" ? `${props.borderRadius * 4}px` : props.borderRadius};
  flex: ${(props) => props.flex};
  flex-wrap: ${(props) => props.flexWrap};
  opacity: ${(props) => props.opacity};
  font-weight: ${(props) => props.fontWeight};
  font-size: ${(props) => (typeof props.fontSize === "number" ? `${props.fontSize}px` : props.fontSize)};
`;

export default Box;
