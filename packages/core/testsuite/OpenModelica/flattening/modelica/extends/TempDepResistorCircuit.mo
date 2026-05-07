// name:     TempDepResistorCircuit
// keywords: <insert keywords here>
// status:   correct
//
//
// The flattened model should be the same for test TempDepResistorCircuit and
// TempDepResistorCircuitInherited
//


type ElectricPotential = Real (final quantity="ElectricPotential", final unit ="V");
type Voltage = ElectricPotential;
type ElectricCurrent = Real (final quantity="ElectricCurrent",
     final unit="A");
type Current = ElectricCurrent;

// From Modelica.Electrical.Analog.Interfaces
connector Pin
  Voltage v;
  flow Current i;
end Pin;

model Resistor "Electrical resistor"
  Pin p, n "positive and negative pins";
  Voltage v;
  Current i;
    parameter Real R(unit="Ohm") "Resistance";
  equation
    v = i*R;
end Resistor;

model ResistorCircuit // Circuit of three Resistors connected at one node
  Resistor R1(R = 100);
  Resistor R2(R = 200);
  Resistor R3(R = 300);
equation
  connect(R1.p, R2.p);
  connect(R1.p, R3.p);
end ResistorCircuit;

model GenericResistorCircuit // The ResistorCircuit made generic
  replaceable Resistor R1(R = 100); // Formal class parameter
  replaceable Resistor R2(R = 200); // Formal class parameter
  replaceable Resistor R3(R = 300); // Formal class parameter
equation
  connect(R1.p, R2.p);
  connect(R1.p, R3.p);
end GenericResistorCircuit;

model TempResistor
  extends Resistor;
  Real Temp;
  Real RT;
end TempResistor;

model TemperatureDependentResistorCircuit
  Real Temp;
  extends GenericResistorCircuit(
  redeclare TempResistor R1(RT = 0.1, Temp = Temp),
  redeclare TempResistor R2
  );
end TemperatureDependentResistorCircuit;

// Result:
// Error processing file: TempDepResistorCircuit.mo
// Error: Failed to load package TempDepResistorCircuit (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class TempDepResistorCircuit not found in scope <top>.
// Error: Error occurred while flattening model TempDepResistorCircuit
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
