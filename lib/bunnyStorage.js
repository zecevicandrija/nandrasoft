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
 * Server-only metadata for a new receipt. Never includes credentials.
 */
function generateBunnyUploadConfig(fileType) {
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
    contentType: normalizedMime,
  };
}

export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

// Check the file signature as well as the client-supplied MIME type.
export function isReceiptImage(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_RECEIPT_BYTES) return false;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg" || mime === "image/jpg") return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

// Upload receipts from the backend; clients cannot select a storage path.
export async function uploadBufferToBunny(buffer, fileType) {
  if (!isReceiptImage(buffer, fileType)) throw new Error("Invalid receipt image.");
  if (!STORAGE_API_KEY || !STORAGE_ZONE) {
    throw new Error("Bunny.net Storage konfiguracija nije podešena na serveru.");
  }

  // Always generate a new path on the server; clients cannot overwrite files.
  const { uploadUrl, fileUrl, filePath, contentType } = generateBunnyUploadConfig(fileType);

  let response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        AccessKey: STORAGE_API_KEY,
        "Content-Type": contentType,
      },
      body: buffer,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Bunny Storage upload failed.");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Bunny Storage upload failed.");
  }

  return {
    fileUrl,
    filePath,
  };
}

