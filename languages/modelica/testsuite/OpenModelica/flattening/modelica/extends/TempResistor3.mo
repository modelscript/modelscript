// name:     TempResistor3
// keywords: <insert keywords here>
// status:   correct
//
// MORE WORK ON THIS FILE HAS TO BE DONE!
//
// Drmodelica: 4.5 Design a Class to be Extended (p. 137)
//
type Voltage = Real(Unit = "V");

type Current = Real(Unit = "A");

connector Pin
  Voltage v;
  flow Current i;
end Pin;

model Resistor3  "Electrical Resistor"
  Pin p, n;
  Voltage v;
  Current i;
  parameter Real R(unit = "Ohm")   "Resistance";

  replaceable class ResistorEquation
    equation
      v = i*R;
  end ResistorEquation;

end Resistor3;

model TempResistor3 "Temperature dependent electrical resistor"
  extends Resistor3(
    redeclare class ResistorEquation
      equation
        v = i*(R + RT*(Temp - Tref));
    end ResistorEquation);

  parameter Real RT(unit = "Ohm/degC") = 0   "Temp. dependent Resistance.";
  parameter Real Tref(unit = "degC") = 20    "Reference temperature";
  Real    Temp = 20            "Actual temperature";

  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end TempResistor3;


// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: TempResistor3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/extends/TempResistor3.mo:9:21-9:25:writable] Error: In modifier (Unit = "V"), class or component Unit not found in <Voltage>.
// [OpenModelica/flattening/modelica/extends/TempResistor3.mo:11:21-11:25:writable] Error: In modifier (Unit = "A"), class or component Unit not found in <Current>.
// Error: Error occurred while flattening model TempResistor3
//
// Execution failed!
// endResult
