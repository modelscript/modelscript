// name: OperatorSimple
// keywords: operator
// status: correct
//
// Tests simple operator overloading
//

operator record Complex
  Real re;
  Real im;

  operator '*'
    function mul
      input Complex c1;
      input Complex c2;
      output Complex result;
    algorithm
      result := Complex(re=c1.re*c2.re - c1.im*c2.im,
                        im=c1.re*c2.im + c1.im*c2.re);
    end mul;
  end '*';
end Complex;

model OperatorSimple
  Complex c1,c2,c3;
equation
  c1 = Complex(re=2.0,im=3.0);
  c2 = Complex(re=7.0,im=3.14);
  c3 = c1 * c2;
end OperatorSimple;

// Result:
// Error processing file: OperatorSimple.mo
// [OpenModelica/flattening/modelica/operators/OperatorSimple.mo:12:3-21:10:writable] Error: Operator Complex.'*' is not encapsulated.
// Error: Error occurred while flattening model OperatorSimple
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
