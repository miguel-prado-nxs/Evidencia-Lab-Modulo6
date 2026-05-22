/**
 * Upload Middleware
 * Middleware multer para manejo de archivos subidos
 */

const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { STORAGE_PATHS, LIMITS, isAllowedMimeType, getExtensionFromMime } = require("../config/storage");

// Configurar almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_PATHS.resources);
  },
  filename: (req, file, cb) => {
    const ext = getExtensionFromMime(file.mimetype) || path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

// Filtro de archivos
const fileFilter = (req, file, cb) => {
  if (isAllowedMimeType(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
  }
};

// Configuración de multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: LIMITS.maxFileSize,
  },
});

// Middleware para un solo archivo
const uploadSingle = upload.single("file");

// Middleware para múltiples archivos
const uploadMultiple = upload.array("files", 10);

// Middleware wrapper para manejar errores
const handleUpload = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            error: `El archivo excede el tamaño máximo permitido (${LIMITS.maxFileSize / 1024 / 1024}MB)`,
          });
        }
        return res.status(400).json({
          success: false,
          error: `Error al subir archivo: ${err.message}`,
        });
      } else if (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
        });
      }
      next();
    });
  };
};

// Multer en memoria para CSV — no escribe en disco, Buffer disponible en req.file.buffer
const csvMemoryStorage = multer.memoryStorage();
const csvUpload = multer({
  storage: csvMemoryStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ext === ".csv") {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos CSV (.csv)"), false);
    }
  },
});

module.exports = {
  uploadSingle: handleUpload(uploadSingle),
  uploadMultiple: handleUpload(uploadMultiple),
  upload,
  uploadCsv: handleUpload(csvUpload.single("file")),
};

