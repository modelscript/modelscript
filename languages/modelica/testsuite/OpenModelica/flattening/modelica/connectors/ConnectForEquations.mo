// name:     ConnectForEquations
// keywords: <insert keywords here>
// status:   correct
//
// Drmodelica: 8.2  connect equations (p. 244)
//

model Test

model ResistorCircuit
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 100);
  Modelica.Electrical.Analog.Basic.Resistor R2(R = 200);
  Modelica.Electrical.Analog.Basic.Resistor R3(R = 300);
equation
  connect(R1.p, R2.p);
  connect(R1.p, R3.p);
end ResistorCircuit;

class RegComponent
  parameter Integer n;
  Modelica.Electrical.Analog.Basic.Resistor r_components[n];
  Modelica.Electrical.Analog.Basic.Capacitor C;
  Modelica.Electrical.Analog.Basic.Ground G;
  Modelica.Electrical.Analog.Sources.SineVoltage src(V=10);
equation
  for i in 1:n-1 loop
  connect(r_components[i].n, r_components[i + 1].p);
  end for;
  connect(G.p,C.n);
  connect(C.p,r_components[n].n);
  connect(r_components[1].p,src.p);
  connect(src.n,G.p);
end RegComponent;


  RegComponent rc(n = 6);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Test;

// Result:
// Error processing file: ConnectForEquations.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/connectors/ConnectForEquations.mo:21:3-21:60:writable] Error: Class Modelica.Electrical.Analog.Basic.Resistor not found in scope Test.RegComponent.
// Error: Error occurred while flattening model Test
//
// Execution failed!
// endResult
