import { useId } from "react";

/**
 * Brand mark: a monoline "GS" in a drop of liquid brand orange. Glossy top highlight,
 * a warm glow pooling at the bottom and a light-catching rim make it read as liquid glass.
 */
export function LogoMark({ className = "size-8", inverted }: { className?: string; inverted?: boolean }) {
  // Gradient ids must be unique per instance on the page.
  const id = useId().replace(/:/g, "");
  const ink = inverted ? "var(--color-accent)" : "#fff";
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Good Screen">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={inverted ? "#ffffff" : "#ffb070"} />
          <stop offset="0.5" stopColor={inverted ? "#f4f4f5" : "#ff6b1a"} />
          <stop offset="1" stopColor={inverted ? "#e4e4e7" : "#d9430a"} />
        </linearGradient>
        <radialGradient id={`${id}-pool`} cx="0.5" cy="1" r="0.7">
          <stop offset="0" stopColor="#ffe2c4" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffe2c4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill={`url(#${id}-body)`} />
      <rect width="32" height="32" rx="10" fill={`url(#${id}-pool)`} />
      {/* Gloss: a soft lens across the top, like light on a drop of liquid. */}
      <path d="M4 9.5C4 6.2 6.7 3.5 10 3.5h12c3.3 0 6 2.7 6 6 0 1.2-4.5 3.2-12 3.2S4 10.7 4 9.5z" fill={`url(#${id}-gloss)`} />
      <rect x="0.4" y="0.4" width="31.2" height="31.2" rx="9.6" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="0.8" />
      {/* G and S, one stroke weight, round ends. */}
      <g fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.2 12.5A5.5 5.5 0 1 0 17.5 16H13.4" />
        <path d="M25.7 12.2C25 10.9 23.8 10.5 22.6 10.5 20.9 10.5 19.8 11.5 19.8 12.9 19.8 14.4 21.1 15 22.7 15.6 24.4 16.2 25.8 16.9 25.8 18.8 25.8 20.4 24.5 21.5 22.6 21.5 21.2 21.5 20 20.9 19.4 19.7" />
      </g>
    </svg>
  );
}
