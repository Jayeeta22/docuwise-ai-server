/**
 * Extends Express `Request` with auth fields.
 * Imported once from `app.ts` so ts-node always includes this module.
 */

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` after validating the session cookie JWT. */
      userId?: string;
    }
  }
}

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

export {};
