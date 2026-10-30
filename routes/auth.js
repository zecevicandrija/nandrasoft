import "dotenv/config";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../lib/prisma.js";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
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
  ],
});
