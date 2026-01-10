import { ReactNode } from 'react';

type WidgetComponent<Props extends object> = (props: Props & { 
    availableWidth: number, availableHeight: number, value: number, 
    highlight: string, unit?: string
  }) => ReactNode

export type WidgetSpec<K extends string, Specs extends object, Props extends object = { }> = {
  Component: WidgetComponent<Props>
  kind: K, 
  specs: Specs & { id: string, label: string, unit?: string, highlight?: HighlightConditions }
} & ([keyof Props] extends [never] 
    ? { loadSpecificProps: (specs?: Specs) => Props } 
    : { loadSpecificProps: (specs: Specs) => Props }
  )

type HighlightRange = { start: number } | { end: number } | { start: number, end: number }
export type HighlightConditions = Record<string, (number | HighlightRange)[]>

export type Widget<K extends string, Props extends object = { }> = {
  id: string;
  name: string;
  unit?: string;
  value: number;
  kind: K;
  highlight?: HighlightConditions;
  x: number;
  y: number;
  w: number;
  h: number;
  mw: number;
  mh: number;
  rx: number;
  ry: number;
  z: number;
  specificProps: Props;
  Component: WidgetComponent<Props>;
};

export type WidgetBase = Widget<any, any>;
export type WidgetSpecBase = WidgetSpec<any, any, any>;

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}