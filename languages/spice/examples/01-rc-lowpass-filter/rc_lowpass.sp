* First-Order RC Low-Pass Filter (fc = 1.59 kHz)
V1 in 0 DC 0 AC 1 PULSE(0 5 1u 10n 10n 500u 1m)
R1 in out 1k
C1 out 0 100n
Rload out 0 100k

.AC DEC 20 10 1Meg
.TRAN 1u 2m
.END
