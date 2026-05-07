// name: ExternalFunction5
// status: correct
// teardown_command: rm -f myFloor.* myFloor_* ExternalFunction5_*

function trunc
  input Real r;
  output Real o;
external "builtin";
end trunc;

class ExternalFunction5
  Real r1 = trunc(1.5);
  Real r2 = trunc(-1.5);
end ExternalFunction5;

// Result:
// class ExternalFunction5
//   Real r1 = trunc(1.5);
//   Real r2 = trunc(-1.5);
// end ExternalFunction5;
// [OpenModelica/flattening/modelica/external-functions/ExternalFunction5.mo:12:3-12:23:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/external-functions/ExternalFunction5.mo:13:3-13:24:writable] Warning: Components are deprecated in class.
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2102:9-2103:55:writable] Error: Internal error NFCeval.evalBuiltinCall: unimplemented case for trunc
// endResult
