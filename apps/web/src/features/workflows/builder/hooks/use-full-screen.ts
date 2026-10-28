import { type RefObject, useEffect, useState } from 'react';

export interface FullScreen {
  readonly active: boolean;
  readonly toggle: () => void;
}

/**
 * Full screen for one element, which must outlive what it holds: the builder starts over on every new draft (from the
 * AI, a template or a publication), and the browser leaves full screen as soon as the element in it is removed.
 */
export function useFullScreen(host: RefObject<HTMLElement | null>): FullScreen {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === host.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [host]);
  const toggle = () => {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void host.current?.requestFullscreen?.();
  };
  return { active, toggle };
}
