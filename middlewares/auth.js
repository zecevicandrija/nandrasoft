import { auth } from "../routes/auth.js";

const verifiedRequest = Symbol("verified-session");

/**
 * Middleware koji proverava da li je korisnik ulogovan.
 * Postavlja req.user i req.session na request objekat.
 */
export async function requireAuth(req, res, next) {
  // Reuse only verification performed by this middleware on this HTTP request.
  // App-level rate limiting and route-level guards must not query sessions twice.
  if (req[verifiedRequest]) return next();
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
      // Always check the database so revoked sessions cannot survive in cookies.
      query: { disableCookieCache: true },
    });

    if (!session) {
      return res.status(401).json({ error: "Niste prijavljeni." });
    }

    if (session.user?.isActive !== true) {
      return res.status(403).json({ error: "Korisnički nalog je deaktiviran." });
    }

    req.user = session.user;
    req.session = session.session;
    req[verifiedRequest] = true;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Neuspešna autentifikacija." });
  }
}

/**
 * Middleware koji proverava da li korisnik ima jednu od dozvoljenih uloga.
 * Mora se koristiti POSLE requireAuth middleware-a.
 */
export function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Niste prijavljeni." });
    }

    if (req.user.isActive !== true) {
      return res.status(403).json({ error: "Korisnički nalog je deaktiviran." });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Nemate dozvolu za ovu akciju.",
        requiredRoles: roles,
        yourRole: req.user.role,
      });
    }

    next();
  };
}

export const requireManager = requireRole(["DIREKTOR", "RUKOVODILAC"]);
export const requireAdmin = requireRole(["DIREKTOR"]);
