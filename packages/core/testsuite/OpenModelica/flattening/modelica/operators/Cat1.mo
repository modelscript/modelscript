// name:     Cat1
// keywords: cat
// status:   correct
//
// Tests the builtin cat operator.
//

type MyType = enumeration(divisionType1,divisionType2);

partial model myPartialModel
  parameter Integer n (min = 1) = 2;
  parameter MyType myDivision = MyType.divisionType1;
  parameter Real[n] x;
  parameter Real[n] y;
  Real[n] z;
equation
  for i in 1:n loop
    z[i] = x[i] * y[i];
  end for;
end myPartialModel;

model Cat1
  parameter Real a;
  parameter Real b;

  final parameter Real[n] aDivisions = if n == 1 then {a} else fill(a/n, n);
  final parameter Real[n] bDivisions =
    if n == 1 then {b}
    elseif myDivision == MyType.divisionType1 then cat(1, {b/(n-1)/2}, fill(b/(n-1), n-2), {b/(n-1)/2})
    else fill(b/n, n);
  extends myPartialModel(final x = aDivisions,
                         final y = bDivisions);
end Cat1;

// Result:
// Error processing file: Cat1.mo
// [OpenModelica/flattening/modelica/operators/Cat1.mo:23:3-23:19:writable] Error: Parameter a has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model Cat1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
