// SPDX-License-Identifier: AGPL-3.0-or-later

import { scaleLinear } from "d3-scale";
import React, { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import styled from "styled-components";
import Box from "./Box";

const MapContainer = styled(Box)`
  width: 100%;
  background-color: rgba(14, 20, 36, 0.65);
  backdrop-filter: blur(16px);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  position: relative;
  display: flex;
  flex-direction: column;
`;

const MapHeader = styled(Box)`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 8px;
  flex-wrap: wrap;
  gap: 8px;
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-fg-default);
`;

const PrivacyBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 999px;
  background-color: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan);
  border: 1px solid rgba(6, 182, 212, 0.3);
`;

const LegendContainer = styled(Box)`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 18px 8px;
  gap: 8px;
  font-size: 11px;
  color: var(--color-fg-muted);
`;

const LegendGradient = styled.div`
  width: 80px;
  height: 8px;
  border-radius: 4px;
  background: var(--gradient-cta);
  border: 1px solid rgba(255, 255, 255, 0.15);
`;

const BreakdownContainer = styled(Box)`
  padding: 12px 18px 16px;
  border-top: 1px solid var(--color-border);
  background-color: rgba(255, 255, 255, 0.02);
`;

const BreakdownTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-fg-muted);
  margin-bottom: 10px;
`;

const LocationRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
`;

const LocationName = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-fg-default);
  font-weight: 500;
`;

const RegionPill = styled.span`
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: var(--color-neutral-muted);
  color: var(--color-fg-muted);
  font-family: var(--fontStack-monospace, monospace);
`;

const LocationBarWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 140px;
`;

const ProgressBar = styled.div<{ $percent: number }>`
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background-color: var(--color-neutral-muted);
  overflow: hidden;

  &::after {
    content: "";
    display: block;
    height: 100%;
    width: ${(props) => props.$percent}%;
    background: linear-gradient(90deg, #3b82f6, #1d4ed8);
    border-radius: 3px;
  }
`;

const LocationViews = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-fg-default);
  min-width: 42px;
  text-align: right;
`;

const Tooltip = styled.div<{ $show: boolean; $x: number; $y: number; $flipX: boolean; $flipY: boolean }>`
  position: absolute;
  top: ${(props) => props.$y}px;
  left: ${(props) => props.$x}px;
  transform: translate(
    ${(props) => (props.$flipX ? "-100%" : "-50%")},
    ${(props) => (props.$flipY ? "10px" : "calc(-100% - 10px)")}
  );
  pointer-events: none;
  opacity: ${(props) => (props.$show ? 1 : 0)};
  transition: opacity 0.15s ease;
  background-color: rgba(14, 20, 36, 0.95);
  border: 1px solid var(--color-border-glass);
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 100;
  font-size: 13px;
  color: var(--color-text-primary);
  white-space: nowrap;

  &::after {
    content: "";
    position: absolute;
    ${(props) => (props.$flipY ? "top: -5px;" : "bottom: -5px;")}
    ${(props) => (props.$flipX ? "right: 15px;" : "left: 50%;")}
    ${(props) => !props.$flipX && "transform: translateX(-50%);"}
    border-width: ${(props) => (props.$flipY ? "0 5px 5px" : "5px 5px 0")};
    border-style: solid;
    border-color: ${(props) =>
      props.$flipY
        ? "transparent transparent rgba(14, 20, 36, 0.95) transparent"
        : "rgba(14, 20, 36, 0.95) transparent transparent transparent"};
  }
`;

const geoUrl = "/features.json";

export interface LocationStat {
  country: string; // ISO 3166-1 alpha-2 or alpha-3 or numeric
  views: number;
}

export interface RegionStat {
  country: string;
  region: string;
  views: number;
}

interface WorldMapProps {
  data: LocationStat[];
  regionData?: RegionStat[];
  totalViews?: number;
}

// Comprehensive ISO 3166-1 alpha-2 to UN M.49 3-digit numeric code map
const iso2ToNumeric: Record<string, string> = {
  AF: "004",
  AL: "008",
  DZ: "012",
  AS: "016",
  AD: "020",
  AO: "024",
  AI: "660",
  AQ: "010",
  AG: "028",
  AR: "032",
  AM: "051",
  AW: "533",
  AU: "036",
  AT: "040",
  AZ: "031",
  BS: "044",
  BH: "048",
  BD: "050",
  BB: "052",
  BY: "112",
  BE: "056",
  BZ: "084",
  BJ: "204",
  BM: "060",
  BT: "064",
  BO: "068",
  BA: "070",
  BW: "072",
  BR: "076",
  BN: "096",
  BG: "100",
  BF: "854",
  BI: "108",
  KH: "116",
  CM: "120",
  CA: "124",
  CV: "132",
  KY: "136",
  CF: "140",
  TD: "148",
  CL: "152",
  CN: "156",
  CO: "170",
  KM: "174",
  CG: "178",
  CD: "180",
  CR: "188",
  CI: "384",
  HR: "191",
  CU: "192",
  CY: "196",
  CZ: "203",
  DK: "208",
  DJ: "262",
  DM: "212",
  DO: "214",
  EC: "218",
  EG: "818",
  SV: "222",
  GQ: "226",
  ER: "232",
  EE: "233",
  ET: "231",
  FJ: "242",
  FI: "246",
  FR: "250",
  GA: "266",
  GM: "270",
  GE: "268",
  DE: "276",
  GH: "288",
  GR: "300",
  GL: "304",
  GD: "308",
  GT: "320",
  GN: "324",
  GW: "624",
  GY: "328",
  HT: "332",
  HN: "340",
  HK: "344",
  HU: "348",
  IS: "352",
  IN: "356",
  ID: "360",
  IR: "364",
  IQ: "368",
  IE: "372",
  IL: "376",
  IT: "380",
  JM: "388",
  JP: "392",
  JO: "400",
  KZ: "398",
  KE: "404",
  KP: "408",
  KR: "410",
  KW: "414",
  KG: "417",
  LA: "418",
  LV: "428",
  LB: "422",
  LS: "426",
  LR: "430",
  LY: "434",
  LI: "438",
  LT: "440",
  LU: "442",
  MO: "446",
  MK: "807",
  MG: "450",
  MW: "454",
  MY: "458",
  MV: "462",
  ML: "466",
  MT: "470",
  MR: "478",
  MU: "480",
  MX: "484",
  MD: "498",
  MC: "492",
  MN: "496",
  ME: "499",
  MA: "504",
  MZ: "508",
  MM: "104",
  NA: "516",
  NP: "524",
  NL: "528",
  NZ: "554",
  NI: "558",
  NE: "562",
  NG: "566",
  NO: "578",
  OM: "512",
  PK: "586",
  PA: "591",
  PG: "598",
  PY: "600",
  PE: "604",
  PH: "608",
  PL: "616",
  PT: "620",
  PR: "630",
  QA: "634",
  RO: "642",
  RU: "643",
  RW: "646",
  SA: "682",
  SN: "686",
  RS: "688",
  SG: "702",
  SK: "703",
  SI: "705",
  SO: "706",
  ZA: "710",
  ES: "724",
  LK: "144",
  SD: "729",
  SE: "752",
  CH: "756",
  SY: "760",
  TW: "158",
  TJ: "762",
  TZ: "834",
  TH: "764",
  TL: "626",
  TG: "768",
  TT: "780",
  TN: "788",
  TR: "792",
  TM: "795",
  UG: "800",
  UA: "804",
  AE: "784",
  GB: "826",
  US: "840",
  UY: "858",
  UZ: "860",
  VE: "862",
  VN: "704",
  YE: "887",
  ZM: "894",
  ZW: "716",
};

// Friendly country names
const countryNames: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  JP: "Japan",
  CN: "China",
  IN: "India",
  BR: "Brazil",
  AU: "Australia",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  SE: "Sweden",
  CH: "Switzerland",
  PL: "Poland",
  KR: "South Korea",
  MX: "Mexico",
  SA: "Saudi Arabia",
  TR: "Turkey",
  RU: "Russia",
  ZA: "South Africa",
  AE: "United Arab Emirates",
  SG: "Singapore",
  BE: "Belgium",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  AT: "Austria",
  IE: "Ireland",
  NZ: "New Zealand",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
};

const WorldMap: React.FC<WorldMapProps> = ({ data = [], regionData = [], totalViews }) => {
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0, flipX: false, flipY: false });

  const totalCalculatedViews = useMemo(() => {
    if (typeof totalViews === "number" && totalViews > 0) return totalViews;
    return data.reduce((acc, curr) => acc + (curr.views || 0), 0);
  }, [totalViews, data]);

  // Dynamic blue heat map scale
  const colorScale = useMemo(() => {
    const maxViews = Math.max(...data.map((d) => d.views), 1);
    return scaleLinear<string>()
      .domain([1, Math.max(2, maxViews * 0.25), Math.max(3, maxViews * 0.6), maxViews])
      .range(["#93c5fd", "#60a5fa", "#2563eb", "#0284c7"]);
  }, [data]);

  // Build Map of numeric IDs to views
  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((d) => {
      if (!d.country) return;
      const code = String(d.country).toUpperCase().trim();
      const numId = iso2ToNumeric[code] || code;
      map.set(numId, (map.get(numId) || 0) + d.views);
    });
    return map;
  }, [data]);

  // Aggregate regions by country
  const regionsByCountry = useMemo(() => {
    const map = new Map<string, string[]>();
    regionData.forEach((r) => {
      if (!r.country || !r.region) return;
      const c = r.country.toUpperCase();
      const existing = map.get(c) || [];
      if (!existing.includes(r.region)) {
        existing.push(r.region);
      }
      map.set(c, existing);
    });
    return map;
  }, [regionData]);

  const updateTooltipPosition = (e: React.MouseEvent) => {
    const container = e.currentTarget.closest("div")?.parentElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const flipX = x > rect.width - 140;
      const flipY = y < 50;
      setTooltipPos({ x, y, flipX, flipY });
    } else {
      setTooltipPos({ x: e.clientX, y: e.clientY, flipX: false, flipY: false });
    }
  };

  // Top countries sorted by views
  const topCountries = useMemo(() => {
    return [...data]
      .filter((d) => d.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
  }, [data]);

  return (
    <MapContainer>
      <MapHeader>
        <HeaderTitle>
          <span>Audience Heat Map</span>
          <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", fontWeight: "normal" }}>
            ({data.length} {data.length === 1 ? "country" : "countries"})
          </span>
        </HeaderTitle>
        <PrivacyBadge title="Privacy-Preserving Analytics">
          <span>🛡️</span>
          <span>Scrubbed Geo-Metrics</span>
        </PrivacyBadge>
      </MapHeader>

      <LegendContainer>
        <span>Low</span>
        <LegendGradient />
        <span>High</span>
      </LegendContainer>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 100, center: [0, 20] }}
        viewBox="0 0 800 420"
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const countryId = geo.id ? String(geo.id).padStart(3, "0") : geo.properties.ISO_A3 || geo.properties.name;
              const views = dataMap.get(countryId) || 0;
              const hasViews = views > 0;

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={hasViews ? colorScale(views) : "rgba(255, 255, 255, 0.05)"}
                  stroke="var(--color-border)"
                  strokeWidth={0.5}
                  style={{
                    default: {
                      outline: "none",
                      transition: "fill 0.2s ease",
                    },
                    hover: {
                      fill: hasViews ? "var(--color-accent-cyan)" : "rgba(255, 255, 255, 0.12)",
                      stroke: hasViews ? "var(--color-accent-cyan)" : "var(--color-border-strong)",
                      strokeWidth: 1,
                      outline: "none",
                      cursor: "pointer",
                    },
                    pressed: { outline: "none" },
                  }}
                  onMouseEnter={(e) => {
                    const countryName = geo.properties.name || "Unknown";
                    const pct = totalCalculatedViews > 0 ? Math.round((views / totalCalculatedViews) * 100) : 0;
                    setTooltipContent(
                      `${countryName}: ${views} view${views !== 1 ? "s" : ""}${hasViews ? ` (${pct}%)` : ""}`,
                    );
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

      {topCountries.length > 0 && (
        <BreakdownContainer>
          <BreakdownTitle>Top Viewer Locations</BreakdownTitle>
          {topCountries.map((c) => {
            const code = c.country.toUpperCase();
            const name = countryNames[code] || code;
            const pct =
              totalCalculatedViews > 0 ? Math.min(100, Math.round((c.views / totalCalculatedViews) * 100)) : 0;
            const regions = regionsByCountry.get(code) || [];

            return (
              <LocationRow key={c.country}>
                <LocationName>
                  <span>{name}</span>
                  {regions.length > 0 && (
                    <Box display="inline-flex" gap={1}>
                      {regions.slice(0, 3).map((r) => (
                        <RegionPill key={r}>{r}</RegionPill>
                      ))}
                      {regions.length > 3 && <RegionPill>+{regions.length - 3}</RegionPill>}
                    </Box>
                  )}
                </LocationName>

                <LocationBarWrapper>
                  <ProgressBar $percent={pct} />
                  <LocationViews>
                    {c.views}{" "}
                    <span style={{ fontSize: "11px", color: "var(--color-fg-muted)", fontWeight: "normal" }}>
                      ({pct}%)
                    </span>
                  </LocationViews>
                </LocationBarWrapper>
              </LocationRow>
            );
          })}
        </BreakdownContainer>
      )}

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
