import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNotProductionDataTarget,
  assertStagingEnv,
  checkStagingEnv,
  identityFromValue,
  projectRefFromJwt,
} from "@/lib/staging-guard";

const STAGING_REF = "abcdefghijklmnopqrst";

function jwt(ref: string): string {
  const payload = Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url");
  return `header.${payload}.signature`;
}

function stagingEnv(overrides: Record<string, string> = {}) {
  return {
    WEGO_ENV: "staging",
    WEGO_BLOCK_EXTERNAL_SIDE_EFFECTS: "1",
    DATABASE_URL: `postgresql://postgres.${STAGING_REF}:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql://postgres.${STAGING_REF}:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_REF),
    SESSION_SECRET: "staging-session-secret",
    NEXTAUTH_SECRET: "staging-nextauth-secret",
    ...overrides,
  };
}

describe("staging guard", () => {
  it("reads a project ref without exposing the password", () => {
    const identity = identityFromValue(stagingEnv().DATABASE_URL);
    assert.equal(identity.projectRef, STAGING_REF);
    assert.equal(identity.port, "6543");
    assert.equal(JSON.stringify(identity).includes("secret"), false);
    assert.equal(projectRefFromJwt(jwt(STAGING_REF)), STAGING_REF);
  });

  it("accepts one staging project across the database URL and keys", () => {
    const check = checkStagingEnv(stagingEnv());
    assert.equal(check.ok, true);
    assert.equal(check.projectRef, STAGING_REF);
    assert.deepEqual(check.errors, []);
  });

  it("rejects the production project and a mixed project", () => {
    const production = checkStagingEnv(
      stagingEnv({
        DATABASE_URL:
          "postgresql://postgres.qileqmeisvibtkvpigct:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
        DIRECT_URL:
          "postgresql://postgres.qileqmeisvibtkvpigct:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
        NEXT_PUBLIC_SUPABASE_URL: "https://qileqmeisvibtkvpigct.supabase.co",
        SUPABASE_URL: "https://qileqmeisvibtkvpigct.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: jwt("qileqmeisvibtkvpigct"),
      }),
    );
    assert.equal(production.ok, false);
    assert.match(production.errors.join("\n"), /production/);
    assert.equal(production.errors.join("\n").includes("secret"), false);

    const mixedEnv = stagingEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
    });
    const mixed = checkStagingEnv(mixedEnv);
    assert.equal(mixed.ok, false);
    assert.match(mixed.errors.join("\n"), /do not match/);
    assert.throws(() => assertStagingEnv(mixedEnv), /do not match/);
  });

  it("blocks a data-changing test aimed at production", () => {
    assert.throws(
      () =>
        assertNotProductionDataTarget({
          DATABASE_URL:
            "postgresql://postgres.qileqmeisvibtkvpigct:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
        }),
      /production/,
    );
    assert.doesNotThrow(() => assertNotProductionDataTarget(stagingEnv()));
  });
});
