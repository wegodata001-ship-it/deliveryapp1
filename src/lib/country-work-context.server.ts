import "server-only";

import {
  assertWriteCountryScope,
  resolveCountryScopeFromCode,
  resolveWorkCountryParam,
  type CountryScope,
} from "@/lib/country-data-scope";
import type { WorkCountryCode } from "@/lib/work-country";

export {
  assertWriteCountryScope,
  resolveCountryScopeFromCode,
  resolveWorkCountryParam,
  type CountryScope,
};

/** Resolve + validate work country for server actions (client sends active country). */
export function requireWorkCountryScope(
  workCountry: WorkCountryCode | string | null | undefined,
): CountryScope {
  return resolveCountryScopeFromCode(resolveWorkCountryParam(workCountry));
}
