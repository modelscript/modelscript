// name: ShiftSampleTest
// keywords: synchronous features
// status: correct

model ShiftSampleTest
  output Real x;
  output Real y[2];
  Real z[2];
equation
  x = shiftSample(1.0, 2, 4);
  y = shiftSample(z, 3);
end ShiftSampleTest;

// Result:
// class ShiftSampleTest
//   output Real x;
//   output Real y[1];
//   output Real y[2];
//   Real z[1];
//   Real z[2];
// equation
//   x = shiftSample(1.0, 2, 4);
//   y = shiftSample(z, 3, 1);
// end ShiftSampleTest;
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2102:9-2103:55:writable] Error: Internal error NFCeval.evalBuiltinCall: unimplemented case for shiftSample
// endResult
