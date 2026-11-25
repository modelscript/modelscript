-- Synthesizable 8N1 UART Serial Transmitter
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity uart_tx is
  generic (
    CLKS_PER_BIT : integer := 434
  );
  port (
    clk       : in  std_logic;
    rst       : in  std_logic;
    tx_start  : in  std_logic;
    tx_byte   : in  std_logic_vector(7 downto 0);
    tx_serial : out std_logic;
    tx_busy   : out std_logic
  );
end entity uart_tx;

architecture rtl of uart_tx is
  type tx_state_t is (TX_IDLE, TX_START_BIT, TX_DATA_BITS, TX_STOP_BIT);
  signal state      : tx_state_t;
  signal shift_reg  : std_logic_vector(7 downto 0);
  signal bit_idx    : integer;
  signal baud_cnt   : integer;
  signal serial_reg : std_logic;
  signal busy_reg   : std_logic;
begin
  p_uart_tx : process(clk, rst)
  begin
    if rst = '1' then
      state      <= TX_IDLE;
      shift_reg  <= (others => '0');
      bit_idx    <= 0;
      baud_cnt   <= 0;
      serial_reg <= '1';
      busy_reg   <= '0';
    elsif rising_edge(clk) then
      case state is
        when TX_IDLE =>
          serial_reg <= '1';
          busy_reg   <= '0';
          baud_cnt   <= 0;
          bit_idx    <= 0;
          if tx_start = '1' then
            shift_reg <= tx_byte;
            busy_reg  <= '1';
            state     <= TX_START_BIT;
          end if;
        when TX_START_BIT =>
          serial_reg <= '0';
          if baud_cnt = CLKS_PER_BIT - 1 then
            baud_cnt <= 0;
            state    <= TX_DATA_BITS;
          else
            baud_cnt <= baud_cnt + 1;
          end if;
        when TX_DATA_BITS =>
          serial_reg <= shift_reg(bit_idx);
          if baud_cnt = CLKS_PER_BIT - 1 then
            baud_cnt <= 0;
            if bit_idx = 7 then
              bit_idx <= 0;
              state   <= TX_STOP_BIT;
            else
              bit_idx <= bit_idx + 1;
            end if;
          else
            baud_cnt <= baud_cnt + 1;
          end if;
        when TX_STOP_BIT =>
          serial_reg <= '1';
          if baud_cnt = CLKS_PER_BIT - 1 then
            baud_cnt <= 0;
            busy_reg <= '0';
            state    <= TX_IDLE;
          else
            baud_cnt <= baud_cnt + 1;
          end if;
      end case;
    end if;
  end process p_uart_tx;

  tx_serial <= serial_reg;
  tx_busy   <= busy_reg;
end architecture rtl;
