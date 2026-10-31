import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import { createHash } from "node:crypto";
import express from "express";
import { requireAuth } from "../middlewares/auth.js";

export function createUserLimiter({ limit = 3000, windowMs = 15 * 60 * 1000, store } = {}) {
  const limiter = rateLimit({
    windowMs, limit, ...(store ? { store } : {}),
    keyGenerator: (req) => `user:${req.user.id}`,
    standardHeaders: true, legacyHeaders: false,
    message: { error: "Prekoračen broj zahteva za vaš nalog. Pokušajte ponovo kasnije." },
  });
  return (req, res, next) => {
    // Never fall back to a shared IP bucket or an identity supplied by the client.
    if (!req.user?.id || req.user.isActive !== true) {
      return res.status(401).json({ error: "Niste prijavljeni." });
    }
    return limiter(req, res, next);
  };
}

export function createLoginLimiter({ limit = 150, windowMs = 5 * 60 * 1000, store } = {}) {
  return rateLimit({
    windowMs, limit, ...(store ? { store } : {}),
    skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false,
    message: { error: "Previše pokušaja prijave sa vaše mreže. Pokušajte ponovo za 5 minuta." },
  });
}

export function createAccountLoginLimiter({ limit = 5, windowMs = 15 * 60 * 1000, store } = {}) {
  return rateLimit({
    windowMs, limit, ...(store ? { store } : {}), skipSuccessfulRequests: true,
    requestPropertyName: "accountRateLimit", standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      // Never store account names in the limiter. Rotating IPs/case cannot reset
      // one account's failures; other workers behind that IP keep their quota.
      return email ? `account:${createHash("sha256").update(email).digest("hex")}`
        : `invalid:${ipKeyGenerator(req.ip)}`;
    },
    message: { error: "Previše neuspešnih pokušaja za ovaj nalog. Pokušajte ponovo za 15 minuta." },
  });
}

export function installApiAccess(app, authHandler, {
  userLimiter = createUserLimiter(), loginLimiter = createLoginLimiter(), accountLoginLimiter = createAccountLoginLimiter(),
} = {}) {
  // The IP guard runs before parsing. Better Call's Node adapter supports
  // reconstructing a consumed body from req.body (covered by integration tests).
  const loginBody = [express.json({ limit: "16kb" }), express.urlencoded({ extended: false, limit: "16kb" })];
  app.use("/api/auth/sign-in", loginLimiter, ...loginBody, accountLoginLimiter);
  app.use("/api/auth/sign-up", loginLimiter, ...loginBody, accountLoginLimiter);
  // Other public auth endpoints retain their own body parsing.
  app.all("/api/auth/{*splat}", authHandler);
  app.use("/api", requireAuth, userLimiter);
}
