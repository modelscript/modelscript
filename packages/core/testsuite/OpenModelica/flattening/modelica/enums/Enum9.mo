// name:     Enumeration9
// keywords: enumeration enum Integer
// status:   correct
//
//
//

type ABC = enumeration(a,b,c);

model EnumTest
   Integer a;
equation
   a = Integer(ABC.b);
end EnumTest;


// Result:
// Error processing file: Enum9.mo
// Error: Failed to load package Enumeration9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Enumeration9 not found in scope <top>.
// Error: Error occurred while flattening model Enumeration9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
