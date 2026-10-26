// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseEnergyPlus, parseEpJson, parseIdf } from "../src/parser/index.js";

const SAMPLE_IDF = `
!- EnergyPlus Model Input Deck
Building,
  TwoZoneOffice,           !- Name
  0.0,                     !- North Axis [deg]
  Suburbs,                 !- Terrain
  0.04,                    !- Loads Convergence Tolerance Value [W]
  0.4,                     !- Temperature Convergence Tolerance Value [deltaC]
  FullExterior,            !- Solar Distribution
  25,                      !- Maximum Number of Warmup Days
  6;                       !- Minimum Number of Warmup Days

Zone,
  ZoneNorth,               !- Name
  0.0,                     !- Direction of Relative North [deg]
  0.0, 0.0, 0.0,           !- Origin [X, Y, Z]
  1,                       !- Type
  1,                       !- Multiplier
  3.0,                     !- Ceiling Height [m]
  120.0;                   !- Volume [m3]

Zone,
  ZoneSouth,               !- Name
  0.0,                     !- Direction of Relative North [deg]
  0.0, 5.0, 0.0,           !- Origin [X, Y, Z]
  1,                       !- Type
  1,                       !- Multiplier
  3.0,                     !- Ceiling Height [m]
  150.0;                   !- Volume [m3]

Material,
  ConcreteWall,            !- Name
  MediumRough,             !- Roughness
  0.20,                    !- Thickness [m]
  1.75,                    !- Conductivity [W/m-K]
  2200.0,                  !- Density [kg/m3]
  900.0,                   !- Specific Heat [J/kg-K]
  0.90,                    !- Thermal Absorptance
  0.65,                    !- Solar Absorptance
  0.65;                    !- Visible Absorptance

Construction,
  ExtWallConst,            !- Name
  ConcreteWall;            !- Outside Layer

BuildingSurface:Detailed,
  WallNorthExt,            !- Name
  Wall,                    !- Surface Type
  ExtWallConst,            !- Construction Name
  ZoneNorth,               !- Zone Name
  Outdoors,                !- Outside Boundary Condition
  ,                        !- Outside Boundary Condition Object
  SunExposed,              !- Sun Exposure
  WindExposed,             !- Wind Exposure
  0.5,                     !- View Factor to Ground
  4,                       !- Number of Vertices
  0.0, 5.0, 3.0,           !- Vertex 1 [X, Y, Z]
  0.0, 5.0, 0.0,           !- Vertex 2 [X, Y, Z]
  5.0, 5.0, 0.0,           !- Vertex 3 [X, Y, Z]
  5.0, 5.0, 3.0;           !- Vertex 4 [X, Y, Z]

People,
  NorthZonePeople,         !- Name
  ZoneNorth,               !- Zone Name
  OccSchedule,             !- Number of People Schedule Name
  People,                  !- Number of People Calculation Method
  3,                       !- Number of People
  ,                        !- People per Floor Area
  0.3;                     !- Fraction Radiant

Lights,
  NorthZoneLights,         !- Name
  ZoneNorth,               !- Zone Name
  LightSchedule,           !- Schedule Name
  LightingLevel,           !- Calculation Method
  250.0,                   !- Design Level [W]
  ,                        !- Watts per Floor Area
  0.7;                     !- Fraction Radiant

ElectricEquipment,
  NorthZoneEquipment,      !- Name
  ZoneNorth,               !- Zone Name
  EquipSchedule,           !- Schedule Name
  EquipmentLevel,          !- Calculation Method
  400.0;                   !- Design Level [W]

ZoneInfiltration:DesignFlowRate,
  NorthInfiltration,       !- Name
  ZoneNorth,               !- Zone Name
  InfilSchedule,           !- Schedule Name
  Flow/Zone,               !- Flow Rate Calculation Method
  0.02;                    !- Design Volume Flow Rate [m3/s]

ZoneHVAC:IdealLoadsAirSystem,
  NorthZoneIdealHVAC,      !- Name
  ZoneNorth;               !- Zone Name
`;

const SAMPLE_EPJSON = JSON.stringify({
  Building: {
    SmallOffice: {
      north_axis: 15.0,
      terrain: "City",
    },
  },
  Zone: {
    OfficeZone: {
      volume: 200.0,
      floor_area: 60.0,
      ceiling_height: 3.2,
    },
  },
  Material: {
    Insulation: {
      roughness: "Smooth",
      thickness: 0.1,
      conductivity: 0.04,
      density: 30.0,
      specific_heat: 1200.0,
    },
  },
  Construction: {
    InsulatedWall: {
      outside_layer: "Insulation",
    },
  },
  "BuildingSurface:Detailed": {
    ExtWall1: {
      surface_type: "Wall",
      construction_name: "InsulatedWall",
      zone_name: "OfficeZone",
      outside_boundary_condition: "Outdoors",
      vertices: [
        { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 3.2 },
        { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
        { vertex_x_coordinate: 6, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
        { vertex_x_coordinate: 6, vertex_y_coordinate: 0, vertex_z_coordinate: 3.2 },
      ],
    },
  },
});

describe("EnergyPlus Zero-Regex Parser (.idf and .epJSON)", () => {
  it("parses classic IDF building models with full hierarchy", () => {
    const doc = parseIdf(SAMPLE_IDF, "office.idf");

    assert.strictEqual(doc.building?.name, "TwoZoneOffice");
    assert.strictEqual(doc.building?.terrain, "Suburbs");
    assert.strictEqual(doc.zones.length, 2);
    assert.strictEqual(doc.zones[0]?.name, "ZoneNorth");
    assert.strictEqual(doc.zones[1]?.name, "ZoneSouth");
    assert.strictEqual(doc.materials.length, 1);
    assert.strictEqual(doc.materials[0]?.name, "ConcreteWall");
    assert.strictEqual(doc.materials[0]?.conductivity, 1.75);
    assert.strictEqual(doc.constructions.length, 1);
    assert.strictEqual(doc.constructions[0]?.layers[0], "ConcreteWall");
    assert.strictEqual(doc.surfaces.length, 1);
    assert.strictEqual(doc.surfaces[0]?.name, "WallNorthExt");
    assert.strictEqual(doc.surfaces[0]?.vertices.length, 4);
    assert.strictEqual(doc.people.length, 1);
    assert.strictEqual(doc.people[0]?.numberOfPeople, 3);
    assert.strictEqual(doc.lights.length, 1);
    assert.strictEqual(doc.lights[0]?.lightingLevel, 250.0);
    assert.strictEqual(doc.electricEquipment.length, 1);
    assert.strictEqual(doc.electricEquipment[0]?.designLevel, 400.0);
    assert.strictEqual(doc.infiltrations.length, 1);
    assert.strictEqual(doc.infiltrations[0]?.designVolumeFlowRate, 0.02);
    assert.strictEqual(doc.zoneHvacs.length, 1);
    assert.strictEqual(doc.zoneHvacs[0]?.name, "NorthZoneIdealHVAC");
  });

  it("parses modern epJSON schema format", () => {
    const doc = parseEpJson(SAMPLE_EPJSON, "small_office.epJSON");

    assert.strictEqual(doc.building?.name, "SmallOffice");
    assert.strictEqual(doc.building?.northAxis, 15.0);
    assert.strictEqual(doc.zones.length, 1);
    assert.strictEqual(doc.zones[0]?.name, "OfficeZone");
    assert.strictEqual(doc.zones[0]?.volume, 200.0);
    assert.strictEqual(doc.materials.length, 1);
    assert.strictEqual(doc.materials[0]?.name, "Insulation");
    assert.strictEqual(doc.materials[0]?.conductivity, 0.04);
    assert.strictEqual(doc.constructions.length, 1);
    assert.strictEqual(doc.surfaces.length, 1);
    assert.strictEqual(doc.surfaces[0]?.name, "ExtWall1");
    assert.strictEqual(doc.surfaces[0]?.vertices.length, 4);
  });

  it("auto-detects between IDF and epJSON in parseEnergyPlus", () => {
    const docIdf = parseEnergyPlus(SAMPLE_IDF);
    assert.strictEqual(docIdf.zones.length, 2);

    const docJson = parseEnergyPlus(SAMPLE_EPJSON);
    assert.strictEqual(docJson.zones.length, 1);
  });
});
