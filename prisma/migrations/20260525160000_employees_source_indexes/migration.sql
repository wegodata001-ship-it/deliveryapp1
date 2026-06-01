-- Employees source table — list/filter performance (idempotent)
CREATE INDEX IF NOT EXISTS "User_isActive_lastLoginAt_idx"
  ON "User" ("isActive", "lastLoginAt" DESC);

CREATE INDEX IF NOT EXISTS "User_role_isActive_idx"
  ON "User" ("role", "isActive");

CREATE INDEX IF NOT EXISTS "User_fullName_idx"
  ON "User" ("fullName");

ANALYZE "User";
