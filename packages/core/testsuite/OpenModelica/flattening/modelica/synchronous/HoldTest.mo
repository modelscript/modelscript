// name: HoldTest
// keywords: synchronous features
// status: correct

model HoldTest
  output Real x;
  output Real y[2];
  Real z[2];
equation
  x = hold(3);
  y = hold(z);
end HoldTest;

// Result:
// class HoldTest
//   output Real x;
//   output Real y[1];
//   output Real y[2];
//   Real z[1];
//   Real z[2];
// equation
//   x = /*Real*/(hold(3));
//   y = hold(z);
// end HoldTest;
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2102:9-2103:55:writable] Error: Internal error NFCeval.evalBuiltinCall: unimplemented case for hold
// endResult
