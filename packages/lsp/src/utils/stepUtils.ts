export function parseStepReferences(text: string) {
  const definitions = new Map<string, { startOffset: number; endOffset: number; text: string; type: string }>();
  const references: { id: string; startOffset: number; endOffset: number }[] = [];

  const defPattern = /#([0-9]+)\s*=\s*([A-Z][A-Z0-9_]*|\()/g;
  let match;
  while ((match = defPattern.exec(text)) !== null) {
    definitions.set(`#${match[1]}`, {
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      text: match[0],
      type: match[2] === "(" ? "COMPLEX_ENTITY" : match[2],
    });
  }

  let inString = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") {
      inString = !inString;
      continue;
    }
    if (!inString && text[i] === "#") {
      const start = i;
      i++;
      let idStr = "#";
      while (i < text.length && text[i] >= "0" && text[i] <= "9") {
        idStr += text[i];
        i++;
      }
      if (idStr.length > 1) {
        let j = i;
        while (j < text.length && (text[j] === " " || text[j] === "\t")) {
          j++;
        }
        if (text[j] !== "=") {
          references.push({
            id: idStr,
            startOffset: start,
            endOffset: i,
          });
        }
      }
      i--;
    }
  }

  return { definitions, references };
}

export const STEP_SCHEMA: Record<string, { description: string; parameters: { name: string; type: string }[] }> = {
  CARTESIAN_POINT: {
    description: "A point defined by its coordinates in a rectangular Cartesian coordinate system.",
    parameters: [
      { name: "name", type: "string" },
      { name: "coordinates", type: "number[]" },
    ],
  },
  DIRECTION: {
    description: "A direction in 2D or 3D space.",
    parameters: [
      { name: "name", type: "string" },
      { name: "direction_ratios", type: "number[]" },
    ],
  },
  VECTOR: {
    description: "A vector defined by a direction and a magnitude.",
    parameters: [
      { name: "name", type: "string" },
      { name: "orientation", type: "DIRECTION" },
      { name: "magnitude", type: "number" },
    ],
  },
  AXIS2_PLACEMENT_3D: {
    description: "A 3D placement defined by a location and two directions (axis and ref_direction).",
    parameters: [
      { name: "name", type: "string" },
      { name: "location", type: "CARTESIAN_POINT" },
      { name: "axis", type: "DIRECTION" },
      { name: "ref_direction", type: "DIRECTION" },
    ],
  },
  PRODUCT: {
    description: "A product is the identification of a part or an assembly.",
    parameters: [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "frame_of_reference", type: "MECHANICAL_CONTEXT" },
    ],
  },
  PRODUCT_DEFINITION: {
    description: "A product definition.",
    parameters: [
      { name: "id", type: "string" },
      { name: "description", type: "string" },
      { name: "formation", type: "PRODUCT_DEFINITION_FORMATION" },
      { name: "frame_of_reference", type: "PRODUCT_DEFINITION_CONTEXT" },
    ],
  },
  NEXT_ASSEMBLY_USAGE_OCCURRENCE: {
    description: "Defines a parent-child relationship in an assembly.",
    parameters: [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "relating_product_definition", type: "PRODUCT_DEFINITION" },
      { name: "related_product_definition", type: "PRODUCT_DEFINITION" },
      { name: "reference_designator", type: "string" },
    ],
  },
  ITEM_DEFINED_TRANSFORMATION: {
    description: "A transformation between two geometric contexts.",
    parameters: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "transform_item_1", type: "AXIS2_PLACEMENT_3D" },
      { name: "transform_item_2", type: "AXIS2_PLACEMENT_3D" },
    ],
  },
  MANIFOLD_SOLID_BREP: {
    description: "A solid model represented by its bounding surfaces.",
    parameters: [
      { name: "name", type: "string" },
      { name: "outer", type: "CLOSED_SHELL" },
    ],
  },
  LINE: {
    description: "A line defined by a point and a direction.",
    parameters: [
      { name: "name", type: "string" },
      { name: "pnt", type: "CARTESIAN_POINT" },
      { name: "dir", type: "VECTOR" },
    ],
  },
  CIRCLE: {
    description: "A circle defined by a placement and a radius.",
    parameters: [
      { name: "name", type: "string" },
      { name: "position", type: "AXIS2_PLACEMENT_3D" },
      { name: "radius", type: "number" },
    ],
  },
  VERTEX_POINT: {
    description: "A vertex defined by a point in space.",
    parameters: [
      { name: "name", type: "string" },
      { name: "vertex_geometry", type: "CARTESIAN_POINT" },
    ],
  },
  EDGE_CURVE: {
    description: "An edge defined by a curve and bounded by two vertices.",
    parameters: [
      { name: "name", type: "string" },
      { name: "edge_start", type: "VERTEX_POINT" },
      { name: "edge_end", type: "VERTEX_POINT" },
      { name: "edge_geometry", type: "CURVE" },
      { name: "same_sense", type: "boolean" },
    ],
  },
  ORIENTED_EDGE: {
    description:
      "An edge used in a loop with a specified orientation. Inherits edge_start/edge_end from EDGE (use * for derived).",
    parameters: [
      { name: "name", type: "string" },
      { name: "edge_start", type: "VERTEX_POINT | *" },
      { name: "edge_end", type: "VERTEX_POINT | *" },
      { name: "edge_element", type: "EDGE_CURVE" },
      { name: "orientation", type: "boolean" },
    ],
  },
  EDGE_LOOP: {
    description: "A loop defined by a list of oriented edges.",
    parameters: [
      { name: "name", type: "string" },
      { name: "edge_list", type: "ORIENTED_EDGE[]" },
    ],
  },
  FACE_BOUND: {
    description: "A boundary of a face, defined by a loop and an orientation.",
    parameters: [
      { name: "name", type: "string" },
      { name: "bound", type: "EDGE_LOOP" },
      { name: "orientation", type: "boolean" },
    ],
  },
  FACE_OUTER_BOUND: {
    description: "The outer boundary of a face.",
    parameters: [
      { name: "name", type: "string" },
      { name: "bound", type: "EDGE_LOOP" },
      { name: "orientation", type: "boolean" },
    ],
  },
  ADVANCED_FACE: {
    description: "A face with explicit geometry and bounds.",
    parameters: [
      { name: "name", type: "string" },
      { name: "bounds", type: "FACE_BOUND[]" },
      { name: "face_geometry", type: "SURFACE" },
      { name: "same_sense", type: "boolean" },
    ],
  },
  CLOSED_SHELL: {
    description: "A closed set of faces forming a watertight shell.",
    parameters: [
      { name: "name", type: "string" },
      { name: "cfs_faces", type: "ADVANCED_FACE[]" },
    ],
  },
  PLANE: {
    description: "An infinite plane defined by a placement.",
    parameters: [
      { name: "name", type: "string" },
      { name: "position", type: "AXIS2_PLACEMENT_3D" },
    ],
  },
  CYLINDRICAL_SURFACE: {
    description: "A cylindrical surface defined by a placement and a radius.",
    parameters: [
      { name: "name", type: "string" },
      { name: "position", type: "AXIS2_PLACEMENT_3D" },
      { name: "radius", type: "number" },
    ],
  },
  CONICAL_SURFACE: {
    description: "A conical surface defined by a placement, radius and semi-angle.",
    parameters: [
      { name: "name", type: "string" },
      { name: "position", type: "AXIS2_PLACEMENT_3D" },
      { name: "radius", type: "number" },
      { name: "semi_angle", type: "number" },
    ],
  },
  SPHERICAL_SURFACE: {
    description: "A spherical surface defined by a placement and a radius.",
    parameters: [
      { name: "name", type: "string" },
      { name: "position", type: "AXIS2_PLACEMENT_3D" },
      { name: "radius", type: "number" },
    ],
  },
  TOROIDAL_SURFACE: {
    description: "A toroidal surface defined by a placement and two radii.",
    parameters: [
      { name: "name", type: "string" },
      { name: "position", type: "AXIS2_PLACEMENT_3D" },
      { name: "major_radius", type: "number" },
      { name: "minor_radius", type: "number" },
    ],
  },
  B_SPLINE_CURVE_WITH_KNOTS: {
    description: "A B-spline curve defined by control points and knots.",
    parameters: [
      { name: "name", type: "string" },
      { name: "degree", type: "integer" },
      { name: "control_points_list", type: "CARTESIAN_POINT[]" },
      { name: "curve_form", type: "enum" },
      { name: "closed_curve", type: "boolean" },
      { name: "self_intersect", type: "boolean" },
      { name: "knot_multiplicities", type: "integer[]" },
      { name: "knots", type: "number[]" },
      { name: "knot_spec", type: "enum" },
    ],
  },
  SHAPE_REPRESENTATION: {
    description: "A representation of a shape as a collection of items.",
    parameters: [
      { name: "name", type: "string" },
      { name: "items", type: "REPRESENTATION_ITEM[]" },
      { name: "context_of_items", type: "REPRESENTATION_CONTEXT" },
    ],
  },
  ADVANCED_BREP_SHAPE_REPRESENTATION: {
    description: "An advanced B-rep shape representation.",
    parameters: [
      { name: "name", type: "string" },
      { name: "items", type: "REPRESENTATION_ITEM[]" },
      { name: "context_of_items", type: "REPRESENTATION_CONTEXT" },
    ],
  },
  SHAPE_DEFINITION_REPRESENTATION: {
    description: "Links a product definition shape to its representation.",
    parameters: [
      { name: "definition", type: "PRODUCT_DEFINITION_SHAPE" },
      { name: "used_representation", type: "SHAPE_REPRESENTATION" },
    ],
  },
  PRODUCT_DEFINITION_SHAPE: {
    description: "The shape of a product definition.",
    parameters: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "definition", type: "PRODUCT_DEFINITION" },
    ],
  },
  PRODUCT_DEFINITION_FORMATION: {
    description: "A particular version of a product.",
    parameters: [
      { name: "id", type: "string" },
      { name: "description", type: "string" },
      { name: "of_product", type: "PRODUCT" },
    ],
  },
  APPLICATION_CONTEXT: {
    description: "The context in which product data is used.",
    parameters: [{ name: "application", type: "string" }],
  },
  APPLICATION_PROTOCOL_DEFINITION: {
    description: "Identifies an application protocol and its version.",
    parameters: [
      { name: "status", type: "string" },
      { name: "application_interpreted_model_schema_name", type: "string" },
      { name: "application_protocol_year", type: "integer" },
      { name: "application", type: "APPLICATION_CONTEXT" },
    ],
  },
  PRODUCT_CONTEXT: {
    description: "The context for a product.",
    parameters: [
      { name: "name", type: "string" },
      { name: "frame_of_reference", type: "APPLICATION_CONTEXT" },
      { name: "discipline_type", type: "string" },
    ],
  },
  DESIGN_CONTEXT: {
    description: "Identifies the design stage of a product definition.",
    parameters: [
      { name: "name", type: "string" },
      { name: "frame_of_reference", type: "APPLICATION_CONTEXT" },
      { name: "life_cycle_stage", type: "string" },
    ],
  },
  PRODUCT_DEFINITION_CONTEXT: {
    description: "The context for a product definition.",
    parameters: [
      { name: "name", type: "string" },
      { name: "frame_of_reference", type: "APPLICATION_CONTEXT" },
      { name: "life_cycle_stage", type: "string" },
    ],
  },
  PRODUCT_RELATED_PRODUCT_CATEGORY: {
    description: "A category applied to a set of products.",
    parameters: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "products", type: "PRODUCT[]" },
    ],
  },
  SHAPE_REPRESENTATION_RELATIONSHIP: {
    description: "A relationship between two shape representations.",
    parameters: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "rep_1", type: "SHAPE_REPRESENTATION" },
      { name: "rep_2", type: "SHAPE_REPRESENTATION" },
    ],
  },
  UNCERTAINTY_MEASURE_WITH_UNIT: {
    description: "An uncertainty measure with an associated unit.",
    parameters: [
      { name: "value_component", type: "any" },
      { name: "unit_component", type: "any" },
      { name: "name", type: "string" },
      { name: "description", type: "string" },
    ],
  },
};
