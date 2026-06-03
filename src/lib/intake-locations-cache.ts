import {
  ensureIntakeLocationTableSchema,
  getIntakeLocationRowCount,
  listIntakeLocationsForSelect,
  type IntakeLocationListRow,
} from "@/lib/intake-location";
import { intakeLocationsPerfLog } from "@/lib/intake-locations-perf";

const TTL_MS = 300_000;
const FULL_LIST_CAP = 500;

type ListCache = { rows: IntakeLocationListRow[]; expires: number };
type CountCache = { count: number; expires: number };

const GLOBAL_KEY = "__wegoIntakeLocationsCache";

type IntakeLocationsCacheGlobal = {
  fullList: ListCache | null;
  fullListInFlight: Promise<IntakeLocationListRow[]> | null;
  rowCount: CountCache | null;
  rowCountInFlight: Promise<number> | null;
};

function getCacheState(): IntakeLocationsCacheGlobal {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: IntakeLocationsCacheGlobal };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      fullList: null,
      fullListInFlight: null,
      rowCount: null,
      rowCountInFlight: null,
    };
  }
  return g[GLOBAL_KEY];
}

/** מספר רשומות בטבלה — נשמר בזיכרון 5 דק׳ (לקביעת limit). */
export async function getIntakeLocationRowCountCached(): Promise<number> {
  const state = getCacheState();
  const now = Date.now();
  if (state.rowCount && state.rowCount.expires > now) {
    return state.rowCount.count;
  }
  if (state.rowCountInFlight) return state.rowCountInFlight;

  state.rowCountInFlight = (async () => {
    try {
      const count = await getIntakeLocationRowCount();
      state.rowCount = { count, expires: Date.now() + TTL_MS };
      intakeLocationsPerfLog("row count", { count, useFullCap: count >= 100 });
      return count;
    } finally {
      state.rowCountInFlight = null;
    }
  })();

  return state.rowCountInFlight;
}

function resolveListLimit(requestedLimit: number, rowCount: number, hasQuery: boolean): number {
  if (hasQuery) return Math.min(120, Math.max(1, Math.floor(requestedLimit)));
  if (rowCount < 100) return Math.max(1, rowCount);
  return Math.min(FULL_LIST_CAP, Math.max(1, Math.floor(requestedLimit)));
}

/** רשימה מלאה (ללא q) — cache בזיכרון תהליך 5 דק׳ */
export async function listIntakeLocationsForSelectCached(
  query: string,
  requestedLimit: number,
): Promise<IntakeLocationListRow[]> {
  const q = query.trim();
  const rowCount = await getIntakeLocationRowCountCached();
  const take = resolveListLimit(requestedLimit, rowCount, Boolean(q));

  if (q) {
    return listIntakeLocationsForSelect(q, take);
  }

  const state = getCacheState();
  const now = Date.now();
  if (state.fullList && state.fullList.expires > now) {
    return state.fullList.rows.slice(0, take);
  }

  if (state.fullListInFlight) {
    const rows = await state.fullListInFlight;
    return rows.slice(0, take);
  }

  const fetchTake = rowCount < 100 ? rowCount : FULL_LIST_CAP;

  state.fullListInFlight = (async () => {
    try {
      const rows = await listIntakeLocationsForSelect("", fetchTake);
      state.fullList = { rows, expires: Date.now() + TTL_MS };
      intakeLocationsPerfLog("full list cached", { rowCount, fetchTake, returned: rows.length });
      return rows;
    } finally {
      state.fullListInFlight = null;
    }
  })();

  const rows = await state.fullListInFlight;
  return rows.slice(0, take);
}

export function invalidateIntakeLocationsListCache(): void {
  const state = getCacheState();
  state.fullList = null;
  state.fullListInFlight = null;
  state.rowCount = null;
  state.rowCountInFlight = null;
}
