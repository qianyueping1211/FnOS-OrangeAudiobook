import React, { useEffect, useRef, useState } from 'react';

interface MarqueeTextProps {
  text: string;
  /** Tailwind classes for the visible line; the wrapper stays one line. */
  className?: string;
}

/**
 * A single line of text that never wraps. When the text is wider than the line
 * it slides back and forth slowly instead of ellipsizing, so long chapter names
 * stay readable without changing the player layout.
 */
const MarqueeText: React.FC<MarqueeTextProps> = ({ text, className }) => {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const overflow = inner.scrollWidth - outer.clientWidth;
      setShift(overflow > 4 ? overflow : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [text]);

  const style = shift > 0
    ? ({ '--reader-marquee-shift': `-${shift}px`, '--reader-marquee-duration': `${Math.min(18, Math.max(6, shift / 14))}s` } as React.CSSProperties)
    : undefined;

  return (
    <span ref={outerRef} className="reader-marquee" title={text}>
      <span
        ref={innerRef}
        className={`reader-marquee-inner${shift > 0 ? ' is-scrolling' : ''} ${className ?? ''}`.trim()}
        style={style}
      >
        {text}
      </span>
    </span>
  );
};

export default MarqueeText;
