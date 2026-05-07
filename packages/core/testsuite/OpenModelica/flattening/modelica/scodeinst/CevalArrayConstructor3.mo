// name: CevalArrayConstructor3
// keywords:
// status: correct
//
//

model CevalArrayConstructor3
  parameter Real x[3] = {2, 2, 2};
  parameter Real y[:] = {sum(x[1:i]) for i in 1:2} annotation(Evaluate=true);
end CevalArrayConstructor3;

// Result:
// class CevalArrayConstructor3
//   final parameter Real x[1] = 2.0;
//   final parameter Real x[2] = 2.0;
//   final parameter Real x[3] = 2.0;
//   final parameter Real y[1] = sum(2.0);
//   final parameter Real y[2] = sum(2.0);
// end CevalArrayConstructor3;
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2943:20-2943:79:writable] Error: Internal error NFCeval.evalBuiltinSum got invalid arguments (2.0)
// endResult
