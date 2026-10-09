import type { ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { readonly size?: number };

/** Base for the line icons: 24-unit viewBox, 2px round strokes, current text color. Decorative unless labelled. */
export function createIcon(displayName: string, paths: ReactNode) {
  function IconComponent({ size = 16, ...props }: IconProps) {
    const labelled = props['aria-label'] !== undefined;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        role={labelled ? 'img' : undefined}
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  IconComponent.displayName = displayName;
  return IconComponent;
}
