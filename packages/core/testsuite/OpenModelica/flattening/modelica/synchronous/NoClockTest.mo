// name: NoClockTest
// keywords: synchronous features
// status: correct

model NoClockTest
  output Real x;
  output Integer y[2];
  Integer z[2];
  output Integer yy[2];
equation
  x = noClock(3);
  y = noClock(z);
  yy = noClock(vector([3;4]));
end NoClockTest;

// Result:
// class NoClockTest
//   output Real x;
//   output Integer y[1];
//   output Integer y[2];
//   Integer z[1];
//   Integer z[2];
//   output Integer yy[1];
//   output Integer yy[2];
// equation
//   x = /*Real*/(noClock(3));
//   y = noClock(z);
//   yy = noClock({3, 4});
// end NoClockTest;
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2102:9-2103:55:writable] Error: Internal error NFCeval.evalBuiltinCall: unimplemented case for noClock
// endResult
