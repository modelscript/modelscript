// name:     FunctionDefaultArgsCycle
// keywords: functions, default arguments, #2640
// status:   incorrect
//
// Tests default arguments in functions where the values are cyclically
// dependent.
//

function f
  input Real x;
  input Real y = 2 * x + z;
  input Real z = x / y;
  output Real o;
algorithm
  o := x+y+z;
end f;

model FunctionDefaultArgsCycle
  Real x = f(4);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end FunctionDefaultArgsCycle;

// Result:
// [flattening/modelica/algorithms-functions/FunctionDefaultArgsCycle.mo:11:14-11:15] Error: [M4009] The default value of y causes a cyclic dependency.
// endResult
