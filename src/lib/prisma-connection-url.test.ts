import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPrismaConnectionError,
  normalizeDatabaseUrlForPrisma,
} from "@/lib/prisma-connection-url";

describe("prisma-connection-url", () => {
  it("adds pool params when missing", () => {
    const out = normalizeDatabaseUrlForPrisma(
      "postgresql://u:p@host:6543/postgres?pgbouncer=true",
    );
    assert.ok(out?.includes("connect_timeout="));
    assert.ok(out?.includes("pool_timeout="));
    assert.ok(out?.includes("connection_limit="));
  });

  it("preserves existing params", () => {
    const url =
      "postgresql://u:p@host:6543/postgres?pgbouncer=true&connection_limit=1&connect_timeout=30";
    const out = normalizeDatabaseUrlForPrisma(url)!;
    assert.ok(out.includes("connection_limit=1"));
    assert.ok(out.includes("connect_timeout=30"));
    assert.ok(out.includes("pool_timeout=15"));
  });

  it("detects connection reset errors", () => {
    assert.ok(
      isPrismaConnectionError(
        new Error("An existing connection was forcibly closed by the remote host"),
      ),
    );
    assert.ok(isPrismaConnectionError({ code: "P1017", message: "Server closed" }));
  });
});
