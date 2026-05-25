/* eslint-disable */
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

const Container = styled.div`
  display: inline-block;
  position: relative;
  height: 1.2em; /* Ensure it covers the line height */
  overflow: hidden;
  vertical-align: middle;
`;

const Slider = styled.div<{ $animating: boolean; $direction: "up" | "down" }>`
  display: flex;
  flex-direction: column;
  transition: ${(props) => (props.$animating ? "transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)" : "none")};
  /* If direction is up (count increased), we want the old number on top, new number on bottom.
     Wait, if old number is on top, initial state is translateY(0). Target state is translateY(-100%).
     If direction is down (count decreased), we want new number on top, old number on bottom.
     Initial state is translateY(-100%). Target state is translateY(0). */
  transform: translateY(
    ${(props) => {
      if (!props.$animating) {
        return props.$direction === "up" ? "0" : "-50%";
      } else {
        return props.$direction === "up" ? "-50%" : "0";
      }
    }}
  );
`;

const Item = styled.div`
  height: 1.2em;
  display: flex;
  align-items: center;
`;

export default function AnimatedCount({ count }: { count: number }) {
  const [prevCount, setPrevCount] = useState(count);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (count !== prevCount) {
      const isUp = count > prevCount;
      setDirection(isUp ? "up" : "down");

      // Start slightly before animation so DOM updates the non-animated initial position
      setAnimating(false);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      // small delay to let browser render initial state before transitioning
      setTimeout(() => {
        setAnimating(true);
        timeoutRef.current = setTimeout(() => {
          setAnimating(false);
          setPrevCount(count);
        }, 250); // match transition duration
      }, 20);
    }
  }, [count, prevCount]);

  if (count === prevCount && !animating) {
    return (
      <span style={{ display: "inline-block", height: "1.2em", lineHeight: "1.2em" }}>{count > 0 ? count : ""}</span>
    );
  }

  return (
    <Container>
      <Slider $animating={animating} $direction={direction}>
        {direction === "up" ? (
          <>
            <Item>{prevCount > 0 ? prevCount : ""}</Item>
            <Item>{count > 0 ? count : ""}</Item>
          </>
        ) : (
          <>
            <Item>{count > 0 ? count : ""}</Item>
            <Item>{prevCount > 0 ? prevCount : ""}</Item>
          </>
        )}
      </Slider>
    </Container>
  );
}
