// @ts-check

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import HttpErrors from 'http-errors';

const { BadRequest } = HttpErrors;

export const uploadDir = join(process.cwd(), 'uploads');
export const uploadSizeLimit = 5 * 1024 * 1024;

export const allowedTypes = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/pdf': '.pdf',
};

export function ensureUploadDir() {
  mkdirSync(uploadDir, { recursive: true });
}

export async function storeUpload(file) {
  const extension = allowedTypes[file.mimetype];
  if (!extension) {
    throw new BadRequest('Недопустимый тип файла');
  }

  const buffer = await file.toBuffer();
  if (file.file.truncated) {
    const err = new Error('Файл слишком большой');
    err.name = 'RequestFileTooLargeError';
    err.statusCode = 413;
    throw err;
  }

  const storedName = `${Date.now()}-${randomUUID()}${extension}`;
  await writeFile(join(uploadDir, storedName), buffer);

  return {
    name: file.filename,
    mime: file.mimetype,
    size: buffer.length,
    url: `/uploads/${storedName}`,
  };
}