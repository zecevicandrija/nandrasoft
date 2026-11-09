import { z } from "zod";

export const photoUrlSchema = z.string().max(2048).url("Neispravan URL fotografije").refine((value) => {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && url.host === (process.env.BUNNY_PULL_ZONE_HOSTNAME || "nandra.b-cdn.net")
    && !url.username && !url.password && !url.search && !url.hash
    && /^\/fotografije\/\d{4}\/\d{2}\/foto_[a-f0-9-]{36}\.jpg$/.test(url.pathname);
}, "Izaberite fotografiju otpremljenu kroz aplikaciju.").nullable().optional();
