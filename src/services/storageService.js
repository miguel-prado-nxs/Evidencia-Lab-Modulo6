/**
 * Storage Service
 * Servicio para gestión de archivos en S3 (Railway Storage) con fallback local
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const {
  STORAGE_PATHS,
  getResourceType,
  getS3Client,
  S3_CONFIG,
  getPublicUrl,
  isS3Available,
  getExtensionFromMime,
} = require('../config/storage');
const logger = require('../config/logger');

// ========================================
// S3 Functions
// ========================================

/**
 * Subir archivo a S3
 */
async function uploadToS3(buffer, key, contentType) {
  const client = getS3Client();
  if (!client) {
    throw new Error('S3 client not available');
  }

  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: S3_CONFIG.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read', // Hacer público
      },
    });

    await upload.done();
    logger.info(`File uploaded to S3: ${key}`);
    return getPublicUrl(key);
  } catch (error) {
    logger.error(`Error uploading to S3: ${error.message}`);
    throw error;
  }
}

/**
 * Descargar archivo de S3
 */
async function downloadFromS3(key) {
  const client = getS3Client();
  if (!client) {
    throw new Error('S3 client not available');
  }

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
      })
    );

    // Convertir stream a buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    logger.error(`Error downloading from S3: ${error.message}`);
    throw error;
  }
}

/**
 * Eliminar archivo de S3
 */
async function deleteFromS3(key) {
  const client = getS3Client();
  if (!client) {
    return false;
  }

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
      })
    );
    logger.info(`File deleted from S3: ${key}`);
    return true;
  } catch (error) {
    logger.error(`Error deleting from S3: ${error.message}`);
    return false;
  }
}

/**
 * Verificar si archivo existe en S3
 */
async function existsInS3(key) {
  const client = getS3Client();
  if (!client) {
    return false;
  }

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

// ========================================
// Local Storage Functions (Fallback)
// ========================================

/**
 * Guardar archivo localmente
 */
async function saveFileLocal(buffer, filename, directory = 'resources') {
  const dir = STORAGE_PATHS[directory] || STORAGE_PATHS.resources;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, buffer);
  return filepath;
}

/**
 * Eliminar archivo local
 */
async function deleteFileLocal(filepath) {
  try {
    await fs.unlink(filepath);
    logger.info(`File deleted locally: ${filepath}`);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Error deleting local file: ${filepath}`, error);
      throw error;
    }
    return false;
  }
}

/**
 * Leer archivo local
 */
async function readFileLocal(filepath) {
  return fs.readFile(filepath);
}

/**
 * Verificar si archivo existe localmente
 */
async function fileExistsLocal(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

// ========================================
// Unified Storage Interface
// ========================================

/**
 * Subir archivo (S3 o local)
 */
async function uploadFile(buffer, filename, contentType, folder = 'resources') {
  const key = `${folder}/${filename}`;

  if (isS3Available()) {
    try {
      const url = await uploadToS3(buffer, key, contentType);
      return { url, key, storage: 's3' };
    } catch (error) {
      logger.warn('S3 upload failed, falling back to local storage');
    }
  }

  // Fallback a almacenamiento local
  const filepath = await saveFileLocal(buffer, filename, folder);
  return { url: `/uploads/${folder}/${filename}`, key: filepath, storage: 'local' };
}

/**
 * Eliminar archivo (S3 o local)
 */
async function deleteFile(keyOrPath, storage = 'auto') {
  if (storage === 's3' || (storage === 'auto' && keyOrPath.startsWith('http'))) {
    // Extraer key de la URL
    const key = keyOrPath.includes(S3_CONFIG.bucket)
      ? keyOrPath.split(`${S3_CONFIG.bucket}/`)[1]
      : keyOrPath;
    return deleteFromS3(key);
  }

  // Eliminar localmente
  return deleteFileLocal(keyOrPath);
}

/**
 * Generar thumbnail para imagen
 */
async function generateThumbnail(inputBuffer, options = {}) {
  const { width = 200, height = 200, quality = 80 } = options;

  try {
    const thumbnailBuffer = await sharp(inputBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
      })
      .webp({ quality })
      .toBuffer();

    return thumbnailBuffer;
  } catch (error) {
    logger.error(`Error generating thumbnail: ${error.message}`);
    return null;
  }
}

/**
 * Procesar archivo subido y guardar
 */
async function processUploadedFile(file, folder = 'resources') {
  const resourceType = getResourceType(file.mimetype);
  const ext = getExtensionFromMime(file.mimetype) || path.extname(file.originalname);
  const uniqueFilename = `${uuidv4()}${ext}`;

  // Leer el archivo subido por multer
  const buffer = await fs.readFile(file.path);

  // Subir archivo principal
  const result = await uploadFile(buffer, uniqueFilename, file.mimetype, folder);

  // Generar y subir thumbnail si es imagen
  let thumbnailUrl = null;
  if (resourceType === 'image') {
    const thumbnailBuffer = await generateThumbnail(buffer);
    if (thumbnailBuffer) {
      const thumbnailFilename = `${uuidv4()}_thumb.webp`;
      const thumbResult = await uploadFile(
        thumbnailBuffer,
        thumbnailFilename,
        'image/webp',
        'thumbnails'
      );
      thumbnailUrl = thumbResult.url;
    }
  }

  // Eliminar archivo temporal
  await fs.unlink(file.path).catch(() => {});

  return {
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    storagePath: result.key,
    storageType: result.storage,
    url: result.url,
    thumbnailUrl,
    type: resourceType,
  };
}

/**
 * Obtener URL de descarga
 */
function getDownloadUrl(storagePath, storageType) {
  if (storageType === 's3') {
    return storagePath.startsWith('http') ? storagePath : getPublicUrl(storagePath);
  }
  // Para archivos locales, devolver la ruta relativa
  return storagePath;
}

/**
 * Verificar si archivo existe
 */
async function fileExists(keyOrPath, storage = 'auto') {
  if (storage === 's3' || (storage === 'auto' && keyOrPath.startsWith('http'))) {
    const key = keyOrPath.includes(S3_CONFIG.bucket)
      ? keyOrPath.split(`${S3_CONFIG.bucket}/`)[1]
      : keyOrPath;
    return existsInS3(key);
  }

  return fileExistsLocal(keyOrPath);
}

/**
 * Leer contenido de archivo
 */
async function readFile(keyOrPath, storage = 'auto') {
  if (storage === 's3' || (storage === 'auto' && keyOrPath.startsWith('http'))) {
    const key = keyOrPath.includes(S3_CONFIG.bucket)
      ? keyOrPath.split(`${S3_CONFIG.bucket}/`)[1]
      : keyOrPath;
    return downloadFromS3(key);
  }

  return readFileLocal(keyOrPath);
}

module.exports = {
  // S3 functions
  uploadToS3,
  downloadFromS3,
  deleteFromS3,
  existsInS3,
  // Local functions
  saveFileLocal,
  deleteFileLocal,
  readFileLocal,
  fileExistsLocal,
  // Unified interface
  uploadFile,
  deleteFile,
  generateThumbnail,
  processUploadedFile,
  getDownloadUrl,
  fileExists,
  readFile,
  // Utils
  isS3Available,
  getPublicUrl,
  STORAGE_PATHS,
};
