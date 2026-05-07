// name:     Record Derived 2
// keywords: record
// status:   correct

record BaseProps_Tpoly "Fluid state record"
  Real T "temperature";
  Real p "pressure";
end BaseProps_Tpoly;

model M
  constant Real T = 1.0;
  constant Real p = 2.0;
  ThermodynamicState res;
  replaceable record ThermodynamicState end ThermodynamicState;
end M;

model N
  extends M(redeclare record ThermodynamicState=BaseProps_Tpoly, res = ThermodynamicState(T = T, p = p));
end N;

// Result:
// Error processing file: Derived2.mo
// [OpenModelica/flattening/modelica/records/RecordConnections.mo:17:3-17:23:writable] Error: tr1.i is not a valid connector.
// Error: Error occurred while flattening model Record Derived 2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
