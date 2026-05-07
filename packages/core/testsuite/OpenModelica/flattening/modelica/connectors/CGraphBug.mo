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
end Test;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: CGraphBug.mo
// Error: Failed to load package CGraphBug (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class CGraphBug not found in scope <top>.
// Error: Error occurred while flattening model CGraphBug
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
