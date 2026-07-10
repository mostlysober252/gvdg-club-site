import React from "react";

export function nextCircularIndex(current, step, length) {
  if (!length) return 0;
  return (current + step + length) % length;
}

export function clampedIndex(index, length) {
  if (!length) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function useSwipe(onSwipe) {
  const touchStartX = React.useRef(0);
  return {
    onTouchEnd: (event) => {
      const touchEndX = event.changedTouches[0]?.screenX || 0;
      const delta = touchStartX.current - touchEndX;
      if (Math.abs(delta) > 50) onSwipe(delta > 0 ? 1 : -1);
    },
    onTouchStart: (event) => {
      touchStartX.current = event.changedTouches[0]?.screenX || 0;
    },
  };
}

export function useRevealOnce({ delay = 0, rootMargin = "0px 0px -50px 0px", threshold = 0.1 } = {}) {
  const ref = React.useRef(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || visible) return undefined;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return undefined;
    }
    let timeoutId = 0;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry || !entry.isIntersecting) return;
      timeoutId = window.setTimeout(() => setVisible(true), delay);
      observer.disconnect();
    }, { rootMargin, threshold });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, [delay, rootMargin, threshold, visible]);

  return [ref, visible];
}

export function useAnimatedCount(target, visible, duration = 2000) {
  const [value, setValue] = React.useState(0);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!visible || started.current) return undefined;
    started.current = true;
    const start = performance.now();
    let frameId = 0;
    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) frameId = window.requestAnimationFrame(update);
      else setValue(target);
    }
    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, target, visible]);

  return value;
}
