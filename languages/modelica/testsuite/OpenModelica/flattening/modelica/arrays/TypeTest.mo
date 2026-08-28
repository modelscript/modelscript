within ;
model TypeTest
  import Modelica.Mechanics.MultiBody.Types;
  parameter Integer nPoints = 2;
  type Pos3D = Modelica.SIunits.Position[3];
  Pos3D points[nPoints];
  Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape visPoints[nPoints](r = points);
equation
  for i in 1:nPoints loop
    points[i,:] = {1,2,3};
  end for;
end TypeTest;

// Result:
// Error processing file: TypeTest.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Notification: Automatically loaded package Complex 4.1.0 due to uses annotation from Modelica.
// Notification: Automatically loaded package ModelicaServices 4.1.0 due to uses annotation from Modelica.
// Notification: Automatically loaded package Modelica 4.1.0 due to usage.
// [OpenModelica/flattening/modelica/arrays/TypeTest.mo:5:3-5:44:writable] Error: Base class Modelica.SIunits.Position not found in scope TypeTest.
//
// Execution failed!
// endResult
