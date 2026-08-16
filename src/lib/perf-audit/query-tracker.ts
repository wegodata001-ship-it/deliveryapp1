import { PrismaClient } from "@prisma/client";

export type QuerySample = {
  durationMs: number;
  query: string;
};

export type TrackedRun = {
  label: string;
  totalMs: number;
  queryCount: number;
  queryMs: number;
  samples: QuerySample[];
};

export function createTrackedPrisma(): {
  prisma: PrismaClient;
  run: <T>(label: string, fn: (db: PrismaClient) => Promise<T>) => Promise<{ result: T; stats: TrackedRun }>;
  disconnect: () => Promise<void>;
} {
  const base = new PrismaClient({
    log: [{ level: "query", emit: "event" }],
  });

  let activeLabel = "";
  let samples: QuerySample[] = [];
  let queryMs = 0;

  base.$on("query", (event) => {
    if (!activeLabel) return;
    samples.push({
      durationMs: event.duration,
      query: event.query.slice(0, 200),
    });
    queryMs += event.duration;
  });

  async function run<T>(
    label: string,
    fn: (db: PrismaClient) => Promise<T>,
  ): Promise<{ result: T; stats: TrackedRun }> {
    samples = [];
    queryMs = 0;
    activeLabel = label;
    const t0 = performance.now();
    try {
      const result = await fn(base);
      const totalMs = performance.now() - t0;
      return {
        result,
        stats: {
          label,
          totalMs: Math.round(totalMs * 100) / 100,
          queryCount: samples.length,
          queryMs: Math.round(queryMs * 100) / 100,
          samples: [...samples],
        },
      };
    } finally {
      activeLabel = "";
    }
  }

  return {
    prisma: base,
    run,
    disconnect: () => base.$disconnect(),
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 100) / 100
    : sorted[mid]!;
}

export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[idx]! * 100) / 100;
}

export type BenchmarkResult = {
  id: string;
  module: string;
  operation: string;
  coldMs: number;
  warmMedianMs: number;
  warmP95Ms: number;
  coldQueries: number;
  warmMedianQueries: number;
  rowCount?: number;
};

export async function benchmarkOperation(input: {
  id: string;
  module: string;
  operation: string;
  fn: (db: PrismaClient) => Promise<{ rowCount?: number } | void>;
  warmRuns?: number;
  run: <T>(label: string, fn: (db: PrismaClient) => Promise<T>) => Promise<{ result: T; stats: TrackedRun }>;
}): Promise<BenchmarkResult> {
  const warmRuns = input.warmRuns ?? 3;
  const cold = await input.run(`${input.id}:cold`, input.fn);
  const warmStats: TrackedRun[] = [];
  for (let i = 0; i < warmRuns; i++) {
    const warm = await input.run(`${input.id}:warm${i + 1}`, input.fn);
    warmStats.push(warm.stats);
  }
  const rowCount =
    cold.result && typeof cold.result === "object" && cold.result !== null && "rowCount" in cold.result
      ? (cold.result as { rowCount?: number }).rowCount
      : undefined;

  return {
    id: input.id,
    module: input.module,
    operation: input.operation,
    coldMs: cold.stats.totalMs,
    warmMedianMs: median(warmStats.map((s) => s.totalMs)),
    warmP95Ms: p95(warmStats.map((s) => s.totalMs)),
    coldQueries: cold.stats.queryCount,
    warmMedianQueries: median(warmStats.map((s) => s.queryCount)),
    rowCount,
  };
}
