model Stair
  Integer counter(start=1);
equation
  when time >= counter then
    counter = pre(counter) + 1;
  end when;
end Stair;
