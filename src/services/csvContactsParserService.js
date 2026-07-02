'use strict';

const { parse } = require('csv-parse/sync');
const { randomUUID } = require('crypto');

const MAX_ROWS = 500;

// Sinónimos aceptados para cada campo (primer match por columna gana)
const COLUMN_ALIASES = {
  phone: [
    'phone_number',
    'phoneNumber',
    'phone',
    'telefono',
    'teléfono',
    'tel',
    'mobile',
    'celular',
    'numero',
    'número',
  ],
  name: [
    'business_name',
    'businessName',
    'name',
    'nombre',
    'negocio',
    'empresa',
    'establecimiento',
    'restaurante',
  ],
  email: ['email', 'correo', 'mail', 'e-mail'],
  decisionMaker: [
    'decision_maker',
    'contacto',
    'responsable',
    'encargado',
    'dueno',
    'dueño',
    'owner',
  ],
  address: ['address', 'direccion', 'dirección', 'domicilio', 'city'],
  notes: ['notes', 'notas', 'observaciones', 'comentarios'],
};

// Normaliza teléfono a E.164 con default México (+52)
const normalizePhoneNumber = (value) => {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return null;
};

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Normaliza el header de una columna para matchear aliases
const normalizeHeader = (header) =>
  header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9_]/g, '_');

// Construye un mapa { fieldKey -> columnIndex } a partir de los headers del CSV
const buildColumnMap = (headers) => {
  const normalized = headers.map(normalizeHeader);
  const columnMap = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(normalizeHeader(alias));
      if (idx !== -1 && !(field in columnMap)) {
        columnMap[field] = idx;
        break;
      }
    }
  }

  return columnMap;
};

/**
 * Parsea un buffer CSV y retorna filas válidas y rechazadas.
 *
 * @param {Buffer} buffer  - Contenido del archivo CSV
 * @param {string} originalName - Nombre original del archivo (para mensajes de error)
 * @returns {{
 *   validRows: Array<{phone,name,email?,decisionMaker?,address?,notes?}>,
 *   rejectedRows: Array<{rowIndex,reason,raw}>,
 *   totalRows: number,
 *   validCount: number,
 *   rejectedCount: number
 * }}
 */
const parseCSV = (buffer, originalName = 'archivo.csv') => {
  let records;

  try {
    records = parse(buffer, {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true, // strip UTF-8 BOM generado por Excel al guardar CSV
    });
  } catch (err) {
    throw new Error(`El archivo "${originalName}" no es un CSV válido: ${err.message}`, {
      cause: err,
    });
  }

  if (!records || records.length === 0) {
    throw new Error(`El archivo "${originalName}" está vacío.`);
  }

  // Primera fila: headers
  const headers = records[0];
  const dataRows = records.slice(1);

  if (dataRows.length === 0) {
    throw new Error(`El archivo "${originalName}" no contiene filas de datos (solo encabezado).`);
  }

  if (dataRows.length > MAX_ROWS) {
    throw new Error(
      `El archivo tiene ${dataRows.length} filas. El límite es ${MAX_ROWS} contactos por campaña.`
    );
  }

  const columnMap = buildColumnMap(headers);

  if (!('phone' in columnMap)) {
    throw new Error(
      `No se encontró columna de teléfono. Usa uno de estos nombres en el encabezado: ${COLUMN_ALIASES.phone.join(', ')}.`
    );
  }

  const validRows = [];
  const rejectedRows = [];
  const seenPhones = new Set(); // deduplicación por teléfono normalizado

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowIndex = i + 2; // +1 header, +1 base-1

    const get = (field) => {
      if (!(field in columnMap)) return undefined;
      const val = row[columnMap[field]];
      return val !== undefined ? String(val).trim() : undefined;
    };

    const rawPhone = get('phone');
    const phone = normalizePhoneNumber(rawPhone);

    if (!phone) {
      rejectedRows.push({
        rowIndex,
        reason: `Teléfono inválido o vacío: "${rawPhone || ''}"`,
        raw: row,
      });
      continue;
    }

    if (seenPhones.has(phone)) {
      rejectedRows.push({
        rowIndex,
        reason: `Teléfono duplicado: ${phone}`,
        raw: row,
      });
      continue;
    }

    const rawName = get('name');
    const name = rawName && rawName.length > 0 ? rawName : 'Contacto sin nombre';

    const rawEmail = get('email');
    let email;
    if (rawEmail && rawEmail.length > 0) {
      if (!SIMPLE_EMAIL_RE.test(rawEmail)) {
        rejectedRows.push({
          rowIndex,
          reason: `Email inválido: "${rawEmail}"`,
          raw: row,
        });
        continue;
      }
      email = rawEmail.toLowerCase();
    }

    seenPhones.add(phone);

    validRows.push({
      phone,
      name,
      ...(email && { email }),
      ...(get('decisionMaker') && { decisionMaker: get('decisionMaker') }),
      ...(get('address') && { address: get('address') }),
      ...(get('notes') && { notes: get('notes') }),
    });
  }

  return {
    validRows,
    rejectedRows,
    totalRows: dataRows.length,
    validCount: validRows.length,
    rejectedCount: rejectedRows.length,
  };
};

module.exports = { parseCSV, MAX_ROWS };
