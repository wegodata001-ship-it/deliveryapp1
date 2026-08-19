# Security & Permissions Audit

Generated: 2026-08-19T06:02:50.218Z

## Authentication Flow

1. Login → `loginAction` → JWT in httpOnly cookie
2. Middleware (`/admin/*`) → `verifySessionToken` → role ADMIN or EMPLOYEE
3. Server actions → `requireAdminUser` / capability checks per module

## Roles

| Role | Access |
| ---- | ------ |
| ADMIN | Full access (empty permissionKeys = bypass) |
| EMPLOYEE | UserPermission keys only |

## Middleware Limitation

Middleware does **not** check fine-grained permissions — only session validity + role.
Authorization for specific actions (e.g. `canManageFlow`, `canCountEdit`) happens in server actions.

## Recommended Manual Tests (NOT automated in this audit)

| Test | Method | Expected |
| ---- | ------ | -------- |
| Unauthenticated API | `curl /api/orders/boot` without cookie | 401/redirect |
| Employee without perm | Direct server action call | `{ ok: false }` or redirect |
| Admin-only destructive | `clearDemoDataAction` as EMPLOYEE | Blocked |

## Auth Performance (from code review)

- `getSessionPayload` wrapped in React.cache (1 DB hit per request)
- User permission join cached 300s in-memory per userId
- Middleware JWT verify on every /admin navigation

## Findings

| ID | Severity | Finding |
| -- | -------- | ------- |
| AUTH-001 | P3 | Permissions not in middleware — by design, verify per action |
| — | P2 | `/api/debug/current-user` exists — ensure disabled in production |
