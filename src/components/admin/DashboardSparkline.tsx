type Tone = "blue" | "red" | "green" | "orange";

const STROKE: Record<Tone, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#10b981",
  orange: "#f97316",
};

const FILL: Record<Tone, string> = {
  blue: "rgba(59, 130, 246, 0.12)",
  red: "rgba(239, 68, 68, 0.1)",
  green: "rgba(16, 185, 129, 0.12)",
  orange: "rgba(249, 115, 22, 0.12)",
};

function buildSeries(seed: number, count: number): number[] {
  let x = Math.abs(seed) + 1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(0.15 + (x % 1000) / 1000);
  }
  return out;
}

type Props = { seed: number; tone: Tone; className?: string };

export function DashboardSparkline({ seed, tone, className }: Props) {
  const series = buildSeries(seed, 16);
  const w = 100;
  const h = 22;
  const pad = 2;
  const pts = series.map((v, i) => {
    const px = pad + (i / (series.length - 1)) * (w - pad * 2);
    const py = pad + (1 - v) * (h - pad * 2);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={area} fill={FILL[tone]} />
      <polyline points={line} fill="none" stroke={STROKE[tone]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
