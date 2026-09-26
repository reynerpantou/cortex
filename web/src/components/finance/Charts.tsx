import { useEffect, useRef, useState } from "react";

// Categorical slots validated (CVD + normal-vision + 3:1 contrast) against
// Cortex's dark card surface #1e212a, assigned in fixed order. "Other" is a
// neutral fold, not a hue, so it also carries a hatch texture — never color alone.
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
export const OTHER_COLOR = "#6b7285";
export const INCOME_COLOR = "#199e70";
export const EXPENSE_COLOR = "#d95926";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  hatched?: boolean;
}

interface DonutProps {
  slices: Slice[];
  total: number;
  centerLabel: string;
  format: (v: number) => string;
  active: string | null;
  onHover: (key: string | null) => void;
  onSelect?: (key: string) => void;
}

const CX = 110;
const CY = 110;
const R_OUT = 100;
const R_IN = 68;

function arcPath(start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${CX + r * Math.sin(a)} ${CY - r * Math.cos(a)}`;
  return [
    `M ${p(R_OUT, start)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${p(R_OUT, end)}`,
    `L ${p(R_IN, end)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${p(R_IN, start)}`,
    "Z",
  ].join(" ");
}

const pctText = (part: number, whole: number) => {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
};

export function Donut({ slices, total, centerLabel, format, active, onHover, onSelect }: DonutProps) {
  const visible = slices.filter((s) => s.value > 0);
  const hovered = visible.find((s) => s.key === active) ?? null;
  let angle = 0;

  return (
    <svg className="donut" viewBox="0 0 220 220" role="img" aria-label={centerLabel}>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={OTHER_COLOR} />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa0b1" strokeWidth="2" />
        </pattern>
      </defs>
      {visible.length === 1 ? (
        <circle
          cx={CX}
          cy={CY}
          r={(R_OUT + R_IN) / 2}
          fill="none"
          stroke={visible[0].hatched ? "url(#hatch)" : visible[0].color}
          strokeWidth={R_OUT - R_IN}
          onMouseEnter={() => onHover(visible[0].key)}
          onMouseLeave={() => onHover(null)}
          onClick={() => onSelect?.(visible[0].key)}
          style={{ cursor: onSelect ? "pointer" : "default" }}
        />
      ) : (
        visible.map((s) => {
          const start = angle;
          const end = angle + (s.value / total) * Math.PI * 2;
          angle = end;
          return (
            <path
              key={s.key}
              d={arcPath(start, end)}
              fill={s.hatched ? "url(#hatch)" : s.color}
              stroke="var(--bg-1)"
              strokeWidth={2}
              opacity={active && active !== s.key ? 0.45 : 1}
              onMouseEnter={() => onHover(s.key)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect?.(s.key)}
              style={{ cursor: onSelect ? "pointer" : "default", transition: "opacity 0.12s ease" }}
            >
              <title>{`${s.label}: ${format(s.value)} (${pctText(s.value, total)})`}</title>
            </path>
          );
        })
      )}
      <text x={CX} y={CY - 8} textAnchor="middle" className="donut-center-label">
        {hovered ? hovered.label : centerLabel}
      </text>
      <text x={CX} y={CY + 16} textAnchor="middle" className="donut-center-value">
        {format(hovered ? hovered.value : total)}
      </text>
      {hovered && (
        <text x={CX} y={CY + 34} textAnchor="middle" className="donut-center-pct">
          {pctText(hovered.value, total)}
        </text>
      )}
    </svg>
  );
}

interface TrendProps {
  points: { label: string; income: number; expense: number }[];
  incomeLabel: string;
  expenseLabel: string;
  netLabel: string;
  format: (v: number) => string;
  compact: (v: number) => string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

// Grouped bars (income vs expense per month) on one shared axis, with a
// per-month hover tooltip. Thin bars, 4px rounded tops anchored to the
// baseline, hairline gridlines.
export function TrendChart({ points, incomeLabel, expenseLabel, netLabel, format, compact }: TrendProps) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width (not a scaled viewBox) so tick labels
  // stay legible on a phone instead of shrinking with the chart.
  const plotRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 28;
  const max = niceMax(Math.max(0, ...points.flatMap((p) => [p.income, p.expense])));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const groupW = plotW / Math.max(points.length, 1);
  const barW = Math.min(18, groupW / 3.2);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];

  const bar = (x: number, v: number, color: string) => {
    const h = Math.max(0, (v / max) * plotH);
    if (h <= 0) return null;
    const r = Math.min(4, h, barW / 2);
    const top = PAD_T + plotH - h;
    const bottom = PAD_T + plotH;
    return (
      <path
        d={`M ${x} ${bottom} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + barW - r} ${top} Q ${x + barW} ${top} ${x + barW} ${top + r} L ${x + barW} ${bottom} Z`}
        fill={color}
      />
    );
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="trend">
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-swatch" style={{ background: INCOME_COLOR }} />{incomeLabel}</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: EXPENSE_COLOR }} />{expenseLabel}</span>
      </div>
      <div className="trend-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="trend-svg" role="img" aria-label={`${incomeLabel} / ${expenseLabel}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(tk)} y2={y(tk)} className={tk === 0 ? "chart-baseline" : "chart-grid"} />
              <text x={PAD_L - 8} y={y(tk) + 4} textAnchor="end" className="chart-tick">{compact(tk)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const gx = PAD_L + i * groupW;
            const cx = gx + groupW / 2;
            return (
              <g key={p.label}>
                {hover === i && <rect x={gx + 2} y={PAD_T} width={groupW - 4} height={plotH} className="chart-hover-band" />}
                {bar(cx - barW - 1, p.income, INCOME_COLOR)}
                {bar(cx + 1, p.expense, EXPENSE_COLOR)}
                <text x={cx} y={H - 8} textAnchor="middle" className="chart-tick">{p.label}</text>
                <rect
                  x={gx}
                  y={PAD_T}
                  width={groupW}
                  height={plotH + PAD_B}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  aria-label={`${p.label}: ${incomeLabel} ${format(p.income)}, ${expenseLabel} ${format(p.expense)}`}
                />
              </g>
            );
          })}
        </svg>
        {hp && hover !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${((PAD_L + (hover + 0.5) * groupW) / W) * 100}%` }}
          >
            <div className="chart-tooltip-title">{hp.label}</div>
            <div className="chart-tooltip-row"><span className="legend-swatch" style={{ background: INCOME_COLOR }} />{incomeLabel}<strong>{format(hp.income)}</strong></div>
            <div className="chart-tooltip-row"><span className="legend-swatch" style={{ background: EXPENSE_COLOR }} />{expenseLabel}<strong>{format(hp.expense)}</strong></div>
            <div className="chart-tooltip-row chart-tooltip-net">{netLabel}<strong>{format(hp.income - hp.expense)}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
