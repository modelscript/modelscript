// name:     FixedFalse [BUG: https://trac.openmodelica.org/OpenModelica/ticket/1983]
// keywords: fixed, parameter, modifications
// status:   correct
//
// Tests modifications of final parameters.
// Fix for bug #1983.
//

model FixedFalse
  parameter Integer n = 2;
  parameter Real a[n](each fixed = false);
  parameter Real b[n](each fixed = true);
initial equation
  a = b;
end FixedFalse;

// Result:
// class Modification3
//   parameter Real b.a.p = 2.0;
//   parameter Real b.a2.p = 4.0;
// end Modification3;
// [OpenModelica/flattening/modelica/modification/Modification3.mo:7:5-7:25:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/Modification3.mo:13:3-13:6:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/Modification3.mo:14:3-14:7:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/Modification3.mo:18:3-18:43:writable] Warning: Components are deprecated in class.
// endResult
