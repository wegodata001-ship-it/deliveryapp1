/**
 * Finance Data Layer — public barrel (V2).
 *
 * Allowed exports: Services, View Models, Validators, Types.
 * Forbidden: Repositories, Matching internals, Prisma, DB objects.
 *
 * Screens must consume only this module (or deep paths under view-models /
 * services / validators / types — never repositories or matching).
 */

export * from "./types";
export * from "./view-models";
export * from "./validators";
export * from "./services";
