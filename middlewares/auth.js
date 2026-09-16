import { auth } from "../routes/auth.js";

/**
 * Middleware koji proverava da li je korisnik ulogovan.
 * Postavlja req.user i req.session na request objekat.
 */
export async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return res.status(401).json({ error: "Niste prijavljeni." });
    }

    req.user = session.user;
    req.session = session.session;
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
