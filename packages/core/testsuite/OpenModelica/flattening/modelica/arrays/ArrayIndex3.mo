// name:     ArrayIndex
// keywords: array, index
// status:   correct
//
// This is a simple test of basic array handling. Bug reported by Hannes Edinger
//

class myTestClass
  connector acausalConnectorR
    Real value;
    flow Real f;
  end acausalConnectorR;

  class encapsulatedArrayR2
    acausalConnectorR IN;
    acausalConnectorR OUT;
  protected
    Real v[3]={1.1,2.2,3.3};
  equation
    OUT.value=v[integer(IN.value)];
  end encapsulatedArrayR2;

  class someThingR
    parameter Real value=2.7;
    acausalConnectorR OUT;
  equation
    OUT.value=value;
  end someThingR;

  model a2
    encapsulatedArrayR2 myTable;
    someThingR mySomeThingR;
  equation
    connect(mySomeThingR.OUT,myTable.IN);
  end a2;
end myTestClass;
model myTestClass_a2
  extends myTestClass.a2;
end myTestClass_a2;
// Result:
// Error processing file: ArrayIndex3.mo
// Error: Failed to load package ArrayIndex (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ArrayIndex not found in scope <top>.
// Error: Error occurred while flattening model ArrayIndex
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
