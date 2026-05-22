// status: correct
// From: https://trac.openmodelica.org/OpenModelica/ticket/4795

package ModelicaServices  "ModelicaServices (OpenModelica implementation) - Models and functions used in the Modelica Standard Library requiring a tool specific implementation"
package Machine
final constant Real eps = 1.e-15 "Biggest number such that 1.0 + eps = 1.0";
end Machine;
end ModelicaServices;

package Modelica  "Modelica Standard Library - Version 3.2.2"
package Math  "Library of mathematical functions (e.g., sin, cos) and of functions operating on vectors and matrices"
package Nonlinear  "Library of functions operating on nonlinear equations"
package Interfaces  "Interfaces for functions"

encapsulated partial function partialScalarFunction
  input Real u;
  output Real y;
end partialScalarFunction;
end Interfaces;

function solveOneNonlinearEquation
  input Modelica.Math.Nonlinear.Interfaces.partialScalarFunction f;
  input Real u_min;
  input Real u_max;
  input Real tolerance;
  output Real u;
algorithm
  assert(false, "We just flatten the code...");
end solveOneNonlinearEquation;
end Nonlinear;
end Math;

package SIunits  "Library of type and unit definitions based on SI units according to ISO 31-1992"
package Conversions  "Conversion functions to/from non SI units and type definitions of non SI units"
package NonSIunits  "Type definitions of non SI units"
type Temperature_degC = Real(final quantity = "ThermodynamicTemperature", final unit = "degC") "Absolute temperature in degree Celsius (for relative temperature use SIunits.TemperatureDifference)";
end NonSIunits;
end Conversions;

type Angle = Real(final quantity = "Angle", final unit = "rad", displayUnit = "deg");
type Velocity = Real(final quantity = "Velocity", final unit = "m/s");
type Acceleration = Real(final quantity = "Acceleration", final unit = "m/s2");
type FaradayConstant = Real(final quantity = "FaradayConstant", final unit = "C/mol");
end SIunits;
end Modelica;

model SimpleModelWithSubstructure
parameter Real[:, 2] qNom = [0.0, 0.0001; 5.0, 0.001; 10.0, 0.01];
parameter Integer n = size(qNom, 1);
parameter Real[n, 1] dhydMax = [{Modelica.Math.Nonlinear.solveOneNonlinearEquation(function dhydCalc(qNom = qNom[i, 2]), 0, 1e-1, 1e-13) for i in 1:n}];

function dhydCalc
extends Modelica.Math.Nonlinear.Interfaces.partialScalarFunction;
input Real qNom;
algorithm
y := u - 1e-3;
end dhydCalc;
end SimpleModelWithSubstructure;

model SimpleModelWithSubstructure_TC01
SimpleModelWithSubstructure simpleModelWithSubstructure1;
end SimpleModelWithSubstructure_TC01;

// Result:
// class SimpleModelWithSubstructure_TC01
//   parameter Real simpleModelWithSubstructure1.qNom[1,1] = 0.0;
//   parameter Real simpleModelWithSubstructure1.qNom[1,2] = 0.0001;
//   parameter Real simpleModelWithSubstructure1.qNom[2,1] = 5.0;
//   parameter Real simpleModelWithSubstructure1.qNom[2,2] = 0.001;
//   parameter Real simpleModelWithSubstructure1.qNom[3,1] = 10.0;
//   parameter Real simpleModelWithSubstructure1.qNom[3,2] = 0.01;
//   parameter Integer simpleModelWithSubstructure1.n = 3;
//   parameter Real simpleModelWithSubstructure1.dhydMax[1,1];
// end SimpleModelWithSubstructure_TC01;
// Warning: Class 'partialScalarFunction' should start with an uppercase letter
// Warning: Class 'solveOneNonlinearEquation' should start with an uppercase letter
// Warning: Input variable 'f' is never used in the function body
// Warning: Input variable 'u_min' is never used in the function body
// Warning: Input variable 'u_max' is never used in the function body
// Warning: Input variable 'tolerance' is never used in the function body
// Info: Class 'Temperature_degC' has no members
// Info: Class 'Angle' has no members
// Info: Class 'Velocity' has no members
// Info: Class 'Acceleration' has no members
// Info: Class 'FaradayConstant' has no members
// Warning: Class 'dhydCalc' should start with an uppercase letter
// Warning: Input variable 'qNom' is never used in the function body
// endResult
