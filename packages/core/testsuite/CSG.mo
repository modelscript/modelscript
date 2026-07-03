package CSG
  "A dual-nature library for feature-based manufacturing and Constructive Solid Geometry"
  
  // --- Topological Connectors ---
  
  connector ProcessPort
    "Represents the geometric state of a workpiece at a specific point in time"
    String uuid; // Opaque handle for OCC geometric context routing
  end ProcessPort;

  // --- Primitives ---
  
  model Stock
    "A foundational block of material"
    parameter Real width "mm";
    parameter Real length "mm";
    parameter Real height "mm";
    parameter Real density = 2700 "kg/m3 for Aluminum";
    
    // Physics
    Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort;
    
    // Geometry
    ProcessPort shapeOut;
  end Stock;

  // --- Process Operations ---
  
  model MillingOperation
    "Swept volume milling calculation simulating power, torque, heat, and generating OCC instructions"
    parameter Real tool_diameter "mm";
    parameter Real depth_of_cut "mm";
    parameter Real feed_rate "mm/s";
    parameter Real path_length "mm" = 100 "Simplified path for demonstration";
    parameter Real specific_cutting_energy "J/mm3" = 0.8 "Typical for Aluminum";
    
    // Physical Connectors
    Modelica.Mechanics.Rotational.Interfaces.Flange_a spindle "Connect to CNC motor";
    Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b workpiece_heat "Heat dumped into workpiece";
    
    // Topo Connectors
    ProcessPort shapeIn;
    ProcessPort shapeOut;
    
  protected
    Real material_removal_rate "mm3/s";
    Real cutting_power "W";
    Real fraction_heat_to_workpiece = 0.4 "40% of heat goes into part, rest into chip/tool";
    
  equation
    // --- 1. Physics Simulation ---
    // Calculate the volumetric rate
    material_removal_rate = depth_of_cut * tool_diameter * feed_rate;
    
    // Power required to shear material
    cutting_power = material_removal_rate * specific_cutting_energy;
    
    // Torque feedback into the spindle
    // Power = Torque * Angular Velocity => Torque = Power / der(phi)
    // Avoid division by zero when starting
    if der(spindle.phi) > 1e-3 or der(spindle.phi) < -1e-3 then
      spindle.tau = cutting_power / der(spindle.phi);
    else
      spindle.tau = 0;
    end if;

    // Heat transfer into the workpiece
    workpiece_heat.Q_flow = cutting_power * fraction_heat_to_workpiece;

    // --- 2. Geometric Flow (Evaluated by Secondary Post-Pass) ---
    // Passes the geometric state through topically so the OCC execution graph can be built
    shapeOut.uuid = shapeIn.uuid;
    
  end MillingOperation;

  model TestProcess
    "Test graph to evaluate the extraction"
    Stock stock(width=100, length=200, height=50);
    MillingOperation mill(tool_diameter=10, depth_of_cut=20, feed_rate=100);
  equation
    connect(stock.shapeOut, mill.shapeIn);
  end TestProcess;

end CSG;
