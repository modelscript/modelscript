// name:     RedeclareFunctionSameType.mo [BUG: #2739]
// keywords: redeclare function
// status:   correct
//
// Checks that it's possible to uniquely modify packages in different components having the same type
//
//

model RedeclareFunctionSameType
    package A
        replaceable function f
            input Real a;
            input Real b;
            output Real c;
        end f;
    end A;

    package P
        constant Integer n = 2;
        function f1
            input Real a;
            input Real b;
            output Real c;
        algorithm
            c := a + b + n;
        end f1;

        function f2
            input Real a;
            input Real b;
            output Real c;
        algorithm
            c := a * b * n;
        end f2;
    end P;

    model C
      replaceable function fredecl = A.f;
      package Z = A(redeclare function f = fredecl);
      Real x = Z.f(2, 3);
    end C;

    model B "some comment"
        C c1(redeclare function fredecl = P.f1);
        C c2(redeclare function fredecl = P.f2);
    end B;

    B b;
end RedeclareFunctionSameType;

// Result:
// Error processing file: RedeclareFunctionSameType.mo
// Error: Failed to load package ClassExtends4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ClassExtends4 not found in scope <top>.
// Error: Error occurred while flattening model RedeclareFunctionSameType.mo [BUG: #2739]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
