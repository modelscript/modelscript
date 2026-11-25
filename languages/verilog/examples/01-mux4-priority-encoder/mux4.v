// IEEE 1364 Verilog 4-to-1 Multiplexer and 4-Bit Priority Encoder
module mux4_priority (
  input  [7:0] d0,
  input  [7:0] d1,
  input  [7:0] d2,
  input  [7:0] d3,
  input  [3:0] req,
  output reg [7:0] y_out,
  output reg [1:0] sel_code,
  output wire valid
);
  assign valid = req[3] | req[2] | req[1] | req[0];

  always @(*) begin
    if (req[3])
      sel_code = 2'b11;
    else if (req[2])
      sel_code = 2'b10;
    else if (req[1])
      sel_code = 2'b01;
    else
      sel_code = 2'b00;
  end

  always @(*) begin
    case (sel_code)
      2'b00: y_out = d0;
      2'b01: y_out = d1;
      2'b10: y_out = d2;
      2'b11: y_out = d3;
      default: y_out = 8'h00;
    endcase
  end
endmodule
