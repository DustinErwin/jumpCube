import { useEffect, useRef, useState } from "react";

/*
 * useFadeIn() returns [ref, show] for simple intersection-triggered reveals.
 *
 * Argument:
 * - options: IntersectionObserver options, e.g. { threshold: 0.5 }
 *
 * Usage:
 * const [ref, show] = useFadeIn();
 * <section ref={ref} className={show ? "visible" : ""} />
 */
export default function useFadeIn(options = {}) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Once the element intersects, show stays true and the observer disconnects.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, ...options }
    );

    if (ref.current) observer.observe(ref.current);

    return () => observer.disconnect();
  }, [options]);

  return [ref, show];
}
