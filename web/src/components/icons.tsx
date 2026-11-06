import type { JSX } from "react";
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const I = {
  files: (p: P) => <Svg {...p}><path d="M2 4.5V12.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3H3a1 1 0 0 0-1 1.5Z" /></Svg>,
  offers: (p: P) => <Svg {...p}><path d="M8.6 2H13a1 1 0 0 1 1 1v4.4a1 1 0 0 1-.3.7l-5.6 5.6a1 1 0 0 1-1.4 0L2.3 9.3a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 .7-.3Z" /><circle cx="11" cy="5" r="1" /></Svg>,
  ops: (p: P) => <Svg {...p}><path d="M1.5 8.5h3l1.5-4 2.5 8 1.8-5.5 1 1.5h3.2" /></Svg>,
  skills: (p: P) => <Svg {...p}><path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2v-9Z" /><path d="M3 11.5a2 2 0 0 1 2-2h7.5" /><path d="M6 5.5h4" /></Svg>,
  board: (p: P) => <Svg {...p}><rect x="2" y="2.5" width="12" height="11" rx="1" /><path d="M6 2.5v11M10 2.5v11" /><path d="M3.3 5h1.4M7.3 5h1.4M7.3 7h1.4M11.3 5h1.4" /></Svg>,
  native: (p: P) => <Svg {...p}><path d="M9.5 2.5c-1.6 0-2 1-2.3 2.5l-1.4 6.5c-.3 1.4-.8 2-2.3 2" /><path d="M4.5 6.5h5" /><path d="M10 9l3 3M13 9l-3 3" /></Svg>,
  toolbox: (p: P) => <Svg {...p}><path d="M10.5 2.5a3 3 0 0 0-3 3.9L2.8 11.1a1.4 1.4 0 0 0 2 2l4.7-4.6a3 3 0 0 0 3.9-3.9l-1.8 1.8-1.7-.4-.4-1.7 1.8-1.8a3 3 0 0 0-.8 0Z" /></Svg>,
  custom: (p: P) => <Svg {...p}><path d="M6.5 2.5h3v1.8a1.2 1.2 0 1 0 2.4 0V2.5H13.5v4h-1.7a1.2 1.2 0 1 0 0 2.4h1.7v4.6h-4v-1.7a1.2 1.2 0 1 0-2.4 0v1.7H2.5V9.5h1.8a1.2 1.2 0 1 0 0-2.4H2.5V2.5h4Z" /></Svg>,
  model: (p: P) => <Svg {...p}><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1" /></Svg>,
  person: (p: P) => <Svg {...p}><circle cx="8" cy="5" r="2.6" /><path d="M2.8 14c.6-2.8 2.6-4.3 5.2-4.3s4.6 1.5 5.2 4.3" /></Svg>,
  play: (p: P) => <Svg {...p}><path d="M4.5 2.8v10.4L13 8 4.5 2.8Z" fill="currentColor" stroke="none" /></Svg>,
  pause: (p: P) => <Svg {...p}><path d="M5 3v10M11 3v10" strokeWidth={2} /></Svg>,
  step: (p: P) => <Svg {...p}><path d="M3.5 3v10L10 8 3.5 3Z" fill="currentColor" stroke="none" /><path d="M12.5 3v10" strokeWidth={1.8} /></Svg>,
  stop: (p: P) => <Svg {...p}><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="currentColor" stroke="none" /></Svg>,
  close: (p: P) => <Svg {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Svg>,
  check: (p: P) => <Svg {...p}><path d="M3 8.5l3 3 7-7" /></Svg>,
  x: (p: P) => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>,
  chevron: (p: P) => <Svg {...p}><path d="M6 3.5L10.5 8 6 12.5" /></Svg>,
  down: (p: P) => <Svg {...p}><path d="M3.5 6L8 10.5 12.5 6" /></Svg>,
  arrow: (p: P) => <Svg {...p}><path d="M2.5 8h11M9 3.5L13.5 8 9 12.5" /></Svg>,
  search: (p: P) => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" /></Svg>,
  sun: (p: P) => <Svg {...p}><circle cx="8" cy="8" r="3" /><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3" /></Svg>,
  moon: (p: P) => <Svg {...p}><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z" /></Svg>,
  code: (p: P) => <Svg {...p}><path d="M5.5 4L1.5 8l4 4M10.5 4l4 4-4 4" /></Svg>,
  download: (p: P) => <Svg {...p}><path d="M8 2v8.5M4.5 7L8 10.5 11.5 7M2.5 13.5h11" /></Svg>,
  folder: (p: P) => <Svg {...p}><path d="M1.8 4.2V12.5a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.2H2.8a1 1 0 0 0-1 1Z" /></Svg>,
  file: (p: P) => <Svg {...p}><path d="M4 1.8h5.2L12.5 5v9a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6A.8.8 0 0 1 4 1.8Z" /><path d="M9 1.8V5.2h3.5" /></Svg>,
  github: (p: P) => <Svg {...p}><path d="M6 13.5c-3 .9-3-1.5-4.2-1.8M10 15v-2.3a2 2 0 0 0-.6-1.6c2-.2 4.1-1 4.1-4.5a3.5 3.5 0 0 0-1-2.4 3.2 3.2 0 0 0 0-2.4s-.8-.2-2.5 1a8.6 8.6 0 0 0-4.5 0C3.8 1.6 3 1.8 3 1.8a3.2 3.2 0 0 0 0 2.4 3.5 3.5 0 0 0-1 2.4c0 3.5 2.1 4.3 4.1 4.5a2 2 0 0 0-.6 1.6V15" /></Svg>,
  key: (p: P) => <Svg {...p}><circle cx="5" cy="11" r="3" /><path d="M7.2 8.8L13.5 2.5M11 5l1.8 1.8M9.5 6.5l1.3 1.3" /></Svg>,
  gear: (p: P) => <Svg {...p}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4" /></Svg>,
  spark: (p: P) => <Svg {...p}><path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6L8 1.5Z" /></Svg>,
  replay: (p: P) => <Svg {...p}><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.3 2.5v2.8h2.8" /></Svg>,
  external: (p: P) => <Svg {...p}><path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></Svg>,
  shield: (p: P) => <Svg {...p}><path d="M8 1.5l5 2v4c0 3.2-2.2 5.6-5 7-2.8-1.4-5-3.8-5-7v-4l5-2Z" /></Svg>,
  warn: (p: P) => <Svg {...p}><path d="M8 2l6.5 11.5h-13L8 2Z" /><path d="M8 6.5v3.2M8 11.6v.1" /></Svg>,
  copy: (p: P) => <Svg {...p}><rect x="5" y="5" width="8.5" height="8.5" rx="1" /><path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5" /></Svg>,
  plus: (p: P) => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>,
  trash: (p: P) => <Svg {...p}><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" /></Svg>,
  menu: (p: P) => <Svg {...p}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></Svg>,
  calendar: (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="11" rx="1" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></Svg>,
};

export function ServerIcon({ server, size = 14 }: { server: string; size?: number }) {
  const C = (I as Record<string, (p: P) => JSX.Element>)[server] ?? I.custom;
  return <C size={size} />;
}

export const SERVER_LABEL: Record<string, string> = {
  files: "Files",
  offers: "Offers",
  ops: "Ops",
  skills: "Skills",
  board: "Board",
  native: "Native",
  toolbox: "Toolbox",
  custom: "Custom",
};
