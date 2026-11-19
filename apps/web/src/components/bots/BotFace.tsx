import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import type { BotFaceName, BotMood } from "./botFace.logic";

/** A character's outline, and where on it the eyes and mouth sit. */
const SHAPES: Readonly<
  Record<BotFaceName, { readonly body: ReactNode; readonly eyeY: number; readonly mouthY: number }>
> = {
  blob: { body: <rect x="7" y="9" width="50" height="48" rx="21" />, eyeY: 31, mouthY: 43 },
  ghost: {
    body: (
      <path d="M10 31A22 22 0 0 1 54 31V57l-7.33-5.5-7.33 5.5L32 51.500l-7.34 5.5-7.33-5.500L10 57Z" />
    ),
    eyeY: 29,
    mouthY: 40,
  },
  cat: {
    body: (
      <path d="M10 7 24 18q8-2.500 16 0L54 7q3.500 12 3.500 26A25.500 23.500 0 0 1 6.500 33Q6.500 19 10 7Z" />
    ),
    eyeY: 33,
    mouthY: 44,
  },
  robot: {
    body: (
      <>
        <rect x="30.500" y="6" width="3" height="11" rx="1.500" />
        <circle cx="32" cy="6" r="3.800" />
        <rect x="2.500" y="29" width="7" height="13" rx="2.500" />
        <rect x="54.500" y="29" width="7" height="13" rx="2.500" />
        <rect x="7.500" y="14" width="49" height="43" rx="13" />
      </>
    ),
    eyeY: 32,
    mouthY: 45,
  },
  drop: {
    body: (
      <path d="M32 3C41 16 55.500 26 55.500 39A23.500 21 0 0 1 8.500 39C8.500 26 23 16 32 3Z" />
    ),
    eyeY: 37,
    mouthY: 48,
  },
  bear: {
    body: (
      <>
        <circle cx="14.500" cy="16.500" r="9.500" />
        <circle cx="49.500" cy="16.500" r="9.500" />
        <ellipse cx="32" cy="36" rx="26" ry="23" />
      </>
    ),
    eyeY: 33,
    mouthY: 45,
  },
  sprout: {
    body: (
      <>
        <path d="M32 18C30.500 8 23 3.500 15 6c1.500 9 9 12.500 17 12Z" />
        <path d="M32 18c1-7 6.500-10.500 13-9.500-1 7-6.500 10.500-13 9.500Z" />
        <ellipse cx="32" cy="38" rx="25.500" ry="21" />
      </>
    ),
    eyeY: 36,
    mouthY: 47,
  },
};

const INK = "fill-black";
const LINE = "stroke-black";
/** Features turn about their own middle, not the drawing's corner. */
const PIVOT: CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

const still = () =>
  typeof window === "undefined" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  document.hidden;

/**
 * A bot's character. It moves only in short steps on a timer or when something happens, so a
 * sidebar full of them costs nothing between blinks.
 */
export function BotFace(props: {
  readonly face: BotFaceName;
  /** The text colour class its body is drawn in. */
  readonly color: string | undefined;
  readonly mood: BotMood;
  /** Its eyes follow the pointer. For the one large face on a page. */
  readonly follow?: boolean;
  readonly className?: string;
}) {
  const { mood } = props;
  const shape = SHAPES[props.face];
  const shade = `bot-face-${useId().replaceAll(":", "")}`;
  const ref = useRef<SVGSVGElement | null>(null);
  const [blink, setBlink] = useState(false);
  const [beat, setBeat] = useState(0);
  const awake = mood !== "asleep";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- blinks on a timer of its own, which only the browser's clock can drive
  useEffect(() => {
    if (!awake) return;
    let next = 0;
    let open = 0;
    const schedule = () => {
      next = window.setTimeout(
        () => {
          if (!still()) {
            setBlink(true);
            open = window.setTimeout(() => setBlink(false), 130);
          }
          schedule();
        },
        2600 + Math.random() * 3800,
      );
    };
    schedule();
    return () => {
      window.clearTimeout(next);
      window.clearTimeout(open);
    };
  }, [awake]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- steps the working face (glance, thinking dots) on the browser's clock while the bot works
  useEffect(() => {
    if (mood !== "working") return;
    const timer = window.setInterval(() => {
      if (!still()) setBeat((value) => value + 1);
    }, 650);
    return () => window.clearInterval(timer);
  }, [mood]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a short hop when the mood changes, played by the browser on the element itself
  useEffect(() => {
    if (mood === "idle" || mood === "asleep" || still()) return;
    ref.current?.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-10%) scale(1.06)" },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 360, easing: "ease-out" },
    );
  }, [mood]);

  const follows = props.follow === true && (mood === "idle" || mood === "happy");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the pointer, which lives outside React, and writes the glance straight onto the element
  useEffect(() => {
    const element = ref.current;
    if (!follows || element === null) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (still()) return;
        const box = element.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const reach = Math.max(Math.hypot(dx, dy), 1);
        // Half steps: the eyes settle, and a moving pointer rewrites the style a few times only.
        const step = (value: number) => `${Math.round((value / reach) * 2 * 2) / 2}px`;
        element.style.setProperty("--bot-look-x", step(dx));
        element.style.setProperty("--bot-look-y", step(dy));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.cancelAnimationFrame(frame);
      element.style.removeProperty("--bot-look-x");
      element.style.removeProperty("--bot-look-y");
    };
  }, [follows]);

  const glance: CSSProperties =
    mood === "working"
      ? ({
          "--bot-look-x": beat % 2 === 0 ? "-1.8px" : "1.8px",
          "--bot-look-y": "-1.6px",
        } as CSSProperties)
      : {};
  const wide = mood === "waiting";
  const shut = blink;

  const eye = (cx: number) => (
    <g transform={`translate(${cx} ${shape.eyeY})`}>
      {mood === "happy" ? (
        <path
          d="M-5 2q5-7 10 0"
          strokeWidth="2.600"
          strokeLinecap="round"
          fill="none"
          className={LINE}
        />
      ) : mood === "asleep" ? (
        <path
          d="M-5-0.500q5 4.500 10 0"
          strokeWidth="2.400"
          strokeLinecap="round"
          fill="none"
          className={LINE}
        />
      ) : (
        <g
          style={{
            ...PIVOT,
            transform: shut ? "scaleY(0.1)" : "scaleY(1)",
            transition: "transform 90ms ease-out",
          }}
        >
          <ellipse rx="5.400" ry={wide ? 7 : 6.2} className="fill-white" />
          <g
            style={{
              transform: "translate(var(--bot-look-x, 0px), var(--bot-look-y, 0px))",
              transition: "transform 180ms ease-out",
            }}
          >
            <circle r={wide ? 3.3 : 2.9} className={INK} />
            <circle cx="-1" cy="-1.200" r="0.950" className="fill-white" />
          </g>
        </g>
      )}
      {mood === "waiting" ? (
        <path
          d="M-5-10.500q5-3.500 10 0"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          className={LINE}
        />
      ) : mood === "worried" ? (
        <path
          d={cx < 32 ? "M-5-9l10-2.500" : "M5-9l-10-2.500"}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          className={LINE}
        />
      ) : null}
    </g>
  );

  return (
    <svg
      ref={ref}
      viewBox="0 0 64 64"
      aria-hidden
      className={cn("shrink-0 overflow-visible", props.className)}
      style={glance}
      onPointerEnter={(event) => {
        if (still()) return;
        event.currentTarget.animate(
          [
            { transform: "rotate(0)" },
            { transform: "rotate(-9deg)" },
            { transform: "rotate(7deg)" },
            { transform: "rotate(0)" },
          ],
          { duration: 420, easing: "ease-in-out" },
        );
      }}
    >
      <defs>
        <linearGradient id={shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" className="text-white" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0" className="text-white" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.22" className="text-black" />
        </linearGradient>
      </defs>
      <g className={cn("fill-current", props.color)}>{shape.body}</g>
      <g fill={`url(#${shade})`}>{shape.body}</g>
      {mood === "happy" ? (
        <>
          <circle cx="15.500" cy={shape.eyeY + 7.5} r="3.400" className="fill-white/35" />
          <circle cx="48.500" cy={shape.eyeY + 7.5} r="3.400" className="fill-white/35" />
        </>
      ) : null}
      {eye(23)}
      {eye(41)}
      <g transform={`translate(32 ${shape.mouthY})`}>
        {mood === "happy" ? (
          <path d="M-6.500-1.500h13a6.500 6.500 0 0 1-13 0Z" className={INK} />
        ) : mood === "waiting" ? (
          <ellipse rx="2.600" ry="3" className={INK} />
        ) : (
          <path
            d={
              mood === "working"
                ? "M-3.500 0h7"
                : mood === "worried"
                  ? "M-5 2q5-4.500 10 0"
                  : mood === "asleep"
                    ? "M-3 0q3 2.500 6 0"
                    : "M-5-0.500q5 5 10 0"
            }
            strokeWidth="2.400"
            strokeLinecap="round"
            fill="none"
            className={LINE}
          />
        )}
      </g>
      {mood === "waiting" ? (
        <g>
          <circle
            cx="54"
            cy="10"
            r="9"
            strokeWidth="2.500"
            className="fill-warning stroke-background"
          />
          <rect x="52.700" y="4.500" width="2.600" height="7" rx="1.300" className="fill-white" />
          <circle cx="54" cy="14.300" r="1.500" className="fill-white" />
        </g>
      ) : mood === "working" ? (
        <g className="fill-foreground/70">
          {[0, 1, 2].map((dot) => (
            <circle
              key={dot}
              cx={47 + dot * 6.5}
              cy={6 - dot * 1.5}
              r="2.200"
              opacity={beat % 4 > dot ? 1 : 0.25}
            />
          ))}
        </g>
      ) : mood === "asleep" ? (
        <path
          d="M49 4h9l-9 9h9"
          strokeWidth="2.400"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          className="stroke-foreground/55"
        />
      ) : null}
    </svg>
  );
}
