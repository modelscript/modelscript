// name:     CGraphBug
// keywords: <insert keywords here>
// status:   correct

model Test

  model SubModel1
    Modelica.Mechanics.MultiBody.Interfaces.Frame_a frame_a;
    outer Modelica.Mechanics.MultiBody.World world;
  equation
    connect(world.frame_b, frame_a);
  end SubModel1;


    SubModel1 subModel1;
    Modelica.Mechanics.MultiBody.Parts.Body mass(
      animation=false,
      m=1,
      I_11=1,
      I_22=1,
      I_33=1,
      r_CM={0,0,0},
      r_0(start={0,0,0}));
    inner Modelica.Mechanics.MultiBody.World world(enableAnimation=false);
  equation
    connect(subModel1.frame_a, mass.frame_a);

  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Test;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: CGraphBug.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/connectors/CGraphBug.mo:8:5-8:60:writable] Error: Class Modelica.Mechanics.MultiBody.Interfaces.Frame_a not found in scope Test.SubModel1.
// Error: Error occurred while flattening model Test
//
// Execution failed!
// endResult
