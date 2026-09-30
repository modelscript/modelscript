# STEP CAD (ISO 10303) Support

ModelScript supports ISO 10303 Product Data Representation and Exchange (**STEP**) under `languages/step/`.

---

## Supported Protocols & Schemas

- **AP203**: Configuration Controlled 3D Designs of Mechanical Parts and Assemblies.
- **AP214**: Core Data for Automotive Mechanical Design Processes.
- **AP242**: Managed Model-Based 3D Engineering (incorporating semantic PMI/GD&T).

---

## Architectural Role: 3D CAD in the Digital Thread

Traditional physical simulation abstracts mechanical bodies into point masses or 1D rotational inertias. ModelScript connects real 3D CAD geometry directly into physical simulations and verification loops:

1. **Mass Properties Extraction**: Automatically computes volume, center of mass, and the full $3 \times 3$ moment of inertia tensor ($J_{xx}, J_{yy}, J_{zz}, J_{xy}, J_{xz}, J_{yz}$) directly from STEP solids.
2. **Clearance & Enclosure Checking**: Feeds watertight solid boundaries to the `SpatialPhysicsOracle` to guarantee that components do not collide under thermal expansion or structural deflection.
3. **Dynamic Visual Binding**: Modelica simulation variables can be bound to STEP geometry via `DynamicSelect` annotations for 3D visualization.

---

## Ingesting STEP Models

```bash
# Ingest and verify mass properties of a mechanical chassis
npx msc csg evaluate chassis.step --mass-properties

# Render STEP assembly hierarchy and component trees
npx msc render chassis.step --format svg
```
