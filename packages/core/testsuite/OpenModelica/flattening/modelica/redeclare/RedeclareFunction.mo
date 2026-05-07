// name:     RedeclareFunction (Bug1432)
// keywords: redeclare function
// status:   correct
//
// Checks that it's possible to modify packages which have a constant that influences a function.
//
//

model RedeclareFunction
   package A
        constant Integer n = 2;
        function f
            input Real a[n];
            output Real b;
        algorithm
            b := a * (1:n);
        end f;
    end A;

    model B
        package A2 = A;
        package A3 = A(n = 3);

        Real nA2 = 2;
        Real nA3 = 3;

        Real x = A2.f(1:nA2);
        Real y = A3.f(1:nA3);
    end B;

    B b;
end RedeclareFunction;

// Result:
// Error processing file: RedeclareFunction.mo
// [OpenModelica/flattening/modelica/redeclare/ClassExtends3.mo:42:3-42:37:writable] Error: Variable b in package B is not constant.
// [OpenModelica/flattening/modelica/redeclare/ClassExtends3.mo:46:3-46:39:writable] Error: Function B.usePart not found in scope ClassExtends3.
// Error: Error occurred while flattening model RedeclareFunction (Bug1432)
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
