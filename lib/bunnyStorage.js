import "dotenv/config";
import crypto from "crypto";

const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE_NAME || "nandrastorage";
const STORAGE_API_KEY = process.env.BUNNY_STORAGE_API_KEY || "";
const PULL_ZONE_HOSTNAME = process.env.BUNNY_PULL_ZONE_HOSTNAME || "nandra.b-cdn.net";
const STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";

const ALLOWED_MIME_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

/**
 * Generiše jedinstvenu putanju i konfiguraciju za direktan upload slike računa na Bunny.net Storage.
 */
export function generateBunnyUploadConfig(fileType = "image/webp") {
  if (!STORAGE_API_KEY || !STORAGE_ZONE) {
    throw new Error("Bunny.net Storage konfiguracija nije podešena na serveru (.env).");
  }

  const normalizedMime = ALLOWED_MIME_TYPES[fileType] ? fileType : "image/webp";
  const ext = ALLOWED_MIME_TYPES[normalizedMime] || "webp";

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const randomSuffix = crypto.randomBytes(6).toString("hex");

  const filePath = `racuni/${year}/${month}/racun_${randomSuffix}_${timestamp}.${ext}`;
  const uploadUrl = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${filePath}`;
  const fileUrl = `https://${PULL_ZONE_HOSTNAME}/${filePath}`;

  return {
    uploadUrl,
    fileUrl,
    filePath,
    method: "PUT",
    headers: {
      AccessKey: STORAGE_API_KEY,
      "Content-Type": normalizedMime,
    },
  };
}

/**
 * Fallback otpremanje bafera direktno sa backenda na Bunny Storage (ukoliko browser blokira CORS).
 */
export async function uploadBufferToBunny(buffer, fileType = "image/webp", existingFilePath = null) {
  if (!STORAGE_API_KEY || !STORAGE_ZONE) {
    throw new Error("Bunny.net Storage konfiguracija nije podešena na serveru.");
  }

  const config = generateBunnyUploadConfig(fileType);
  const targetPath = existingFilePath && existingFilePath.startsWith("racuni/") ? existingFilePath : config.filePath;
  const uploadUrl = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${targetPath}`;
  const fileUrl = `https://${PULL_ZONE_HOSTNAME}/${targetPath}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      AccessKey: STORAGE_API_KEY,
      "Content-Type": config.headers["Content-Type"],
    },
    body: buffer,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Bunny Storage greška (${response.status}): ${errText}`);
  }

  return {
    fileUrl,
    filePath: targetPath,
  };
}

