// name: UnboundParameter5
// keywords:
// status: correct
//

model UnboundParameter5
  type E = enumeration(a, b, c, d);

  parameter Real r1;
  parameter Real r2(min = 1.0, max = 3.0);
  parameter Real r3(min = -3.0, max = -1.0);
  parameter Integer i1;
  parameter Integer i2(min = 1, max = 3);
  parameter Integer i3(min = -3, max = -1);
  parameter Boolean b1;
  parameter String s1;
  parameter E e1;
  parameter E e2(min = E.c);
end UnboundParameter5;

// Result:
// Error processing file: UnboundParameter5.mo
// [OpenModelica/flattening/modelica/scodeinst/UnboundParameter5.mo:9:3-9:20:writable] Error: Parameter r1 has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model UnboundParameter5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
