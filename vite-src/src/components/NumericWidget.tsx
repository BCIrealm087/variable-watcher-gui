import {
  clamp, isNonEmptyString, HighlightConditions, 
  WidgetKind
} from "./widget-common";

export function NumericWidget({
  unit,
  value,
  availableWidth,
  availableHeight,
  highlight
}: {
  unit?: string;
  value: number;
  availableWidth: number;
  availableHeight: number;
  highlight: string;
}) {
  const minDim = Math.max(0, Math.min(availableWidth, availableHeight));
  const s = clamp(minDim / 160, 0.75, 1.8);

  const valueFont = clamp(44 * s, 22, 96);
  const unitFont = clamp(13 * s, 10, 22);
  const gap = clamp(10 * s, 6, 18);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: valueFont,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: -0.8,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: highlight || undefined
        }}
      >
        {Number.isFinite(value) ? value.toFixed(1) : "—"}
      </div>
      <div style={{ marginTop: gap, fontSize: unitFont, opacity: 0.75 }}>{unit}</div>
    </div>
  );
}

export function parseNumeric(input: Record<string, unknown>): 
  WidgetKind<'number', { }, { }>
{
  const id = isNonEmptyString(input.id) ? input.id.trim() : "";

  const label = isNonEmptyString(input.label) ? input.label.trim() : id;
  const unit = isNonEmptyString(input.unit) ? input.unit.trim() : undefined;
  
  let highlight = typeof input.highlight === 'object'
    && input.highlight !== null && !Array.isArray(input.highlight)
    ? input.highlight as HighlightConditions : undefined;
  if (highlight && Object.values(highlight).some(v=>!Array.isArray(v))) {
    highlight = undefined
  }
  return {
    specs: {
      id, 
      label, 
      unit, 
      highlight
    }, 
    kind: 'number', 
    Component: NumericWidget, 
    loadSpecificProps: (_)=> ({ })
  } as const;
}