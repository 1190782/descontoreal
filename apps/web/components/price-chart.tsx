"use client";

import { type ChartSegment, type ChartSeries, DAY_MS, formatCents, TIME_ZONE } from "@descontoreal/core";
import { type PointerEvent, type ReactElement, useEffect, useRef, useState } from "react";

interface Range {
  key: string;
  label: string;
  days: number | null;
}

const RANGES: readonly Range[] = [
  { key: "1m", label: "1M", days: 30 },
  { key: "3m", label: "3M", days: 90 },
  { key: "6m", label: "6M", days: 180 },
  { key: "tudo", label: "Tudo", days: null },
];
const ALL_TIME = RANGES[RANGES.length - 1] ?? { key: "tudo", label: "Tudo", days: null };

// Drawn at the measured width of its box, 1:1, so the text stays 12px on any screen; this width is the first render's.
const INITIAL_WIDTH = 640;
const HEIGHT = 260;
// Below this width the legend alone names the lines: labels at their ends would squeeze the plot.
const NARROW_WIDTH = 480;
const MARGIN = { top: 16, bottom: 30, left: 56 };
const LABELS_MARGIN = 112;
const NARROW_MARGIN = 12;
const INNER_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const X_TICKS = 4;
const Y_TICKS = 4;
const LABEL_GAP = 16;

const AXIS_PRICE = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const AXIS_DATE = new Intl.DateTimeFormat("pt-PT", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const TOOLTIP_DATE = new Intl.DateTimeFormat("pt-PT", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

interface Props {
  series: ChartSeries[];
  /** Epoch ms of the render: the right edge of the chart. */
  now: number;
  colors: Readonly<Record<string, string>>;
}

/**
 * Price history, a step line per listing: prices hold until they change, so steps are the truthful shape. Dashed
 * where the store had no stock. The table of stores and the summary under the chart carry the same data in text.
 */
export function PriceChart({ series, now, colors }: Props): ReactElement | null {
  const earliest = Math.min(...series.flatMap((line) => line.segments.map((segment) => segment.from)));
  const historyDays = (now - earliest) / DAY_MS;
  const ranges = RANGES.filter((range) => range.days === null || range.days < historyDays);
  const [rangeKey, setRangeKey] = useState(historyDays > 90 ? "3m" : ALL_TIME.key);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) {
        setWidth(Math.round(entry.contentRect.width));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (series.length === 0 || !Number.isFinite(earliest)) {
    return null;
  }

  const narrow = width < NARROW_WIDTH;
  const right = narrow ? NARROW_MARGIN : LABELS_MARGIN;
  const innerWidth = width - MARGIN.left - right;

  const range = ranges.find((candidate) => candidate.key === rangeKey) ?? ALL_TIME;
  const start = range.days === null ? earliest : Math.max(earliest, now - range.days * DAY_MS);
  const span = Math.max(now - start, 1);
  const visible = series.map((line) => ({
    ...line,
    segments: line.segments.filter((segment) => segment.to >= start),
  }));
  const prices = visible.flatMap((line) => line.segments.map((segment) => segment.priceCents));
  const [low, high] = paddedDomain(Math.min(...prices), Math.max(...prices));
  const x = (time: number): number => MARGIN.left + ((Math.max(time, start) - start) / span) * innerWidth;
  const y = (cents: number): number => MARGIN.top + ((high - cents) / (high - low)) * INNER_HEIGHT;
  const yTicks = niceTicks(low, high);
  const xTicks = Array.from({ length: X_TICKS }, (_, index) => start + (span * index) / (X_TICKS - 1));
  const labels = narrow ? [] : directLabels(visible, y);
  const hasGaps = visible.some((line) => line.segments.some((segment) => !segment.inStock));

  function onPointerMove(event: PointerEvent<SVGRectElement>): void {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (bounds === undefined || bounds.width === 0) {
      return;
    }
    const position = ((event.clientX - bounds.left) / bounds.width) * width;
    const ratio = Math.min(Math.max((position - MARGIN.left) / innerWidth, 0), 1);
    setHover(start + ratio * span);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700" aria-label="Legenda">
          {series.length > 1
            ? series.map((line) => (
                <li key={line.listingId} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-4"
                    style={{ backgroundColor: colors[line.storeSlug] }}
                  />
                  {line.storeName}
                </li>
              ))
            : null}
          {hasGaps ? (
            <li className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-slate-500" />
              sem stock
            </li>
          ) : null}
        </ul>
        {ranges.length > 1 ? (
          <div role="group" aria-label="Período do gráfico" className="flex gap-1">
            {ranges.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                aria-pressed={candidate.key === range.key}
                onClick={() => setRangeKey(candidate.key)}
                className="rounded-md px-2.5 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-300 aria-pressed:bg-slate-900 aria-pressed:text-white aria-pressed:ring-slate-900"
              >
                {candidate.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div ref={box} className="relative">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="w-full"
          style={{ height: HEIGHT }}
          role="img"
          aria-label="Gráfico do histórico de preços em cada loja"
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + innerWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#e2e8f0"
              />
              <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="12" fill="#475569">
                {AXIS_PRICE.format(tick / 100)}
              </text>
            </g>
          ))}
          {xTicks.map((tick, index) => (
            <text
              key={tick}
              x={x(tick)}
              y={HEIGHT - 8}
              textAnchor={index === 0 ? "start" : index === X_TICKS - 1 ? "end" : "middle"}
              fontSize="12"
              fill="#475569"
            >
              {AXIS_DATE.format(tick)}
            </text>
          ))}
          {visible.map((line) => {
            const paths = stepPaths(line.segments, x, y);
            const color = colors[line.storeSlug] ?? "#475569";
            const current = line.segments.at(-1);
            return (
              <g key={line.listingId}>
                <path d={paths.inStock} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
                <path d={paths.outOfStock} fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
                {current !== undefined && current.to === now ? (
                  <circle
                    cx={x(now)}
                    cy={y(current.priceCents)}
                    r="4"
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                ) : null}
              </g>
            );
          })}
          {labels.map((label) => (
            <g key={label.listingId}>
              <line
                x1={MARGIN.left + innerWidth + 8}
                x2={MARGIN.left + innerWidth + 18}
                y1={label.y}
                y2={label.y}
                stroke={colors[label.storeSlug] ?? "#475569"}
                strokeWidth="2"
              />
              <text x={MARGIN.left + innerWidth + 22} y={label.y} dy="0.32em" fontSize="12" fill="#0f172a">
                {label.storeName}
              </text>
            </g>
          ))}
          {hover === null ? null : (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={MARGIN.top}
              y2={MARGIN.top + INNER_HEIGHT}
              stroke="#94a3b8"
            />
          )}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={innerWidth}
            height={INNER_HEIGHT}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover === null ? null : (
          <Tooltip time={hover} series={visible} colors={colors} left={(x(hover) / width) * 100} />
        )}
      </div>
    </div>
  );
}

function Tooltip({
  time,
  series,
  colors,
  left,
}: {
  time: number;
  series: readonly ChartSeries[];
  colors: Readonly<Record<string, string>>;
  /** Percent of the chart's width. */
  left: number;
}): ReactElement {
  return (
    <div
      className="pointer-events-none absolute top-2 w-48 rounded-md border border-slate-200 bg-white p-2 text-sm shadow-md"
      style={left > 55 ? { right: `${100 - left + 2}%` } : { left: `${left + 2}%` }}
    >
      <p className="font-medium text-slate-900">{TOOLTIP_DATE.format(time)}</p>
      <ul>
        {series.map((line) => {
          const segment = segmentAt(line.segments, time);
          return (
            <li key={line.listingId} className="flex items-center justify-between gap-2 text-slate-700">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: colors[line.storeSlug] }}
                />
                {line.storeName}
              </span>
              <span className="font-medium text-slate-900">
                {segment === undefined ? "—" : formatCents(segment.priceCents)}
                {segment !== undefined && !segment.inStock ? " (sem stock)" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Horizontal runs at each price, joined by vertical steps where one interval starts as the previous ends. */
function stepPaths(
  segments: readonly ChartSegment[],
  x: (time: number) => number,
  y: (cents: number) => number,
): { inStock: string; outOfStock: string } {
  let inStock = "";
  let outOfStock = "";
  let previous: ChartSegment | undefined;
  for (const segment of segments) {
    const run = `M${x(segment.from)} ${y(segment.priceCents)}H${x(segment.to)}`;
    if (segment.inStock) {
      inStock += run;
    } else {
      outOfStock += run;
    }
    if (previous !== undefined && previous.to === segment.from) {
      inStock += `M${x(segment.from)} ${y(previous.priceCents)}V${y(segment.priceCents)}`;
    }
    previous = segment;
  }
  return { inStock, outOfStock };
}

function segmentAt(segments: readonly ChartSegment[], time: number): ChartSegment | undefined {
  return segments.find((segment) => segment.from <= time && time <= segment.to);
}

/** Store names at the right end of their lines, pushed apart so they never overlap. */
function directLabels(
  series: readonly ChartSeries[],
  y: (cents: number) => number,
): { listingId: number; storeSlug: string; storeName: string; y: number }[] {
  const labels = series
    .flatMap((line) => {
      const last = line.segments.at(-1);
      return last === undefined
        ? []
        : [
            {
              listingId: line.listingId,
              storeSlug: line.storeSlug,
              storeName: line.storeName,
              y: y(last.priceCents),
            },
          ];
    })
    .sort((a, b) => a.y - b.y);
  for (let index = 1; index < labels.length; index += 1) {
    const above = labels[index - 1];
    const label = labels[index];
    if (above !== undefined && label !== undefined && label.y - above.y < LABEL_GAP) {
      label.y = above.y + LABEL_GAP;
    }
  }
  return labels;
}

/** A price range with room above and below, so a flat line does not sit on the edge. */
function paddedDomain(min: number, max: number): [number, number] {
  const padding = Math.max((max - min) * 0.15, max * 0.03, 100);
  return [Math.max(0, min - padding), max + padding];
}

/** About Y_TICKS round prices (steps of 1, 2 or 5 × 10ⁿ cents) inside [low, high]. */
function niceTicks(low: number, high: number): number[] {
  const rough = (high - low) / Y_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step) {
    ticks.push(tick);
  }
  return ticks;
}
