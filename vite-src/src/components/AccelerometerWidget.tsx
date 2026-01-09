import {
  clamp, polarToCartesian, describeArc, 
  isNonEmptyString, HighlightConditions, WidgetKind
} from "./widget-common";

export function AccelerometerWidget({
  unit,
  value,
  availableWidth,
  availableHeight,
  highlight, 
  scale
}: {
  unit?: string;
  value: number;
  availableWidth: number;
  availableHeight: number;
  highlight: string;
  scale: number;
}) {
  const VIEW = 200;

  const rawAspect =
    availableWidth > 0 && availableHeight > 0 ? availableWidth / availableHeight : 1;
  const aspect = clamp(rawAspect, 0.6, 1.8);

  const viewW = aspect >= 1 ? VIEW * aspect : VIEW;
  const viewH = aspect < 1 ? VIEW / aspect : VIEW;

  const tx = (viewW - VIEW) / 2;
  const ty = (viewH - VIEW) / 2;

  const cx = 100;
  const cy = 98;

  const valueMin = 0;
  const valueMax = 8000;
  const clampedValue = clamp(value, valueMin, valueMax);
  const t = (clampedValue - valueMin) / (valueMax - valueMin);

  const startAngle = -130;
  const endAngle = 130;
  const angle = startAngle + t * (endAngle - startAngle);

  const rOuter = 90;
  const rTickOuter = 92;
  const rTickInnerMajor = 74;
  const rTickInnerMinor = 81;
  const arcStroke = 7;

  const majorTicks = 9;
  const minorPerStep = 1;

  const needleX = polarToCartesian(cx, cy, 68, angle).x;
  const needleY = polarToCartesian(cx, cy, 68, angle).y;

  const redlineFrom = 6500;
  const redT0 = (redlineFrom - valueMin) / (valueMax - valueMin);
  const redStart = startAngle + redT0 * (endAngle - startAngle);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        width="100%"
        height="100%"
        aria-label="RPM accelerometer style gauge"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <defs>
          <radialGradient id="dial" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.22)" />
          </radialGradient>
        </defs>

        <g transform={`translate(${tx} ${ty})`}>
          <circle cx={cx} cy={cy} r={rOuter} fill="url(#dial)" stroke="rgba(255,255,255,0.14)" />

          <path
            d={describeArc(cx, cy, rOuter, startAngle, endAngle)}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={arcStroke}
            strokeLinecap="round"
          />

          <path
            d={describeArc(cx, cy, rOuter, redStart, endAngle)}
            fill="none"
            stroke="rgba(239,68,68,0.95)"
            strokeWidth={arcStroke}
            strokeLinecap="round"
          />

          {Array.from({ length: majorTicks }).map((_, i) => {
            const a = startAngle + (i / (majorTicks - 1)) * (endAngle - startAngle);
            const p1 = polarToCartesian(cx, cy, rTickOuter, a);
            const p2 = polarToCartesian(cx, cy, rTickInnerMajor, a);
            const pl = polarToCartesian(cx, cy, 56, a);
            return (
              <g key={`maj-${i}`}>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="rgba(255,255,255,0.70)"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                <text
                  x={pl.x}
                  y={pl.y}
                  fill="rgba(255,255,255,0.80)"
                  fontSize={12}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {i}
                </text>
              </g>
            );
          })}

          {Array.from({ length: (majorTicks - 1) * minorPerStep }).map((_, i) => {
            const frac = (i + 1) / ((majorTicks - 1) * (minorPerStep + 0));
            const a = startAngle + frac * (endAngle - startAngle);
            const p1 = polarToCartesian(cx, cy, rTickOuter, a);
            const p2 = polarToCartesian(cx, cy, rTickInnerMinor, a);
            return (
              <line
                key={`min-${i}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}

          <g>
            <line
              x1={cx}
              y1={cy}
              x2={needleX}
              y2={needleY}
              stroke="rgba(255,255,255,0.90)"
              strokeWidth={3}
              strokeLinecap="round"
              style={{ transition: "all 160ms ease" }}
            />
            <circle cx={cx} cy={cy} r={8} fill="rgba(255,255,255,0.85)" />
            <circle cx={cx} cy={cy} r={4} fill="rgba(0,0,0,0.30)" />
          </g>

          <text x={cx} y={156} 
            fill={highlight || "rgba(255,255,255,0.92)"} 
            fontSize={22} fontWeight={800} textAnchor="middle"
          >
            {Math.round(clampedValue)}
          </text>
          <text x={cx} y={172} fill="rgba(255,255,255,0.68)" fontSize={12} fontWeight={700} textAnchor="middle">
            {unit}
          </text>
          <text x={cx} y={186} fill="rgba(255,255,255,0.55)" fontSize={11} fontWeight={600} textAnchor="middle">
            ×{`${scale}`} scale
          </text>
        </g>
      </svg>
    </div>
  );
}

export function parseAccelerometer(input: Record<string, unknown>): 
  WidgetKind<'accelerometer', { scale: number }, { scale: number }>
{
  const id = isNonEmptyString(input.id) ? input.id.trim() : "";

  const label = isNonEmptyString(input.label) ? input.label.trim() : id;
  const unit = isNonEmptyString(input.unit) ? input.unit.trim() : undefined;
  var scale: number = 1;
  if (typeof input.scale === 'number') scale = input.scale || 1;
  if (typeof input.scale === 'string') {
    scale = Number(input.scale);
    if (Number.isNaN(scale)) scale = 1;
  }
  
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
      highlight, 
      scale
    }, 
    kind: 'accelerometer', 
    Component: AccelerometerWidget, 
    loadSpecificProps: (specs)=>({ scale: specs.scale })
  } as const;
}