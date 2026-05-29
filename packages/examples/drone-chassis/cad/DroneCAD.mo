package DroneCAD "Procedural CAD model of a quadcopter drone chassis"

  import Geometry.*;

  // ─── Reusable sub-assemblies ──────────────────────────────────────────

  shape MotorMount "Cylindrical motor mount with propeller guard ring"
    parameter Real radius = 1.5 "Motor housing radius [mm]";
    parameter Real height = 2 "Motor housing height [mm]";

    replaceable Cylinder housing(radius = radius, height = height)
      annotation(material = Aluminum);

    Torus guard(major = radius * 2, minor = 0.1)
      annotation(Placement(origin = {0, height, 0}));
  end MotorMount;

  shape DroneArm "Single arm extending from the body to a motor"
    parameter Real length = 12 "Arm length [mm]";
    parameter Real thickness = 1 "Arm thickness [mm]";
    parameter Real width = 1.5 "Arm width [mm]";
    parameter Real motorRadius = 1.5 "Motor mount radius [mm]";

    Box beam(width = length, height = thickness, depth = width)
      annotation(material = CarbonFiber);

    replaceable MotorMount motor(radius = motorRadius)
      constrainedby MotorMount
      annotation(Placement(origin = {length/2, thickness/2 + 0.5, 0}));
  end DroneArm;

  shape LandingGear "Two-skid landing gear with vertical struts"
    parameter Real span = 8 "Distance between skids [mm]";
    parameter Real skidLength = 10 "Skid bar length [mm]";
    parameter Real strutHeight = 4 "Strut height from body to skid [mm]";

    // Horizontal skid bars
    Box skidL(width = 0.5, height = 0.3, depth = skidLength)
      annotation(
        Placement(origin = {-span/2, -strutHeight, 0}),
        material = Aluminum
      );
    Box skidR(width = 0.5, height = 0.3, depth = skidLength)
      annotation(
        Placement(origin = {span/2, -strutHeight, 0}),
        material = Aluminum
      );

    // Vertical struts
    Box strutLF(width = 0.3, height = strutHeight, depth = 0.3)
      annotation(Placement(origin = {-span/2, -strutHeight/2, skidLength/3}));
    Box strutLR(width = 0.3, height = strutHeight, depth = 0.3)
      annotation(Placement(origin = {-span/2, -strutHeight/2, -skidLength/3}));
    Box strutRF(width = 0.3, height = strutHeight, depth = 0.3)
      annotation(Placement(origin = {span/2, -strutHeight/2, skidLength/3}));
    Box strutRR(width = 0.3, height = strutHeight, depth = 0.3)
      annotation(Placement(origin = {span/2, -strutHeight/2, -skidLength/3}));
  end LandingGear;

  shape CameraAssembly "Front-mounted camera with gimbal bracket"
    parameter Real gimbalWidth = 2 "Gimbal bracket width [mm]";
    parameter Real lensSize = 1.5 "Camera lens diameter [mm]";

    Box mount(width = gimbalWidth, height = 0.8, depth = 3)
      annotation(material = ABS);

    Box lens(width = lensSize, height = lensSize, depth = 1)
      annotation(
        Placement(origin = {0, -0.4, 2}),
        material = ABS
      );
  end CameraAssembly;

  // ─── Main chassis assembly ────────────────────────────────────────────

  shape DroneChassis "Complete quadcopter drone chassis"
    parameter Real bodySize = 10 "Central body width/depth [mm]";
    parameter Real bodyHeight = 3 "Central body height [mm]";
    parameter Real armLength = 12 "Arm length [mm]";
    parameter Real armAngle = 45 "Diagonal angle from X axis [deg]";

    // ── Central body ──────────────────────────────────────────
    Box body(width = bodySize, height = bodyHeight, depth = bodySize)
      annotation(material = CarbonFiber);

    Box topCover(width = bodySize - 2, height = 0.6, depth = bodySize - 2)
      annotation(
        Placement(origin = {0, bodyHeight/2 + 0.3, 0}),
        material = CarbonFiber
      );

    Box electronicsBay(width = 6, height = 1, depth = 6)
      annotation(
        Placement(origin = {0, -bodyHeight/2 - 0.5, 0}),
        material = ABS
      );

    // ── Four diagonal arms ────────────────────────────────────
    DroneArm armFR(length = armLength)
      annotation(Placement(origin = {6, 0, 6}, rotation = {0, armAngle, 0}));

    DroneArm armFL(length = armLength)
      annotation(Placement(origin = {-6, 0, 6}, rotation = {0, -armAngle, 0}));

    DroneArm armRR(length = armLength)
      annotation(Placement(origin = {6, 0, -6}, rotation = {0, 180 - armAngle, 0}));

    DroneArm armRL(length = armLength)
      annotation(Placement(origin = {-6, 0, -6}, rotation = {0, -(180 - armAngle), 0}));

    // ── Landing gear ──────────────────────────────────────────
    LandingGear gear(span = bodySize - 2, strutHeight = 4);

    // ── Camera ────────────────────────────────────────────────
    CameraAssembly camera
      annotation(Placement(origin = {0, -1, bodySize/2 + 1.5}));

    // ── Battery ───────────────────────────────────────────────
    Box battery(width = 5, height = 1.2, depth = 8)
      annotation(
        Placement(origin = {0, -bodyHeight/2 - 1.5, 0}),
        material = LiPo
      );
  end DroneChassis;

  // ─── Parametric variants ──────────────────────────────────────────────

  shape CargoDrone "Heavy-lift drone with larger body and longer arms"
    extends DroneChassis(
      bodySize = 15,
      bodyHeight = 4,
      armLength = 18
    );
  end CargoDrone;

  shape RacingDrone "Lightweight racing drone with compact form"
    extends DroneChassis(
      bodySize = 8,
      bodyHeight = 2,
      armLength = 9,
      armAngle = 50
    );
  end RacingDrone;

  // Demonstration of redeclare — swap motor mounts for tapered cones
  shape TaperedMotorMount
    extends MotorMount(
      redeclare Cone housing(
        radiusBottom = radius * 1.2,
        radiusTop = radius * 0.8,
        height = 2.5
      )
    );
  end TaperedMotorMount;

  shape StealthDrone "Drone with tapered motor housings for aerodynamics"
    extends DroneChassis(
      bodySize = 9,
      armLength = 11,
      // Redeclare the motor mount type inside each arm
      redeclare DroneArm armFR(
        redeclare TaperedMotorMount motor
      ),
      redeclare DroneArm armFL(
        redeclare TaperedMotorMount motor
      ),
      redeclare DroneArm armRR(
        redeclare TaperedMotorMount motor
      ),
      redeclare DroneArm armRL(
        redeclare TaperedMotorMount motor
      )
    );
  end StealthDrone;

end DroneCAD;
