// Parameterized Complementary PWM Motor Driver with Dead-Time Control
module pwm_driver #(
  parameter PERIOD = 8'd200,
  parameter DEADTIME = 8'd4
) (
  input        clk,
  input        rst,
  input        enable,
  input  [7:0] duty,
  output reg   pwm_hi,
  output reg   pwm_lo
);
  reg [7:0] counter;

  always @(posedge clk) begin
    if (rst) begin
      counter <= 8'd0;
      pwm_hi  <= 1'b0;
      pwm_lo  <= 1'b0;
    end else if (!enable) begin
      counter <= 8'd0;
      pwm_hi  <= 1'b0;
      pwm_lo  <= 1'b0;
    end else begin
      if (counter >= PERIOD)
        counter <= 8'd0;
      else
        counter <= counter + 8'd1;

      if (counter < duty) begin
        pwm_hi <= 1'b1;
        pwm_lo <= 1'b0;
      end else if (counter >= duty + DEADTIME) begin
        pwm_hi <= 1'b0;
        pwm_lo <= 1'b1;
      end else begin
        pwm_hi <= 1'b0;
        pwm_lo <= 1'b0;
      end
    end
  end
endmodule
