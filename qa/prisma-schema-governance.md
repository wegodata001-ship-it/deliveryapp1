# Prisma Schema Governance (No-Destructive)

## Current Situation

- Project contains a mixed schema:
  - Prisma-managed tables (declared in `prisma/schema.prisma`)
  - SQL-managed tables created/maintained via raw SQL in app code
- No historical `prisma/migrations` baseline exists yet.
- Because of that, Prisma drift checks can suggest dangerous `DROP TABLE` operations.

## Immediate Safety Rules

- Do **not** run:
  - `prisma db push`
  - `prisma migrate deploy`
  - `prisma migrate reset`
- Use read-only inspection only:
  - `npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma`
  - optional SQL preview: add `--script`

## SQL-Managed Tables Registry

These tables are currently SQL-managed in code and are now represented in `schema.prisma` to prevent accidental drops:

1. `imports`
2. `import_rows`
3. `SourceStatus`
4. `SourcePaymentMethod`
5. `CustomerBalanceStatusOverride`
6. `admin_system_settings`

### Code Owners (where they are created/used)

- `imports`, `import_rows`:
  - `src/lib/excel-import.ts`
  - `src/app/api/excel/*`
- `SourceStatus`, `SourcePaymentMethod`:
  - `src/app/admin/source-tables/actions.ts`
- `CustomerBalanceStatusOverride`:
  - `src/app/admin/balances/actions.ts`
- `admin_system_settings`:
  - `src/app/admin/settings/actions.ts`

## Management Decision (Current)

- **Keep externally SQL-managed behavior** for the 6 tables above (for now).
- **Also keep them declared in Prisma schema** (mapped models) to stop Prisma from generating `DROP TABLE` diffs.
- No destructive DB operation is allowed during this phase.

## Short-Term Production Patch Applied

- Safely applied (idempotent SQL): add missing `Order.editUnlockedForUserId` column if absent.
- No table drops, no reset.

## Remaining Non-Destructive Drift (Expected)

Drift now should be limited to additive changes only (new tables/columns/indexes/foreign keys), e.g.:

- `OrderEditRequest`, `UserNotification` (new tables)
- `Order.editUnlockedUntil` (missing column)
- additive indexes and FKs

## Baseline Strategy (Long-Term)

1. Freeze destructive commands in production.
2. Generate a reviewed baseline migration from the live DB (no apply yet).
3. Store baseline under `prisma/migrations/<timestamp>_baseline/`.
4. Mark baseline as applied on production only after review.
5. From that point, allow only additive reviewed migrations.

## Safe Migration Workflow

For every schema change:

1. Run read-only drift diff.
2. Ensure generated SQL contains no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or enum destructive changes.
3. Apply only reviewed additive SQL.
4. Re-run drift diff to verify clean state.

