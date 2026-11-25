// Testbench for Parameterized PWM Motor Driver
module tb_pwm;
  reg       clk;
  reg       rst;
  reg       enable;
  reg [7:0] duty;
  wire      pwm_hi;
  wire      pwm_lo;

  pwm_driver u_dut (
    .clk(clk),
    .rst(rst),
    .enable(enable),
    .duty(duty),
    .pwm_hi(pwm_hi),
    .pwm_lo(pwm_lo)
  );

  initial begin
    clk    = 1'b0;
    rst    = 1'b1;
    enable = 1'b0;
    duty   = 8'd100;
  end
endmodule
