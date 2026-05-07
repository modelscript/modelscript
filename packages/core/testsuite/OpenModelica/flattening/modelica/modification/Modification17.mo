// name:     Modification17
// keywords: modification
// status:   correct
//

package Modelica
  package SIunits
    type Length = Real;
    type Area = Real;
    type Volume = Real;
  end SIunits;
end Modelica;

type MyType = enumeration(divisionType1 , divisionType2 );

partial model myPartialModel
  parameter Integer m(min = 1) = 2;
  input Modelica.SIunits.Volume[n] v;
end myPartialModel;

partial model mySecondPartialModel
  parameter Integer n(min = 1) = 3;
  parameter MyType myDivision = MyType.divisionType1;
  extends myPartialModel(final m = n - 1, final v = z);
  parameter Modelica.SIunits.Length[n] x;
  parameter Modelica.SIunits.Area[n] y;
  parameter Modelica.SIunits.Volume[n] z;
end mySecondPartialModel;

model Modification17
  parameter Modelica.SIunits.Length a = 1;
  parameter Modelica.SIunits.Length b = 1;
  final parameter Modelica.SIunits.Length c = a * a;
  final parameter Modelica.SIunits.Area[n] areas = fill(c / n, n);
  final parameter Modelica.SIunits.Length[n] lengths = if n == 1 then {b} elseif myDivision == MyType.divisionType1 then cat(1, {b / (n - 1) / 2}, fill(b / (n - 1), n - 2), {b / (n - 1) / 2}) else fill(b / n, n);
  final parameter Modelica.SIunits.Volume[n] volumes = array(areas[i] * lengths[i] for i in 1:n);
  extends mySecondPartialModel(final x = lengths, final y = areas, final z = volumes);
end Modification17;

// Result:
// Error processing file: Modification17.mo
// [OpenModelica/flattening/modelica/modification/Modification17.mo:18:3-18:37:writable] Error: Variable n not found in scope myPartialModel.
// Error: Error occurred while flattening model Modification17
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
