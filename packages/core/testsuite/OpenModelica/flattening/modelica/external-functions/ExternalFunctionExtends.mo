// name: ExternalFunctionExtends
// status: correct

class ExternalFunctionExtends
  function f1
    input Real r1;
    output Real o1;
  external;
  end f1;
  function f2
    extends f1;
  algorithm
    o1 := r1;
  end f2;
  constant Real r = f2(1.0);
end ExternalFunctionExtends;

// Result:
// Error processing file: ExternalFunctionExtends.mo
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionExtends.mo:15:3-15:28:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionExtends.mo:11:5-11:15:writable] Notification: From here:
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionExtends.mo:10:3-14:9:writable] Error: Function f2 has more than one algorithm section or external declaration.
// Error: Error occurred while flattening model ExternalFunctionExtends
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
