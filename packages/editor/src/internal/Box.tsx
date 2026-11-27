// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export type BoxSxProp = Record<string, unknown>;

export interface BoxProps extends Omit<React.HTMLAttributes<HTMLElement>, "color"> {
  as?: React.ElementType | undefined;
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
  sx?: BoxSxProp | undefined;
  children?: React.ReactNode | undefined;
  style?: React.CSSProperties | undefined;
  className?: string | undefined;
}

const PRIMER_TOKEN_MAP: Record<string, string> = {
  "canvas.subtle": "var(--color-canvas-subtle)",
  "canvas.default": "var(--color-canvas-default)",
  "canvas.inset": "var(--color-canvas-inset)",
  "canvas.overlay": "var(--color-canvas-overlay)",
  "border.default": "var(--color-border-default)",
  "border.muted": "var(--color-border-muted)",
  "border.subtle": "var(--color-border-subtle)",
  "fg.default": "var(--color-fg-default)",
  "fg.muted": "var(--color-fg-muted)",
  "fg.subtle": "var(--color-fg-subtle)",
  "fg.onEmphasis": "var(--color-fg-on-emphasis)",
  "accent.fg": "var(--color-accent-fg)",
  "accent.emphasis": "var(--color-accent-emphasis)",
  "accent.muted": "var(--color-accent-muted)",
  "accent.subtle": "var(--color-accent-subtle)",
  "danger.fg": "var(--color-danger-fg)",
  "danger.emphasis": "var(--color-danger-emphasis)",
  "danger.muted": "var(--color-danger-muted)",
  "danger.subtle": "var(--color-danger-subtle)",
  "success.fg": "var(--color-success-fg)",
  "success.emphasis": "var(--color-success-emphasis)",
  "success.muted": "var(--color-success-muted)",
  "success.subtle": "var(--color-success-subtle)",
  "attention.fg": "var(--color-attention-fg)",
  "attention.emphasis": "var(--color-attention-emphasis)",
  "attention.muted": "var(--color-attention-muted)",
  "attention.subtle": "var(--color-attention-subtle)",
  "neutral.muted": "var(--color-neutral-muted)",
  "neutral.subtle": "var(--color-neutral-subtle)",
};

function resolveToken<T>(val: T): T | string {
  if (typeof val === "string" && val in PRIMER_TOKEN_MAP) {
    return PRIMER_TOKEN_MAP[val]!;
  }
  return val;
}

function resolveResponsive(val: string | string[] | undefined): string | undefined {
  if (val === undefined) return undefined;
  return Array.isArray(val) ? val[val.length - 1] : val;
}

function formatSpace(val: string | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  return typeof val === "number" ? `${val * 4}px` : val;
}

function formatPx(val: string | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  return typeof val === "number" ? `${val}px` : val;
}

function normalizeSx(sx: BoxSxProp): React.CSSProperties {
  if (!sx || typeof sx !== "object" || Array.isArray(sx)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(sx)) {
    if (val === undefined || val === null) continue;
    // Inline styles cannot represent nested CSS selector blocks (e.g. "&:hover")
    if (typeof val === "object" && !Array.isArray(val)) continue;
    const scalar = Array.isArray(val) ? val[val.length - 1] : val;
    switch (key) {
      case "bg":
        result.backgroundColor = resolveToken(scalar);
        break;
      case "p":
        result.padding = formatSpace(scalar as string | number);
        break;
      case "px":
        result.paddingLeft = formatSpace(scalar as string | number);
        result.paddingRight = formatSpace(scalar as string | number);
        break;
      case "py":
        result.paddingTop = formatSpace(scalar as string | number);
        result.paddingBottom = formatSpace(scalar as string | number);
        break;
      case "pt":
        result.paddingTop = formatSpace(scalar as string | number);
        break;
      case "pb":
        result.paddingBottom = formatSpace(scalar as string | number);
        break;
      case "pl":
        result.paddingLeft = formatSpace(scalar as string | number);
        break;
      case "pr":
        result.paddingRight = formatSpace(scalar as string | number);
        break;
      case "m":
        result.margin = formatSpace(scalar as string | number);
        break;
      case "mx":
        result.marginLeft = formatSpace(scalar as string | number);
        result.marginRight = formatSpace(scalar as string | number);
        break;
      case "my":
        result.marginTop = formatSpace(scalar as string | number);
        result.marginBottom = formatSpace(scalar as string | number);
        break;
      case "mt":
        result.marginTop = formatSpace(scalar as string | number);
        break;
      case "mb":
        result.marginBottom = formatSpace(scalar as string | number);
        break;
      case "ml":
        result.marginLeft = formatSpace(scalar as string | number);
        break;
      case "mr":
        result.marginRight = formatSpace(scalar as string | number);
        break;
      case "gap":
      case "rowGap":
      case "columnGap":
      case "gridGap":
        result[key] = formatSpace(scalar as string | number);
        break;
      case "width":
      case "height":
      case "minWidth":
      case "minHeight":
      case "maxWidth":
      case "maxHeight":
      case "fontSize":
      case "top":
      case "bottom":
      case "left":
      case "right":
      case "borderWidth":
        result[key] = typeof scalar === "number" ? `${scalar}px` : resolveToken(scalar);
        break;
      default:
        result[key] = resolveToken(scalar);
        break;
    }
  }
  return result as React.CSSProperties;
}

const Box = React.forwardRef<HTMLDivElement, BoxProps>(function Box(
  {
    as,
    display,
    flexDirection,
    alignItems,
    alignSelf,
    justifyContent,
    justifySelf,
    gap,
    rowGap,
    columnGap,
    gridGap,
    gridTemplateColumns,
    gridTemplateRows,
    gridColumn,
    gridRow,
    p,
    px,
    py,
    pt,
    pb,
    pl,
    pr,
    m,
    mx,
    my,
    mt,
    mb,
    ml,
    mr,
    width,
    height,
    minHeight,
    maxHeight,
    minWidth,
    maxWidth,
    backgroundColor,
    background,
    bg,
    border,
    borderWidth,
    borderStyle,
    borderColor,
    borderRadius,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    flexWrap,
    opacity,
    fontWeight,
    fontSize,
    fontFamily,
    lineHeight,
    letterSpacing,
    textAlign,
    color,
    position,
    top,
    bottom,
    left,
    right,
    zIndex,
    boxShadow,
    textOverflow,
    whiteSpace,
    overflow,
    overflowX,
    overflowY,
    cursor,
    userSelect,
    sx,
    style,
    className,
    children,
    ...rest
  },
  ref,
) {
  const Component: React.ElementType = as ?? "div";

  const computedStyle: React.CSSProperties = {};

  const resolvedDisplay = resolveResponsive(display);
  if (resolvedDisplay !== undefined) computedStyle.display = resolvedDisplay;
  if (textAlign !== undefined) computedStyle.textAlign = textAlign as React.CSSProperties["textAlign"];
  const resolvedFlexDirection = resolveResponsive(flexDirection);
  if (resolvedFlexDirection !== undefined) {
    computedStyle.flexDirection = resolvedFlexDirection as React.CSSProperties["flexDirection"];
  }
  const resolvedAlignItems = resolveResponsive(alignItems);
  if (resolvedAlignItems !== undefined) computedStyle.alignItems = resolvedAlignItems;
  if (alignSelf !== undefined) computedStyle.alignSelf = alignSelf;
  const resolvedJustifyContent = resolveResponsive(justifyContent);
  if (resolvedJustifyContent !== undefined) computedStyle.justifyContent = resolvedJustifyContent;
  if (justifySelf !== undefined) computedStyle.justifySelf = justifySelf;

  const resolvedGap = formatSpace(gap ?? gridGap);
  if (resolvedGap !== undefined) computedStyle.gap = resolvedGap;
  if (rowGap !== undefined) computedStyle.rowGap = formatSpace(rowGap);
  if (columnGap !== undefined) computedStyle.columnGap = formatSpace(columnGap);
  if (gridTemplateColumns !== undefined) computedStyle.gridTemplateColumns = gridTemplateColumns;
  if (gridTemplateRows !== undefined) computedStyle.gridTemplateRows = gridTemplateRows;
  if (gridColumn !== undefined) computedStyle.gridColumn = gridColumn;
  if (gridRow !== undefined) computedStyle.gridRow = gridRow;

  const hasLonghandPadding =
    pl !== undefined ||
    pr !== undefined ||
    pt !== undefined ||
    pb !== undefined ||
    px !== undefined ||
    py !== undefined;
  if (hasLonghandPadding) {
    const padLeft = formatSpace(pl ?? px ?? p);
    const padRight = formatSpace(pr ?? px ?? p);
    const padTop = formatSpace(pt ?? py ?? p);
    const padBottom = formatSpace(pb ?? py ?? p);
    if (padLeft !== undefined) computedStyle.paddingLeft = padLeft;
    if (padRight !== undefined) computedStyle.paddingRight = padRight;
    if (padTop !== undefined) computedStyle.paddingTop = padTop;
    if (padBottom !== undefined) computedStyle.paddingBottom = padBottom;
  } else if (p !== undefined) {
    computedStyle.padding = formatSpace(p);
  }

  const hasLonghandMargin =
    ml !== undefined ||
    mr !== undefined ||
    mt !== undefined ||
    mb !== undefined ||
    mx !== undefined ||
    my !== undefined;
  if (hasLonghandMargin) {
    const marLeft = formatSpace(ml ?? mx ?? m);
    const marRight = formatSpace(mr ?? mx ?? m);
    const marTop = formatSpace(mt ?? my ?? m);
    const marBottom = formatSpace(mb ?? my ?? m);
    if (marLeft !== undefined) computedStyle.marginLeft = marLeft;
    if (marRight !== undefined) computedStyle.marginRight = marRight;
    if (marTop !== undefined) computedStyle.marginTop = marTop;
    if (marBottom !== undefined) computedStyle.marginBottom = marBottom;
  } else if (m !== undefined) {
    computedStyle.margin = formatSpace(m);
  }

  if (width !== undefined) computedStyle.width = formatPx(width);
  if (height !== undefined) computedStyle.height = formatPx(height);
  if (minHeight !== undefined) computedStyle.minHeight = formatPx(minHeight);
  if (maxHeight !== undefined) computedStyle.maxHeight = formatPx(maxHeight);
  if (minWidth !== undefined) computedStyle.minWidth = formatPx(minWidth);
  if (maxWidth !== undefined) computedStyle.maxWidth = formatPx(maxWidth);

  const resolvedBg = resolveToken(bg || backgroundColor);
  if (resolvedBg !== undefined) computedStyle.backgroundColor = resolvedBg;
  if (background !== undefined) computedStyle.background = resolveToken(background);
  if (color !== undefined) computedStyle.color = resolveToken(color);

  if (border !== undefined) computedStyle.border = border;
  if (borderWidth !== undefined) computedStyle.borderWidth = formatPx(borderWidth);
  if (borderStyle !== undefined) computedStyle.borderStyle = borderStyle;
  if (borderColor !== undefined) computedStyle.borderColor = resolveToken(borderColor);
  if (borderTop !== undefined) computedStyle.borderTop = borderTop;
  if (borderBottom !== undefined) computedStyle.borderBottom = borderBottom;
  if (borderLeft !== undefined) computedStyle.borderLeft = borderLeft;
  if (borderRight !== undefined) computedStyle.borderRight = borderRight;
  if (borderRadius !== undefined) {
    computedStyle.borderRadius = typeof borderRadius === "number" ? `${borderRadius * 4}px` : borderRadius;
  }

  if (flex !== undefined) computedStyle.flex = flex;
  if (flexGrow !== undefined) computedStyle.flexGrow = flexGrow;
  if (flexShrink !== undefined) computedStyle.flexShrink = flexShrink;
  if (flexBasis !== undefined) computedStyle.flexBasis = formatPx(flexBasis);
  if (flexWrap !== undefined) computedStyle.flexWrap = flexWrap as React.CSSProperties["flexWrap"];
  if (opacity !== undefined) computedStyle.opacity = opacity;
  if (fontWeight !== undefined) computedStyle.fontWeight = fontWeight;
  if (fontSize !== undefined) computedStyle.fontSize = formatPx(fontSize);
  if (fontFamily !== undefined) computedStyle.fontFamily = fontFamily;
  if (lineHeight !== undefined) computedStyle.lineHeight = lineHeight;
  if (letterSpacing !== undefined) computedStyle.letterSpacing = formatPx(letterSpacing);
  if (position !== undefined) computedStyle.position = position as React.CSSProperties["position"];
  if (top !== undefined) computedStyle.top = formatPx(top);
  if (bottom !== undefined) computedStyle.bottom = formatPx(bottom);
  if (left !== undefined) computedStyle.left = formatPx(left);
  if (right !== undefined) computedStyle.right = formatPx(right);
  if (zIndex !== undefined) computedStyle.zIndex = zIndex;
  if (boxShadow !== undefined) computedStyle.boxShadow = boxShadow;
  if (textOverflow !== undefined) computedStyle.textOverflow = textOverflow;
  if (whiteSpace !== undefined) computedStyle.whiteSpace = whiteSpace as React.CSSProperties["whiteSpace"];
  if (overflow !== undefined) computedStyle.overflow = overflow;
  if (overflowX !== undefined) computedStyle.overflowX = overflowX as React.CSSProperties["overflowX"];
  if (overflowY !== undefined) computedStyle.overflowY = overflowY as React.CSSProperties["overflowY"];
  if (cursor !== undefined) computedStyle.cursor = cursor;
  if (userSelect !== undefined) computedStyle.userSelect = userSelect as React.CSSProperties["userSelect"];

  const sxStyle = sx ? normalizeSx(sx) : undefined;
  const mergedStyle =
    sxStyle || style
      ? { ...computedStyle, ...sxStyle, ...style }
      : Object.keys(computedStyle).length > 0
        ? computedStyle
        : undefined;

  return (
    <Component ref={ref} className={className} style={mergedStyle} {...rest}>
      {children}
    </Component>
  );
});

export default Box;
