// name:     RefinedSimpleCircuitValid2
// keywords: <insert keywords here>
// status:   correct
//
// A formal class parameter, can also be a type, which is useful for
// changing the type of many objects. For example, by providing a type
// parameter ResistorModel in the class below it is easy to change the
// resistor type of all objects of type ResistorModel, e.g. from the default
// type Resistor to the temperature dependent type TempResistor.
//
// Drmodelica: 4.4 Parameterized Generic Classes (p. 133)
//

  type ElectricPotential = Real (final quantity="ElectricPotential", final unit
        ="V");
  type Voltage = ElectricPotential;
  type ElectricCurrent = Real (final quantity="ElectricCurrent", final unit="A");
  type Current = ElectricCurrent;
  type Capacitance = Real (
      final quantity="Capacitance",
      final unit="F",
      min=0);
  type Inductance = Real (
      final quantity="Inductance",
      final unit="H",
      min=0);


  // From Modelica.Electrical.Analog.Interfaces
  connector Pin
    Voltage v;
    flow Current i;
  end Pin;

  model Resistor "Electrical resistor"
    Pin p;
    Pin n "positive and negative pins";
    Voltage v;
    Current i;
    parameter Real R(unit="Ohm") "Resistance";
  equation
    v = i*R;
  end Resistor;

  partial class TwoPin
    "Superclass of elements with two electrical pins"
    Pin p;
    Pin n;
    Voltage v;
    Current i;
  equation
    v = p.v - n.v;
    p.i + n.i = 0;
    i = p.i;
  end TwoPin;

model ResistorCircuit // Circuit of three Resistors connected at one node
  Resistor R1(R = 100);
  Resistor R2(R = 200);
  Resistor R3(R = 300);
equation
  connect(R1.p, R2.p);
  connect(R1.p, R3.p);
end ResistorCircuit;

model GenericResistorCircuit2
  replaceable model ResistorModel = Resistor;
  replaceable Resistor R1(R = 100);
  replaceable Resistor R2(R = 200);
  replaceable Resistor R3(R = 300);
equation
  connect(R1.p, R2.p);
  connect(R1.p, R3.p);
end GenericResistorCircuit2;

model TempResistor
  extends Resistor;
  Real Temp;
  Real RT;
end TempResistor;

model RefinedResistorCircuit2 =
  GenericResistorCircuit2(redeclare model ResistorModel = TempResistor);

model RefinedResistorCircuit2Expanded
  TempResistor R1(R=100);
  TempResistor R2(R=200);
  TempResistor R3(R=300);
equation
  connect(R1.p, R2.p);
  connect(R1.p, R3.p);
end RefinedResistorCircuit2Expanded;

// Result:
// Error processing file: RefinedSimpleCircuitValid2.mo
// Error: Failed to load package RefinedSimpleCircuitValid2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RefinedSimpleCircuitValid2 not found in scope <top>.
// Error: Error occurred while flattening model RefinedSimpleCircuitValid2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
