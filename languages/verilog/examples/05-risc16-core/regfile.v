// 4x16-Bit Dual-Port Register File
module regfile16 (
  input         clk,
  input         rst,
  input         we,
  input  [1:0]  rs1,
  input  [1:0]  rs2,
  input  [1:0]  rd,
  input  [15:0] wdata,
  output reg [15:0] rdata1,
  output reg [15:0] rdata2
);
  reg [15:0] r0;
  reg [15:0] r1;
  reg [15:0] r2;
  reg [15:0] r3;

  always @(posedge clk) begin
    if (rst) begin
      r0 <= 16'h0000;
      r1 <= 16'h0001;
      r2 <= 16'h0002;
      r3 <= 16'h0003;
    end else if (we) begin
      case (rd)
        2'd0: r0 <= wdata;
        2'd1: r1 <= wdata;
        2'd2: r2 <= wdata;
        2'd3: r3 <= wdata;
        default: r0 <= wdata;
      endcase
    end
  end

  always @(*) begin
    case (rs1)
      2'd0: rdata1 = r0;
      2'd1: rdata1 = r1;
      2'd2: rdata1 = r2;
      2'd3: rdata1 = r3;
      default: rdata1 = 16'h0000;
    endcase
    case (rs2)
      2'd0: rdata2 = r0;
      2'd1: rdata2 = r1;
      2'd2: rdata2 = r2;
      2'd3: rdata2 = r3;
      default: rdata2 = 16'h0000;
    endcase
  end
endmodule
