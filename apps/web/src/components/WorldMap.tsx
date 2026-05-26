import { scaleLinear } from "d3-scale";
import React, { useMemo } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import styled from "styled-components";
import Box from "./Box";

const MapContainer = styled(Box)`
  width: 100%;
  background-color: var(--color-canvas-subtle);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  position: relative;
`;

const Tooltip = styled.div<{ $show: boolean; $x: number; $y: number; $flipX: boolean; $flipY: boolean }>`
  position: absolute;
  top: ${(props) => props.$y}px;
  left: ${(props) => props.$x}px;
  /* Adjust transform based on flip state */
  transform: translate(
    ${(props) => (props.$flipX ? "-100%" : "-50%")},
    ${(props) => (props.$flipY ? "10px" : "calc(-100% - 10px)")}
  );
  pointer-events: none;
  opacity: ${(props) => (props.$show ? 1 : 0)};
  transition: opacity 0.2s;
  background-color: var(--color-bg-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
  font-size: 13px;
  color: var(--color-fg-default);
  white-space: nowrap;

  &::after {
    content: "";
    position: absolute;
    /* Move arrow to top if flipped Y, bottom if normal */
    ${(props) => (props.$flipY ? "top: -5px;" : "bottom: -5px;")}
    /* Adjust arrow X position based on flip X */
    ${(props) => (props.$flipX ? "right: 15px;" : "left: 50%;")}
    ${(props) => !props.$flipX && "transform: translateX(-50%);"}
    border-width: ${(props) => (props.$flipY ? "0 5px 5px" : "5px 5px 0")};
    border-style: solid;
    border-color: ${(props) =>
      props.$flipY
        ? "transparent transparent var(--color-bg-primary) transparent"
        : "var(--color-bg-primary) transparent transparent transparent"};
  }
`;

const geoUrl = "/features.json";

export interface LocationStat {
  country: string; // ISO 3166-1 alpha-2 or alpha-3
  views: number;
}

interface WorldMapProps {
  data: LocationStat[];
}

// Map GeoIP alpha-2 to TopoJSON numeric IDs (world-110m uses UN numeric codes for id)
const iso2ToId: Record<string, string> = {
  US: "840",
  CA: "124",
  GB: "826",
  DE: "276",
  FR: "250",
  IN: "356",
  CN: "156",
  JP: "392",
  AU: "036",
  BR: "076",
  RU: "643",
  ZA: "710",
  IT: "380",
  ES: "724",
  MX: "484",
  KR: "410",
  ID: "360",
  TR: "528",
  SA: "682",
  AR: "032",
  SE: "752",
  PL: "616",
  NL: "528",
  CH: "756",
  BE: "056",
};

const WorldMap: React.FC<WorldMapProps> = ({ data }) => {
  const [tooltipContent, setTooltipContent] = React.useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0, flipX: false, flipY: false });

  const colorScale = useMemo(() => {
    const maxViews = Math.max(...data.map((d) => d.views), 1);
    return scaleLinear<string>().domain([0, maxViews]).range(["#cfd9de", "#1d9bf0"]); // Adjust colors to match theme
  }, [data]);

  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((d) => {
      if (!d.country) return;
      const countryStr = String(d.country).toUpperCase();
      const key = iso2ToId[countryStr] || countryStr;
      map.set(key, (map.get(key) || 0) + d.views);
    });
    return map;
  }, [data]);

  const updateTooltipPosition = (e: React.MouseEvent) => {
    const container = e.currentTarget.closest("div")?.parentElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const flipX = x > rect.width - 120;
      const flipY = y < 50;
      setTooltipPos({ x, y, flipX, flipY });
    } else {
      setTooltipPos({ x: e.clientX, y: e.clientY, flipX: false, flipY: false });
    }
  };

  return (
    <MapContainer>
      <ComposableMap projection="geoMercator" projectionConfig={{ scale: 120, center: [0, 30] }} viewBox="0 0 800 450">
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              // Extract the numeric ID from the topojson feature
              const countryId = geo.id ? String(geo.id).padStart(3, "0") : geo.properties.ISO_A3 || geo.properties.name;
              const views = dataMap.get(countryId) || 0;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={views > 0 ? colorScale(views) : "#e6e6e6"}
                  stroke="var(--color-border-default)"
                  strokeWidth={0.5}
                  style={{
                    default: { outline: "none" },
                    hover: {
                      fill: views > 0 ? "var(--color-accent-emphasis)" : "#d4d4d4",
                      outline: "none",
                      cursor: "pointer",
                    },
                    pressed: { outline: "none" },
                  }}
                  onMouseEnter={(e) => {
                    const { name } = geo.properties;
                    setTooltipContent(`${name}: ${views} view${views !== 1 ? "s" : ""}`);
                    updateTooltipPosition(e);
                  }}
                  onMouseMove={(e) => {
                    updateTooltipPosition(e);
                  }}
                  onMouseLeave={() => {
                    setTooltipContent(null);
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
      <Tooltip
        $show={!!tooltipContent}
        $x={tooltipPos.x}
        $y={tooltipPos.y}
        $flipX={tooltipPos.flipX}
        $flipY={tooltipPos.flipY}
      >
        {tooltipContent}
      </Tooltip>
    </MapContainer>
  );
};

export default WorldMap;
