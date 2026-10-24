import { promisify } from 'node:util';
import zlib from 'node:zlib';
import express, { Router, type RequestHandler } from 'express';
import type { BackupFile, ImportSummary } from '../../shared/api.ts';
import { backupFileSchema } from '../../shared/schemas.ts';
import { HttpError } from '../middleware/error.ts';
import type { Quotas } from '../middleware/security.ts';
import type { BackupRepo } from '../repos/backup.ts';

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

const UPLOAD_LIMIT = '25mb';
/** A small Brotli file can inflate enormously; stop well above any legitimate backup (quota is 50M chars). */
const MAX_DECOMPRESSED = 64 * 1024 * 1024;

interface AccountRouterDeps {
  backup: BackupRepo;
  quotas: Quotas;
  requireAuth: RequestHandler;
  backupLimiter: RequestHandler;
}

/** Plain JSON is accepted too: its first non-whitespace byte is "{", which a Brotli stream won't start with here. */
function looksLikeJson(buf: Buffer): boolean {
  for (const byte of buf) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x7b;
  }
  return false;
}

async function decode(buf: Buffer): Promise<unknown> {
  let text: string;
  if (looksLikeJson(buf)) {
    text = buf.toString('utf8');
  } else {
    try {
      text = (await brotliDecompress(buf, { maxOutputLength: MAX_DECOMPRESSED })).toString('utf8');
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new HttpError(413, 'Backup is too large');
      throw new HttpError(400, 'Not a BinCode backup file');
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Not a BinCode backup file');
  }
}

export function accountRouter({ backup, quotas, requireAuth, backupLimiter }: AccountRouterDeps): Router {
  const router = Router();

  // A file download of the user's own data on an authenticated GET with no reflected input, so the
  // "never compress API bodies" (BREACH) rule for on-the-fly HTTP compression doesn't apply here.
  router.get('/export', requireAuth, backupLimiter, async (req, res) => {
    const file: BackupFile = backup.exportFor(req.user!.id);
    const body = await brotliCompress(Buffer.from(JSON.stringify(file)), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="bincode-backup-${file.exportedAt.slice(0, 10)}.json.br"`);
    res.send(body);
  });

  router.post(
    '/import',
    requireAuth,
    backupLimiter,
    express.raw({ type: 'application/octet-stream', limit: UPLOAD_LIMIT }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, 'Upload the backup file as application/octet-stream');
      }
      const file = backupFileSchema.parse(await decode(req.body)) as BackupFile;
      const body: ImportSummary = backup.importFor(req.user!.id, file, quotas);
      res.json(body);
    },
  );

  return router;
}
