import type { ReactNode, SVGProps } from "react";
import "./fortix-icon.css";

/** Utility symbols, never a FortiX identity mark or an evidence assertion. */
export type FortixIconName =
  | "arrowRight" | "external" | "menu" | "close" | "sun" | "moon"
  | "inspect" | "analyze" | "receipt" | "boundary" | "authority"
  | "execution" | "payment" | "network" | "chevronDown";

const paths: Record<FortixIconName, ReactNode> = {
  arrowRight: <path d="M4 12h16m-6-6 6 6-6 6" />,
  external: <><path d="M13 4h7v7M20 4l-9 9" /><path d="M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20 14.8A8.6 8.6 0 0 1 9.2 4 8.6 8.6 0 1 0 20 14.8Z" />,
  inspect: <><path d="M6 5h12M6 9h9M6 13h6M3 17h18" /><circle cx="18" cy="21" r="1" fill="currentColor" stroke="none" /></>,
  analyze: <path d="M4 7h15v10H4M4 12h8" />,
  receipt: <><path d="M8 6h12M8 12h9M8 18h6" /><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" /></>,
  boundary: <rect x="3" y="4" width="18" height="16" rx="2" />,
  authority: <path d="M4 6h16M4 12h11M4 18h16" />,
  execution: <path d="M19 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13M9 12h12" />,
  payment: <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />,
  network: <path d="M4 20v-4h2v4Zm5 0v-8h2v8Zm5 0V8h2v12Zm5 0V4h2v16Z" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
};

type FortixIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: FortixIconName;
  size?: number;
};

/** Inherits semantic color from the labelled control; decorative by default. */
export function FortixIcon({ name, size = 20, className, ...props }: FortixIconProps) {
  return <svg
    viewBox="0 0 24 24" width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round" focusable="false"
    aria-hidden={props["aria-label"] ? undefined : true}
    className={`fortix-icon${className ? ` ${className}` : ""}`}
    data-fortix-icon={name} {...props}
  >{paths[name]}</svg>;
}
