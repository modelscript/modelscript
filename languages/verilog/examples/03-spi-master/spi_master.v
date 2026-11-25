// Mode-0 8-Bit SPI Master Controller FSM
module spi_master (
  input        clk,
  input        rst,
  input        start,
  input  [7:0] tx_data,
  input        miso,
  output reg   sclk,
  output reg   mosi,
  output reg   cs_n,
  output reg [7:0] rx_data,
  output reg   done
);
  localparam S_IDLE  = 2'b00;
  localparam S_LOAD  = 2'b01;
  localparam S_SHIFT = 2'b10;
  localparam S_DONE  = 2'b11;

  reg [1:0] state;
  reg [7:0] tx_shift;
  reg [7:0] rx_shift;
  reg [2:0] bit_cnt;

  always @(posedge clk) begin
    if (rst) begin
      state    <= S_IDLE;
      sclk     <= 1'b0;
      mosi     <= 1'b0;
      cs_n     <= 1'b1;
      tx_shift <= 8'h00;
      rx_shift <= 8'h00;
      rx_data  <= 8'h00;
      bit_cnt  <= 3'd0;
      done     <= 1'b0;
    end else begin
      done <= 1'b0;
      case (state)
        S_IDLE: begin
          cs_n <= 1'b1;
          sclk <= 1'b0;
          if (start) begin
            tx_shift <= tx_data;
            bit_cnt  <= 3'd7;
            cs_n     <= 1'b0;
            state    <= S_LOAD;
          end
        end
        S_LOAD: begin
          mosi  <= tx_shift[7];
          sclk  <= 1'b0;
          state <= S_SHIFT;
        end
        S_SHIFT: begin
          sclk     <= 1'b1;
          rx_shift <= {rx_shift[6:0], miso};
          tx_shift <= {tx_shift[6:0], 1'b0};
          if (bit_cnt == 3'd0) begin
            state <= S_DONE;
          end else begin
            bit_cnt <= bit_cnt - 3'd1;
            state   <= S_LOAD;
          end
        end
        S_DONE: begin
          sclk    <= 1'b0;
          cs_n    <= 1'b1;
          rx_data <= rx_shift;
          done    <= 1'b1;
          state   <= S_IDLE;
        end
        default: state <= S_IDLE;
      endcase
    end
  end
endmodule
