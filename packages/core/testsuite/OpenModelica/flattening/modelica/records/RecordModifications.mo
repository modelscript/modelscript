// name:     Record Modifications
// keywords: algorithm
// status:   correct

package HardMagnetic
public
constant Real mu_0 = 3;
record BaseData
  parameter Real H_cBRef = 1;
  parameter Real B_rRef = 1;
  parameter Real T_ref = 293.15;
  parameter Real alpha_Br = 0;
  parameter Real T_op = 293.15;
  final parameter Real B_r = B_rRef * (1 + alpha_Br * (T_op - T_ref));
  final parameter Real H_cB = H_cBRef * (1 + alpha_Br * (T_op - T_ref));
  final parameter Real mu_r = B_r / (mu_0 * H_cB);
end BaseData;
record NdFeB
  extends HardMagnetic.BaseData(H_cBRef = 900000, B_rRef = 1.2, T_ref = 30 + 273.15, alpha_Br =  -0.001);
end NdFeB;

record Other
  extends HardMagnetic.BaseData(H_cBRef = 100, B_rRef = 40.7, T_ref = 190 + 273.15, alpha_Br =  -10.01);
end Other;

end HardMagnetic;

model Test
 parameter HardMagnetic.BaseData x = HardMagnetic.BaseData();
 parameter HardMagnetic.Other other = HardMagnetic.Other();
 parameter HardMagnetic.NdFeB y = HardMagnetic.NdFeB();
 HardMagnetic.NdFeB a = HardMagnetic.NdFeB();
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Test;

// Result:
// function HardMagnetic.BaseData "Automatically generated record constructor for HardMagnetic.BaseData"
//   input Real H_cBRef = 1.0;
//   input Real B_rRef = 1.0;
//   input Real T_ref = 293.15;
//   input Real alpha_Br = 0.0;
//   input Real T_op = 293.15;
//   input Real B_r = B_rRef * (1.0 + alpha_Br * (T_op - T_ref));
//   input Real H_cB = H_cBRef * (1.0 + alpha_Br * (T_op - T_ref));
//   input Real mu_r = 0.3333333333333333 * B_r / H_cB;
//   output BaseData res;
// end HardMagnetic.BaseData;
//
// function HardMagnetic.NdFeB "Automatically generated record constructor for HardMagnetic.NdFeB"
//   input Real H_cBRef = 9e5;
//   input Real B_rRef = 1.2;
//   input Real T_ref = 303.15;
//   input Real alpha_Br = -0.001;
//   input Real T_op = 293.15;
//   input Real B_r = B_rRef * (1.0 + alpha_Br * (T_op - T_ref));
//   input Real H_cB = H_cBRef * (1.0 + alpha_Br * (T_op - T_ref));
//   input Real mu_r = 0.3333333333333333 * B_r / H_cB;
//   output NdFeB res;
// end HardMagnetic.NdFeB;
//
// function HardMagnetic.Other "Automatically generated record constructor for HardMagnetic.Other"
//   input Real H_cBRef = 100.0;
//   input Real B_rRef = 40.7;
//   input Real T_ref = 463.15;
//   input Real alpha_Br = -10.01;
//   input Real T_op = 293.15;
//   input Real B_r = B_rRef * (1.0 + alpha_Br * (T_op - T_ref));
//   input Real H_cB = H_cBRef * (1.0 + alpha_Br * (T_op - T_ref));
//   input Real mu_r = 0.3333333333333333 * B_r / H_cB;
//   output Other res;
// end HardMagnetic.Other;
//
// class Test
//   parameter Real x.H_cBRef = 1.0;
//   parameter Real x.B_rRef = 1.0;
//   parameter Real x.T_ref = 293.15;
//   parameter Real x.alpha_Br = 0.0;
//   parameter Real x.T_op = 293.15;
//   final parameter Real x.B_r = 1.0;
//   final parameter Real x.H_cB = 1.0;
//   final parameter Real x.mu_r = 0.3333333333333333;
//   parameter Real other.H_cBRef = 100.0;
//   parameter Real other.B_rRef = 40.7;
//   parameter Real other.T_ref = 463.15;
//   parameter Real other.alpha_Br = -10.01;
//   parameter Real other.T_op = 293.15;
//   final parameter Real other.B_r = 69299.89;
//   final parameter Real other.H_cB = 170270.0;
//   final parameter Real other.mu_r = 0.13566666666666666;
//   parameter Real y.H_cBRef = 9e5;
//   parameter Real y.B_rRef = 1.2;
//   parameter Real y.T_ref = 303.15;
//   parameter Real y.alpha_Br = -0.001;
//   parameter Real y.T_op = 293.15;
//   final parameter Real y.B_r = 1.212;
//   final parameter Real y.H_cB = 909000.0;
//   final parameter Real y.mu_r = 4.444444444444444e-7;
//   parameter Real a.H_cBRef = 9e5;
//   parameter Real a.B_rRef = 1.2;
//   parameter Real a.T_ref = 303.15;
//   parameter Real a.alpha_Br = -0.001;
//   parameter Real a.T_op = 293.15;
//   final parameter Real a.B_r = 1.212;
//   final parameter Real a.H_cB = 909000.0;
//   final parameter Real a.mu_r = 4.444444444444444e-7;
// end Test;
// endResult
