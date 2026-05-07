// name:     Cardinality
// keywords: cardinality
// status:   correct
//
// Testing the cardinality operator
//

connector Pin
  Real v;
  flow Real i;
end Pin;

model Resistor
  Pin p;
  Pin n;
  Pin q;
  //Real x,x2;
  parameter Integer n_conn = cardinality(p);
equation
  connect(p,q);
  //if  cardinality(p) == 1 then x = 2; else x=3; end if;
  //if cardinality(p) == 2 then x2 = 2; else x2=3; end if;
end Resistor;

model circuit
  Pin p;
  Resistor R1,R2;

equation

    connect(R1.p,p); // R1.n_conn = cardinality(R1.p) = 2;
end circuit;

// Result:
// Error processing file: Cardinality.mo
// Error: Failed to load package Cardinality (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Cardinality not found in scope <top>.
// Error: Error occurred while flattening model Cardinality
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
