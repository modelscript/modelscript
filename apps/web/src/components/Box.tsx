// SPDX-License-Identifier: AGPL-3.0-or-later

import styled, { css } from "styled-components";

export interface BoxProps {
  display?: string | string[] | undefined;
  flexDirection?: string | string[] | undefined;
  alignItems?: string | string[] | undefined;
  alignSelf?: string | undefined;
  justifyContent?: string | string[] | undefined;
  justifySelf?: string | undefined;
  gap?: string | number | undefined;
  rowGap?: string | number | undefined;
  columnGap?: string | number | undefined;
  gridGap?: string | number | undefined;
  gridTemplateColumns?: string | undefined;
  gridTemplateRows?: string | undefined;
  gridColumn?: string | undefined;
  gridRow?: string | undefined;
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
  width?: string | number | undefined;
  height?: string | number | undefined;
  minHeight?: string | number | undefined;
  maxHeight?: string | number | undefined;
  minWidth?: string | number | undefined;
  maxWidth?: string | number | undefined;
  backgroundColor?: string | undefined;
  background?: string | undefined;
  bg?: string | undefined;
  border?: string | undefined;
  borderWidth?: string | number | undefined;
  borderStyle?: string | undefined;
  borderColor?: string | undefined;
  borderRadius?: string | number | undefined;
  borderTop?: string | undefined;
  borderBottom?: string | undefined;
  borderLeft?: string | undefined;
  borderRight?: string | undefined;
  flex?: string | number | undefined;
  flexGrow?: number | undefined;
  flexShrink?: number | undefined;
  flexBasis?: string | number | undefined;
  flexWrap?: string | undefined;
  opacity?: number | undefined;
  fontWeight?: string | number | undefined;
  fontSize?: string | number | undefined;
  fontFamily?: string | undefined;
  lineHeight?: string | number | undefined;
  letterSpacing?: string | number | undefined;
  textAlign?: string | undefined;
  color?: string | undefined;
  position?: string | undefined;
  top?: string | number | undefined;
  bottom?: string | number | undefined;
  left?: string | number | undefined;
  right?: string | number | undefined;
  zIndex?: number | undefined;
  boxShadow?: string | undefined;
  textOverflow?: string | undefined;
  whiteSpace?: string | undefined;
  overflow?: string | undefined;
  overflowX?: string | undefined;
  overflowY?: string | undefined;
  cursor?: string | undefined;
  userSelect?: string | undefined;
  sx?: any;
  children?: React.ReactNode | undefined;
  style?: React.CSSProperties | undefined;
  className?: string | undefined;
}

const styleProps = new Set([
  "display",
  "flexDirection",
  "alignItems",
  "alignSelf",
  "justifyContent",
  "justifySelf",
  "gap",
  "rowGap",
  "columnGap",
  "gridGap",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridColumn",
  "gridRow",
  "p",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
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
  "background",
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
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "flexWrap",
  "opacity",
  "fontWeight",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
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
  "overflow",
  "overflowX",
  "overflowY",
  "cursor",
  "userSelect",
  "sx",
]);

function formatSpace(val: string | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  return typeof val === "number" ? `${val * 4}px` : val;
}

function normalizeSx(sx: any): any {
  if (!sx || typeof sx !== "object" || Array.isArray(sx)) return sx;
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(sx)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = normalizeSx(val);
      continue;
    }
    switch (key) {
      case "bg":
        result.backgroundColor = val;
        break;
      case "p":
        result.padding = formatSpace(val as string | number);
        break;
      case "px":
        result.paddingLeft = formatSpace(val as string | number);
        result.paddingRight = formatSpace(val as string | number);
        break;
      case "py":
        result.paddingTop = formatSpace(val as string | number);
        result.paddingBottom = formatSpace(val as string | number);
        break;
      case "pt":
        result.paddingTop = formatSpace(val as string | number);
        break;
      case "pb":
        result.paddingBottom = formatSpace(val as string | number);
        break;
      case "pl":
        result.paddingLeft = formatSpace(val as string | number);
        break;
      case "pr":
        result.paddingRight = formatSpace(val as string | number);
        break;
      case "m":
        result.margin = formatSpace(val as string | number);
        break;
      case "mx":
        result.marginLeft = formatSpace(val as string | number);
        result.marginRight = formatSpace(val as string | number);
        break;
      case "my":
        result.marginTop = formatSpace(val as string | number);
        result.marginBottom = formatSpace(val as string | number);
        break;
      case "mt":
        result.marginTop = formatSpace(val as string | number);
        break;
      case "mb":
        result.marginBottom = formatSpace(val as string | number);
        break;
      case "ml":
        result.marginLeft = formatSpace(val as string | number);
        break;
      case "mr":
        result.marginRight = formatSpace(val as string | number);
        break;
      default:
        result[key] = val;
        break;
    }
  }
  return result;
}

const Box = styled.div.withConfig({
  shouldForwardProp: (prop) => !styleProps.has(prop),
})<BoxProps>`
  display: ${(props) => props.display};
  text-align: ${(props) => props.textAlign};
  flex-direction: ${(props) => props.flexDirection};
  align-items: ${(props) => props.alignItems};
  align-self: ${(props) => props.alignSelf};
  justify-content: ${(props) => props.justifyContent};
  justify-self: ${(props) => props.justifySelf};
  gap: ${(props) => formatSpace(props.gap ?? props.gridGap)};
  row-gap: ${(props) => formatSpace(props.rowGap)};
  column-gap: ${(props) => formatSpace(props.columnGap)};
  grid-gap: ${(props) => formatSpace(props.gridGap)};
  grid-template-columns: ${(props) => props.gridTemplateColumns};
  grid-template-rows: ${(props) => props.gridTemplateRows};
  grid-column: ${(props) => props.gridColumn};
  grid-row: ${(props) => props.gridRow};
  padding: ${(props) => formatSpace(props.p)};
  padding-left: ${(props) => formatSpace(props.pl ?? props.px ?? props.p)};
  padding-right: ${(props) => formatSpace(props.pr ?? props.px ?? props.p)};
  padding-top: ${(props) => formatSpace(props.pt ?? props.py ?? props.p)};
  padding-bottom: ${(props) => formatSpace(props.pb ?? props.py ?? props.p)};
  margin: ${(props) => formatSpace(props.m)};
  margin-left: ${(props) => formatSpace(props.ml ?? props.mx ?? props.m)};
  margin-right: ${(props) => formatSpace(props.mr ?? props.mx ?? props.m)};
  margin-top: ${(props) => formatSpace(props.mt ?? props.my ?? props.m)};
  margin-bottom: ${(props) => formatSpace(props.mb ?? props.my ?? props.m)};
  width: ${(props) => (typeof props.width === "number" ? `${props.width}px` : props.width)};
  height: ${(props) => (typeof props.height === "number" ? `${props.height}px` : props.height)};
  min-height: ${(props) => (typeof props.minHeight === "number" ? `${props.minHeight}px` : props.minHeight)};
  background-color: ${(props) => props.bg || props.backgroundColor};
  background: ${(props) => props.background};
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
  flex-grow: ${(props) => props.flexGrow};
  flex-shrink: ${(props) => props.flexShrink};
  flex-basis: ${(props) => (typeof props.flexBasis === "number" ? `${props.flexBasis}px` : props.flexBasis)};
  flex-wrap: ${(props) => props.flexWrap};
  opacity: ${(props) => props.opacity};
  font-weight: ${(props) => props.fontWeight};
  font-size: ${(props) => (typeof props.fontSize === "number" ? `${props.fontSize}px` : props.fontSize)};
  font-family: ${(props) => props.fontFamily};
  line-height: ${(props) => props.lineHeight};
  letter-spacing: ${(props) =>
    typeof props.letterSpacing === "number" ? `${props.letterSpacing}px` : props.letterSpacing};
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
  overflow: ${(props) => props.overflow};
  overflow-x: ${(props) => props.overflowX};
  overflow-y: ${(props) => props.overflowY};
  cursor: ${(props) => props.cursor};
  user-select: ${(props) => props.userSelect};
  ${(props) => (props.sx ? css(normalizeSx(props.sx)) : "")};
`;

export default Box;
