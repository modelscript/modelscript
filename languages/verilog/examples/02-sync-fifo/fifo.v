// 4x8-Bit Synchronous FIFO Ring Buffer
module sync_fifo (
  input        clk,
  input        rst,
  input        wr_en,
  input        rd_en,
  input  [7:0] din,
  output reg [7:0] dout,
  output wire  full,
  output wire  empty
);
  reg [7:0] slot0;
  reg [7:0] slot1;
  reg [7:0] slot2;
  reg [7:0] slot3;
  reg [1:0] wr_ptr;
  reg [1:0] rd_ptr;
  reg [2:0] count;

  assign full  = (count == 3'd4);
  assign empty = (count == 3'd0);

  always @(posedge clk) begin
    if (rst) begin
      wr_ptr <= 2'd0;
      rd_ptr <= 2'd0;
      count  <= 3'd0;
      dout   <= 8'h00;
      slot0  <= 8'h00;
      slot1  <= 8'h00;
      slot2  <= 8'h00;
      slot3  <= 8'h00;
    end else begin
      if (wr_en && !full) begin
        case (wr_ptr)
          2'd0: slot0 <= din;
          2'd1: slot1 <= din;
          2'd2: slot2 <= din;
          2'd3: slot3 <= din;
          default: slot0 <= din;
        endcase
        wr_ptr <= wr_ptr + 2'd1;
      end

      if (rd_en && !empty) begin
        case (rd_ptr)
          2'd0: dout <= slot0;
          2'd1: dout <= slot1;
          2'd2: dout <= slot2;
          2'd3: dout <= slot3;
          default: dout <= slot0;
        endcase
        rd_ptr <= rd_ptr + 2'd1;
      end

      if (wr_en && !full && !(rd_en && !empty))
        count <= count + 3'd1;
      else if (rd_en && !empty && !(wr_en && !full))
        count <= count - 3'd1;
    end
  end
endmodule
