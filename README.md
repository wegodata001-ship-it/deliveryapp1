# Wego App

## Database (Supabase PostgreSQL + Prisma)

### Connect `DATABASE_URL`

1. In [Supabase](https://supabase.com), open your project → **Project Settings** → **Database**.
2. Copy the **URI** connection string (use **Session mode** for serverless pooler, or the direct host for long-lived servers).
3. Create `.env` in the project root (never commit it):

```bash
cp .env.example .env
```

4. Set `DATABASE_URL` in `.env` to that URI. Replace the password placeholder if the dashboard shows a separate password.

**Security:** `DATABASE_URL` is server-only. Do not prefix with `NEXT_PUBLIC_` and do not import it from client components.

### Prisma commands

```bash
npm install
npm run db:generate
npm run db:push
```

- **`db:generate`**: generates the Prisma Client after schema changes.
- **`db:push`**: applies the schema to the database (good for early iteration). For versioned migrations in production, prefer `npm run db:migrate`.

### Seed permissions and default admin

```bash
npm run db:seed
```

This creates default permissions and a **development-only** admin account (`admin` / `Admin123456!`). Change the password immediately in any shared or production environment.

### Warnings

- **Do not use real client data** in seeds or local experiments until import and access controls are approved.
- **Do not store plain passwords**; only hashes belong in the database.
- **Legacy migration:** raw legacy rows are intended to land in `LegacyRawRow` before mapping, so nothing from the old system is lost. Do not delete or overwrite production legacy tables from this app without a dedicated migration plan and backups.

### Backups and audit

Schedule regular Supabase / PostgreSQL backups. Sensitive actions should be written to `AuditLog` from application code when you build those flows.
