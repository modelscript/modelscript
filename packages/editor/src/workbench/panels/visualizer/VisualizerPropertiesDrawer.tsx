// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentPropertyData } from "@modelscript/diagram";
import { XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useRef, useState } from "react";
import type { DiagramDataProp, DiagramEditorHandle } from "../../Diagram";
import PropertiesWidget from "../../Properties";
import type { Translations } from "../../util/i18n";
import { IconPrimitiveInspector } from "../inspectors/IconPrimitiveInspector";
import { AnsatzView } from "../types";

export function extractNodeDuplicateInfo(
  node: object,
  fallbackClassName?: string,
): { className: string; x: number; y: number } | null {
  const rec: Record<string, unknown> = { ...node };
  const dataRec = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : undefined;
  const className =
    (typeof rec.type === "string" && rec.type) ||
    (typeof rec.className === "string" && rec.className) ||
    (typeof dataRec?.className === "string" && dataRec.className) ||
    fallbackClassName;
  if (!className) return null;
  const x = typeof rec.x === "number" ? rec.x : 100;
  const y = typeof rec.y === "number" ? rec.y : 100;
  return { className, x: x + 40, y: y + 40 };
}

export interface VisualizerPropertiesDrawerProps {
  selectedComponent: string;
  setSelectedComponent: (name: string | null) => void;
  handleSelectComponent: (name: string | null) => void;
  selectedComponentProperties: ComponentPropertyData | null;
  isPropertiesLoading: boolean;
  propertiesWidth: number;
  setPropertiesWidth: (width: number) => void;
  isFloatingLayout: boolean;
  isFullScreenSplitCanvas: boolean;
  view: AnsatzView;
  splitRatio: number;
  diagnosticsBottomOffset: number;
  diagramData: DiagramDataProp | null;
  translations: Translations;
  expectedComponentNameRef?: React.MutableRefObject<string | null>;
  effectiveDiagramRef: React.RefObject<DiagramEditorHandle | null>;
  enqueueDiagramAction: (action: Record<string, unknown>) => void;
  onNodeDoubleClick?: (name: string) => void;
}

export const VisualizerPropertiesDrawer: React.FC<VisualizerPropertiesDrawerProps> = ({
  selectedComponent,
  setSelectedComponent,
  handleSelectComponent,
  selectedComponentProperties,
  isPropertiesLoading,
  propertiesWidth,
  setPropertiesWidth,
  isFloatingLayout,
  isFullScreenSplitCanvas,
  view,
  splitRatio,
  diagnosticsBottomOffset,
  diagramData,
  translations,
  expectedComponentNameRef,
  effectiveDiagramRef,
  enqueueDiagramAction,
  onNodeDoubleClick,
}) => {
  const isDraggingProperties = useRef(false);
  const [isPropResizerHovered, setIsPropResizerHovered] = useState(false);
  const [isPropResizerDragging, setIsPropResizerDragging] = useState(false);

  const iconNode =
    selectedComponent.startsWith("__icon_gfx_") && Array.isArray(diagramData?.nodes)
      ? diagramData.nodes.find((n: { id?: string }) => n?.id === selectedComponent)
      : null;
  const iconPrimitivesCount = Array.isArray(diagramData?.nodes)
    ? diagramData.nodes.filter((n: { id?: string }) => String(n?.id ?? "").startsWith("__icon_gfx_")).length
    : 0;

  return (
    <div
      style={
        isFloatingLayout
          ? {
              position: "absolute",
              top: 72,
              right:
                isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                  ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                  : 12,
              bottom:
                isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                  ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                  : diagnosticsBottomOffset,
              zIndex: 26,
              display: "flex",
              flexDirection: "row",
              pointerEvents: "none",
            }
          : {
              display: "contents",
            }
      }
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={propertiesWidth}
        aria-valuemin={200}
        aria-valuemax={800}
        aria-label="Resize properties panel"
        tabIndex={0}
        style={{
          width: 10,
          marginLeft: -5,
          marginRight: -5,
          cursor: "col-resize",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          display: "flex",
          position: "relative",
          zIndex: 10,
          backgroundColor: "transparent",
          outline: "none",
          userSelect: "none",
          pointerEvents: "auto",
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setPropertiesWidth(Math.max(200, Math.min(800, propertiesWidth + 10)));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setPropertiesWidth(Math.max(200, Math.min(800, propertiesWidth - 10)));
          } else if (e.key === "Home") {
            e.preventDefault();
            setPropertiesWidth(800);
          } else if (e.key === "End") {
            e.preventDefault();
            setPropertiesWidth(200);
          }
        }}
        onDoubleClick={() => {
          setPropertiesWidth(300);
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          isDraggingProperties.current = true;
          setIsPropResizerDragging(true);
          const startX = e.clientX;
          const startWidth = propertiesWidth;
          const onMouseMove = (ev: MouseEvent) => {
            if (!isDraggingProperties.current) return;
            const deltaX = startX - ev.clientX;
            const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
            setPropertiesWidth(newWidth);
          };
          const onMouseUp = () => {
            isDraggingProperties.current = false;
            setIsPropResizerDragging(false);
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "auto";
            document.body.style.userSelect = "auto";
          };
          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (!touch) return;
          isDraggingProperties.current = true;
          setIsPropResizerDragging(true);
          const startX = touch.clientX;
          const startWidth = propertiesWidth;

          const onTouchMove = (ev: TouchEvent) => {
            if (!isDraggingProperties.current) return;
            const t = ev.touches[0];
            if (!t) return;
            const deltaX = startX - t.clientX;
            const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
            setPropertiesWidth(newWidth);
          };

          const onTouchEnd = () => {
            isDraggingProperties.current = false;
            setIsPropResizerDragging(false);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            document.body.style.userSelect = "auto";
          };

          document.addEventListener("touchmove", onTouchMove, { passive: true });
          document.addEventListener("touchend", onTouchEnd);
          document.body.style.userSelect = "none";
        }}
        onMouseEnter={() => setIsPropResizerHovered(true)}
        onMouseLeave={() => setIsPropResizerHovered(false)}
      >
        {/* Active highlight line centered on the border */}
        <div
          style={{
            width: 2,
            height: "100%",
            backgroundColor:
              isPropResizerHovered || isPropResizerDragging ? "var(--ms-text-3, #6b7280)" : "transparent",
            transition: "background-color 0.15s ease",
          }}
        />
        {/* Subtle grab pill in the vertical center */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            width: 4,
            height: 28,
            borderRadius: 999,
            backgroundColor:
              isPropResizerHovered || isPropResizerDragging ? "var(--ms-text-3, #6b7280)" : "transparent",
            boxShadow:
              isPropResizerHovered || isPropResizerDragging
                ? "0 0 6px color-mix(in srgb, var(--ms-text-3, #6b7280) 40%, transparent)"
                : "none",
            opacity: isPropResizerHovered || isPropResizerDragging ? 1 : 0,
            transition: "opacity 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
            pointerEvents: "none",
          }}
        />
      </div>
      <div style={{ pointerEvents: "auto", height: "100%", display: "flex" }}>
        {iconNode?.data?.primitive !== undefined ? (
          <div
            style={{
              width: propertiesWidth,
              height: "100%",
              overflowY: "auto",
              backgroundColor: isFloatingLayout
                ? "var(--ms-surface-glass, rgba(255, 255, 255, 0.9))"
                : "var(--ms-bg-elv, var(--color-canvas-subtle))",
              backdropFilter: isFloatingLayout ? "blur(14px)" : undefined,
              borderRadius: isFloatingLayout ? 12 : 0,
              border: isFloatingLayout ? "1px solid var(--ms-border, rgba(15, 23, 42, 0.12))" : undefined,
              borderLeft: isFloatingLayout ? undefined : "1px solid var(--ms-divider, rgba(15, 23, 42, 0.08))",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderBottom: "1px solid var(--ms-divider, rgba(15, 23, 42, 0.08))",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span>Icon Graphic</span>
              <IconButton
                icon={XIcon}
                size="small"
                variant="invisible"
                aria-label="Close inspector"
                onClick={() => handleSelectComponent(null)}
              />
            </div>
            <IconPrimitiveInspector
              primitiveIndex={Number(iconNode.data.primitiveIndex ?? 0)}
              totalPrimitives={iconPrimitivesCount}
              primitive={iconNode.data.primitive as Record<string, unknown>}
              onUpdate={(primitiveIdx, patch) => {
                enqueueDiagramAction({
                  type: "updateIconPrimitive",
                  index: primitiveIdx,
                  patch,
                });
              }}
              onDelete={(primitiveIdx) => {
                handleSelectComponent(null);
                enqueueDiagramAction({
                  type: "deleteIconPrimitive",
                  index: primitiveIdx,
                });
              }}
              onReorder={(fromIndex, toIndex) => {
                enqueueDiagramAction({
                  type: "reorderIconPrimitive",
                  fromIndex,
                  toIndex,
                });
              }}
            />
          </div>
        ) : (
          <PropertiesWidget
            properties={selectedComponentProperties}
            isLoading={isPropertiesLoading}
            width={propertiesWidth}
            floating={isFloatingLayout}
            translations={translations}
            onClose={() => handleSelectComponent(null)}
            onNameChange={async (newName) => {
              if (!selectedComponent) return;
              const oldName = selectedComponent;
              if (expectedComponentNameRef) expectedComponentNameRef.current = newName;
              setSelectedComponent(newName);
              enqueueDiagramAction({ type: "updateName", oldName, newName });
            }}
            onDescriptionChange={async (newDescription) => {
              if (!selectedComponent) return;
              enqueueDiagramAction({
                type: "updateDescription",
                name: selectedComponent,
                description: newDescription,
              });
            }}
            onParameterChange={async (name, value) => {
              if (!selectedComponent) return;
              let effectiveValue = value;
              const declaredType = (
                selectedComponentProperties as
                  | (ComponentPropertyData & {
                      declaredType?: {
                        elements?: Array<{
                          name?: string;
                          modification?: { expression?: { toJSON?: { toString(): string } } };
                        }>;
                      };
                    })
                  | null
              )?.declaredType;
              if (declaredType && Array.isArray(declaredType.elements)) {
                for (const el of declaredType.elements) {
                  if (el && el.name === name) {
                    const defaultExpr = el.modification?.expression?.toJSON?.toString();
                    if (defaultExpr !== undefined && defaultExpr === value) {
                      effectiveValue = "";
                    }
                    break;
                  }
                }
              }
              enqueueDiagramAction({
                type: "updateParameter",
                name: selectedComponent,
                parameter: name,
                value: effectiveValue,
              });
            }}
            onLocateComponent={(name) => {
              effectiveDiagramRef.current?.centerCell?.(name);
            }}
            onGoToSource={(name) => {
              onNodeDoubleClick?.(name);
            }}
            onDuplicateComponent={(name) => {
              const node = diagramData?.nodes?.find((n) => n.id === name);
              if (node) {
                const dup = extractNodeDuplicateInfo(node, selectedComponentProperties?.className);
                if (dup) {
                  enqueueDiagramAction({
                    type: "addComponent",
                    className: dup.className,
                    x: dup.x,
                    y: dup.y,
                  });
                }
              }
            }}
            onDeleteComponent={(name) => {
              enqueueDiagramAction({ type: "deleteComponents", names: [name] });
              handleSelectComponent(null);
            }}
          />
        )}
      </div>
    </div>
  );
};
