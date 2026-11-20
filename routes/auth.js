import "dotenv/config";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../lib/prisma.js";

const authBaseUrl = (process.env.BETTER_AUTH_URL || "http://localhost:5000").trim().replace(/\/+$/, "");
const frontendUrl = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");

function parseOrigin(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

const authOrigin = parseOrigin(authBaseUrl);
const frontendOrigin = parseOrigin(frontendUrl);
const useCrossOriginCookies =
  process.env.CROSS_ORIGIN_COOKIES === "true" ||
  (Boolean(authOrigin && frontendOrigin) &&
    authBaseUrl.startsWith("https://") &&
    frontendUrl.startsWith("https://") &&
    authOrigin !== frontendOrigin);

const envTrustedOrigins = [
  frontendUrl,
  authBaseUrl,
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : []),
]
  .map((origin) => origin?.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const auth = betterAuth({
  baseURL: authBaseUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  rateLimit: {
    customRules: {
      // Express has a NAT burst guard and a strict per-account failure limit. Better Auth's
      // default 3 attempts/10s would also block successful logins behind NAT.
      "/sign-in/*": false,
      "/sign-up/*": false,
      "/get-session": false,
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    // Nema javne registracije: naloge kreira isključivo DIREKTOR preko /api/users.
    disableSignUp: true,
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(session.userId);
          if (user?.isActive !== true) {
            throw new APIError("FORBIDDEN", { message: "Korisnički nalog je deaktiviran." });
          }
        },
      },
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "OPERATER",
        // Authorization data is server-owned, including on sign-up and update-user.
        input: false,
      },
      pin: {
        type: "string",
        required: false,
        input: false,
        returned: false,
      },
      phone: {
        type: "string",
        required: false,
        input: true,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:5000",
    "https://*.ngrok-free.dev",
    "https://*.ngrok-free.app",
    "https://*.ngrok.io",
    "https://*.loca.lt",
    ...envTrustedOrigins,
  ],
  ...(useCrossOriginCookies
    ? {
        advanced: {
          defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
          },
        },
      }
    : {}),
});
