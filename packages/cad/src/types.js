// SPDX-License-Identifier: AGPL-3.0-or-later
// ── Solid tree node kinds ────────────────────────────────────────────────
/** Discriminant tag for nodes in the procedural CSG {@link Solid} tree. */
export var SolidKind;
(function (SolidKind) {
    SolidKind["Box"] = "box";
    SolidKind["Cylinder"] = "cylinder";
    SolidKind["Sphere"] = "sphere";
    SolidKind["Torus"] = "torus";
    SolidKind["Transform"] = "transform";
    SolidKind["Union"] = "union";
    SolidKind["Subtract"] = "subtract";
    SolidKind["Intersect"] = "intersect";
    SolidKind["TaggedPatch"] = "tagged_patch";
    SolidKind["Fillet"] = "fillet";
    SolidKind["Chamfer"] = "chamfer";
    SolidKind["Extrusion"] = "extrusion";
    SolidKind["Polyhedron"] = "polyhedron";
})(SolidKind || (SolidKind = {}));
//# sourceMappingURL=types.js.map