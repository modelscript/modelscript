# Steel Mill Production Mix Linear Program
set PROD;

param rate {PROD} > 0;     # tons produced per hour
param avail >= 0;          # hours available per week
param profit {PROD};       # profit per ton ($/ton)
param market {PROD} >= 0;  # maximum weekly demand (tons)

var Make {p in PROD} >= 0, <= market[p];

maximize Total_Profit:
  sum {p in PROD} profit[p] * Make[p];

subject to Mill_Time:
  sum {p in PROD} (1 / rate[p]) * Make[p] <= avail;
