// 16-Bit Combinational Arithmetic Logic Unit
module alu16 (
  input  [15:0] a,
  input  [15:0] b,
  input  [2:0]  op,
  output reg [15:0] y,
  output wire   zero
);
  assign zero = (y == 16'h0000);

  always @(*) begin
    case (op)
      3'b000: y = a + b;
      3'b001: y = a - b;
      3'b010: y = a & b;
      3'b011: y = a | b;
      3'b100: y = a ^ b;
      default: y = a;
    endcase
  end
endmodule
