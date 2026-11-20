import { createAuthClient } from "better-auth/react";
import { API_ORIGIN } from "./api";

export const authClient = createAuthClient({
  baseURL:
    API_ORIGIN ||
    (typeof window !== "undefined" && window.location.hostname !== "localhost"
      ? window.location.origin
      : "http://localhost:5000"),
});

export const { signIn, signUp, signOut, useSession } = authClient;
