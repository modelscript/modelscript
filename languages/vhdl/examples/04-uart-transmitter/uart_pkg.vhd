-- Shared UART Timing and Framing Package
library ieee;
use ieee.std_logic_1164.all;

package uart_pkg is
  constant UART_CLK_HZ    : integer := 50000000;
  constant UART_BAUD_RATE : integer := 115200;
  constant UART_CLKS_BIT  : integer := 434;
  constant UART_DATA_BITS : integer := 8;
  type uart_state_t is (TX_IDLE, TX_START_BIT, TX_DATA_BITS, TX_STOP_BIT);
end package uart_pkg;
