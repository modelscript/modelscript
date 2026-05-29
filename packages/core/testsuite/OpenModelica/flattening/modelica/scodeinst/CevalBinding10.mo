// name: CevalBinding10
// status: correct
//
//

pure function ext_fun
  input Real u1;
  output Real y;
  external "C";
end ext_fun;

model CevalBinding10
  parameter Real Q = ext_fun(0) annotation(Evaluate=true);
end CevalBinding10;

// Result:
// Error processing file: CevalBinding10.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/CevalBinding10.mo:6:1-10:12:writable] Error: External function 'ext_fun' could not be found in any of the given shared libraries:
// [OpenModelica/flattening/modelica/scodeinst/CevalBinding10.mo:13:3-13:58:writable] Error: Failed to evaluate function: ext_fun.
//
// Execution failed!
// endResult
