/**
 * Storage Configuration
 * Configuración para almacenamiento S3-compatible (Railway Storage)
 */

const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");
const logger = require("./logger");

// Configuración S3 (Railway Storage)
const S3_CONFIG = {
  endpoint: process.env.S3_ENDPOINT || "https://storage.railway.app",
  region: process.env.S3_REGION || "auto",
  bucket: process.env.S3_BUCKET || "bucket-recursos-partners-xujxon",
  accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  forcePathStyle: true, // Necesario para S3-compatible storage
};

// Cliente S3
let s3Client = null;

/**
 * Inicializar cliente S3
 */
function getS3Client() {
  if (s3Client) return s3Client;

  if (!S3_CONFIG.accessKeyId || !S3_CONFIG.secretAccessKey) {
    logger.warn("S3 credentials not configured. Using local storage fallback.");
    return null;
  }

  s3Client = new S3Client({
    endpoint: S3_CONFIG.endpoint,
    region: S3_CONFIG.region,
    credentials: {
      accessKeyId: S3_CONFIG.accessKeyId,
      secretAccessKey: S3_CONFIG.secretAccessKey,
    },
    forcePathStyle: S3_CONFIG.forcePathStyle,
  });

  return s3Client;
}

/**
 * Verificar conexión con S3
 */
async function testS3Connection() {
  const client = getS3Client();
  if (!client) return false;

  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_CONFIG.bucket }));
    logger.info(`S3 connection successful. Bucket: ${S3_CONFIG.bucket}`);
    return true;
  } catch (error) {
    logger.error("S3 connection failed:", error.message);
    return false;
  }
}

// Directorio base para uploads locales (fallback)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads");

// Subdirectorios por categoría (fallback local)
const STORAGE_PATHS = {
  resources: path.join(UPLOAD_DIR, "resources"),
  thumbnails: path.join(UPLOAD_DIR, "thumbnails"),
  certificates: path.join(UPLOAD_DIR, "certificates"),
  temp: path.join(UPLOAD_DIR, "temp"),
};

// Crear directorios locales si no existen (fallback)
function ensureDirectories() {
  Object.values(STORAGE_PATHS).forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Configuración de límites
const LIMITS = {
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "52428800", 10), // 50MB default
  allowedMimeTypes: {
    documents: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    images: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    videos: ["video/mp4", "video/webm", "video/quicktime"],
  },
};

// Obtener extensión de archivo por MIME type
const MIME_TO_EXT = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

function getExtensionFromMime(mimeType) {
  return MIME_TO_EXT[mimeType] || "";
}

// Verificar si el MIME type está permitido
function isAllowedMimeType(mimeType) {
  const allAllowed = [
    ...LIMITS.allowedMimeTypes.documents,
    ...LIMITS.allowedMimeTypes.images,
    ...LIMITS.allowedMimeTypes.videos,
  ];
  return allAllowed.includes(mimeType);
}

// Obtener tipo de recurso por MIME type
function getResourceType(mimeType) {
  if (LIMITS.allowedMimeTypes.documents.includes(mimeType)) return "document";
  if (LIMITS.allowedMimeTypes.images.includes(mimeType)) return "image";
  if (LIMITS.allowedMimeTypes.videos.includes(mimeType)) return "video";
  return "other";
}

/**
 * Obtener URL pública de un archivo en S3
 */
function getPublicUrl(key) {
  // Railway Storage usa virtual-hosted-style URLs
  return `${S3_CONFIG.endpoint}/${S3_CONFIG.bucket}/${key}`;
}

/**
 * Verificar si S3 está disponible
 */
function isS3Available() {
  return !!getS3Client();
}

// Inicializar directorios al cargar el módulo
ensureDirectories();

module.exports = {
  S3_CONFIG,
  getS3Client,
  testS3Connection,
  getPublicUrl,
  isS3Available,
  UPLOAD_DIR,
  STORAGE_PATHS,
  LIMITS,
  ensureDirectories,
  getExtensionFromMime,
  isAllowedMimeType,
  getResourceType,
};
