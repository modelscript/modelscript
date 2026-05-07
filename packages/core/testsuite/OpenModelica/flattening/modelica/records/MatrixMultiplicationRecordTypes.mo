// name: MatrixMultiplicationRecordTypes
// keywords: operator overloading, matrix, Complex, record
// status: correct
//
// We have a matrix multiplication of records. According to Spec. 3.2 Section 14.4 and 10.6.4, this should be handled
// the same way as matrix multilication of numeric matrics.
// - Not sure what will happen when users want to overload multiplication '*' for matrices of their records with their own algorithm.
// Which one should be chosen?
// - Also if the user hasn't overloaded either of '+' or '*'(for scalar records) then what should happen? The matrix multiplication needs both to be overloaded.



operator record Complex
  Real re;
  Real im;

  encapsulated operator 'constructor'
    function fromReal
      import Complex;
      input Real re;
      input Real im = 0;
      output Complex result(re = re, im = im);
    end fromReal;
  end 'constructor';

  encapsulated operator '*'
    function multiply
      import Complex;
      input Complex c1;
      input Complex c2;
      output Complex c3;
    algorithm
      c3 := Complex(c1.re*c2.re - c1.im*c2.im, c1.re*c2.im + c1.im*c2.re);
    end multiply;

    function scalarProduct
      import Complex;
      input Complex c1[:];
      input Complex c2[size(c1, 1)];
      output Complex c3;
    algorithm
      c3 := Complex(0);
      for i in 1:size(c1, 1) loop
        c3 := c3 + c1[i] * c2[i];
      end for;
    end scalarProduct;
  end '*';

  encapsulated operator function '+'
    import Complex;
    input Complex c1;
    input Complex c2;
    output Complex c3;
  algorithm
    c3 := Complex(c1.re + c2.re, c1.im + c2.im);
  end '+';
end Complex;

model ComplexTest
  Complex c1 = Complex(1.0, 0.0);
  Complex c2[3, 3] = {{c1, c1, c1}, {c1, c1, c1}, {c1, c1, c1}};
  Complex c3[3, 1] = {{c1}, {c1}, {c1}};
  Complex c4[3, 1] = c2 * c3;
end ComplexTest;

// Result:
// Error processing file: MatrixMultiplicationRecordTypes.mo
// Error: Failed to load package MatrixMultiplicationRecordTypes (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class MatrixMultiplicationRecordTypes not found in scope <top>.
// Error: Error occurred while flattening model MatrixMultiplicationRecordTypes
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
