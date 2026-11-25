-- Verification Testbench for 8N1 UART Serial Transmitter
library ieee;
use ieee.std_logic_1164.all;

entity tb_uart is
end entity tb_uart;

architecture sim of tb_uart is
  signal clk       : std_logic := '0';
  signal rst       : std_logic := '1';
  signal tx_start  : std_logic := '0';
  signal tx_byte   : std_logic_vector(7 downto 0) := X"5A";
  signal tx_serial : std_logic;
  signal tx_busy   : std_logic;

  component uart_tx is
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
  end component uart_tx;
begin
  u_dut : uart_tx
    port map (
      clk       => clk,
      rst       => rst,
      tx_start  => tx_start,
      tx_byte   => tx_byte,
      tx_serial => tx_serial,
      tx_busy   => tx_busy
    );
end architecture sim;
