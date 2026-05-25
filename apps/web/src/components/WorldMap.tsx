import { scaleLinear } from "d3-scale";
import React, { useMemo } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import styled from "styled-components";
import Box from "./Box";

const MapContainer = styled(Box)`
  width: 100%;
  height: 300px;
  background-color: var(--color-canvas-subtle);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  position: relative;
`;

const Tooltip = styled.div<{ $show: boolean; $x: number; $y: number }>`
  position: absolute;
  top: ${(props) => props.$y}px;
  left: ${(props) => props.$x}px;
  transform: translate(-50%, -100%);
  margin-top: -10px;
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
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    border-width: 5px 5px 0;
    border-style: solid;
    border-color: var(--color-bg-primary) transparent transparent transparent;
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

// Map GeoIP alpha-2 to TopoJSON alpha-3 if necessary
// This is a minimal example; you can expand it or use a library if needed.
const iso2To3: Record<string, string> = {
  US: "USA",
  CA: "CAN",
  GB: "GBR",
  DE: "DEU",
  FR: "FRA",
  IN: "IND",
  CN: "CHN",
  JP: "JPN",
  AU: "AUS",
  BR: "BRA",
  // Add more mappings as needed
};

const WorldMap: React.FC<WorldMapProps> = ({ data }) => {
  const [tooltipContent, setTooltipContent] = React.useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });

  const colorScale = useMemo(() => {
    const maxViews = Math.max(...data.map((d) => d.views), 1);
    return scaleLinear<string>().domain([0, maxViews]).range(["#cfd9de", "#1d9bf0"]); // Adjust colors to match theme
  }, [data]);

  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((d) => {
      // Map alpha-2 to alpha-3 if it's 2 chars
      const key = d.country.length === 2 ? iso2To3[d.country] || d.country : d.country;
      map.set(key, (map.get(key) || 0) + d.views);
    });
    return map;
  }, [data]);

  return (
    <MapContainer>
      <ComposableMap projection="geoMercator" projectionConfig={{ scale: 100 }}>
        <ZoomableGroup center={[0, 20]} maxZoom={5}>
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                // geo.id is usually alpha-3 in world-atlas
                const countryId = geo.id || geo.properties.ISO_A3 || geo.properties.iso_a3;
                const views = dataMap.get(countryId) || 0;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={views > 0 ? colorScale(views) : "var(--color-canvas-default)"}
                    stroke="var(--color-border-default)"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover: { fill: "var(--color-accent-emphasis)", outline: "none", cursor: "pointer" },
                      pressed: { outline: "none" },
                    }}
                    onMouseEnter={(e) => {
                      const { name } = geo.properties;
                      setTooltipContent(`${name}: ${views} view${views !== 1 ? "s" : ""}`);
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseMove={(e) => {
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setTooltipContent(null);
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
      <Tooltip $show={!!tooltipContent} $x={tooltipPos.x} $y={tooltipPos.y}>
        {tooltipContent}
      </Tooltip>
    </MapContainer>
  );
};

export default WorldMap;
