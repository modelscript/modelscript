// name:     FunctionEvalFail
// keywords: function slice assignment
// status:   incorrect
//
// Checks that the compiler fails on a binding it can't evaluate, instead of
// giving it a default value.
//

class FunctionEvalFail
  function x
    input String s;
    output Real r;
  external "builtin";
  end x;

  function f
    input String s;
    output Real r = x(s);
  end f;
  constant Real r = f("abc");
end FunctionEvalFail;

// Result:
// Error processing file: FunctionEvalFail.mo
// [OpenModelica/flattening/modelica/algorithms-functions/FunctionEvalFail.mo:20:3-20:29:writable] Warning: Components are deprecated in class.
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2102:9-2103:55:writable] Error: Internal error NFCeval.evalBuiltinCall: unimplemented case for x
// Error: Error occurred while flattening model FunctionEvalFail
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
