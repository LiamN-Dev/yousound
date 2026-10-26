import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import {
  getUsersDb,
  getUserByUid,
  getUserByUsername,
  createUserDb,
  updateUserDb,
  deleteUserDb,
  getSongsDb,
  insertSongDb,
  updateSongDb,
  deleteSongDb,
  incrementSongPlayDb,
  resetSongPlaysDb,
  bulkResetSongPlaysDb,
  getPlaylistsDb,
  createPlaylistDb,
  updatePlaylistDb,
  deletePlaylistDb,
  getFavoritesDb,
  toggleFavoriteDb,
  getRequestsDb,
  getRequestByIdDb,
  createRequestDb,
  updateRequestDb,
  updateRequestFullDb,
  deleteRequestDb,
  cleanupExpiredSongRequestsDb,
  getPopupsDb,
  createPopupDb,
  updatePopupDb,
  deletePopupDb,
  cleanupExpiredPopupsDb,
  purgeWelcomePopupsDb,
  getSettingDb,
  setSettingDb,
  saveMediaFileDb,
  getMediaFileDb,
  recordUserLoginDb,
  recordUserSongListenedDb,
  getChatRequestsDb,
  getChatRequestsForUserDb,
  createChatRequestDb,
  updateChatRequestStatusDb,
  deleteChatRequestDb,
  getChatThreadsDb,
  getChatThreadsForUserDb,
  getChatThreadByIdDb,
  createOrForceChatThreadDb,
  getChatRequestByIdDb,
  setChatThreadTerminatedDb,
  deleteChatThreadDb,
  hideChatThreadForUserDb,
  createOrGetAppealThreadDb,
  getChatMessagesDb,
  getAllChatMessagesDb,
  createChatMessageDb,
  deleteChatMessageDb,
  getChatPairingBlocksDb,
  createChatPairingBlockDb,
  deleteChatPairingBlockDb,
  isChatPairingBlockedDb,
  bulkUpdateSongsDb,
  bulkDeleteSongsDb,
  initDatabaseSchemaExtensions,
} from './db/queries';
import { seedDatabaseIfEmpty } from './db/seed';
import { ensureTables } from './db/ensureTables';
import {
  attachUser,
  enforcePolicy,
  getAuthUser,
  isAdminReq,
  hashPasswordSecure,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  loginBlocked,
  noteLoginFailure,
  clearLoginFailures,
} from './services/auth';
import {
  createFeedbackDb,
  listFeedbackDb,
  updateFeedbackDb,
  deleteFeedbackDb,
} from './db/feedback';
import { extractAudioFromYouTube, uploadMp3ToGoogleDrive } from './src/services/audioPipeline';
import {
  generateSupabaseMigrationSql,
  testSupabaseDbConnection,
  syncLocalDataToSupabase,
} from './services/supabaseMigration';
import {
  setSupabaseConnectionString,
  getActiveConnectionString,
  checkSqlAvailability,
  getDatabaseHealth,
} from './db/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const getPort = () => {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    return parseInt(process.argv[portArgIndex + 1], 10);
  }
  // Render (and most hosts) inject PORT; always honor it, regardless of NODE_ENV.
  if (process.env.PORT) {
    return parseInt(process.env.PORT, 10);
  }
  return 3000;
};
const PORT = getPort();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Render sits behind a proxy; this lets us see real IPs and detect https
app.set('trust proxy', 1);
// Every /api request: work out who is calling (from the signed cookie), then apply the route rules
app.use('/api', attachUser, enforcePolicy);

// Statically serve images and assets so covers never 404
app.use('/src/assets', express.static(path.resolve(__dirname, 'src/assets')));
app.use('/assets', express.static(path.resolve(__dirname, 'src/assets')));

// ----------------- PERSISTENT MEDIA STORAGE -----------------
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const AUDIO_DIR = path.resolve(UPLOADS_DIR, 'audio');
const COVERS_DIR = path.resolve(UPLOADS_DIR, 'covers');

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
  filename: (_req, file, cb) => {
    const clean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${clean}`);
  },
});
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const coverStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, COVERS_DIR),
  filename: (_req, file, cb) => {
    const clean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${clean}`);
  },
});
const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 35 * 1024 * 1024 }, // 35MB for animated loop video covers & high-res GIFs
});

// Helper password hasher (matching frontend)

function toIsoString(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  try {
    return new Date(val).toISOString();
  } catch {
    return String(val);
  }
}

// ----------------- MEDIA UPLOADS & STREAMING -----------------
// Audio File Upload (Multipart Form Data)
app.post('/api/upload/audio', (req: Request, res: Response) => {
  uploadAudio.single('audio')(req, res, async (err: any) => {
    if (err) {
      console.error('Audio upload error:', err);
      return res.status(400).json({ success: false, error: err.message || 'Audio upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file provided' });
    }
    const filename = req.file.filename;
    const audioUrl = `/api/media/audio/${filename}`;

    // Persist permanently into PostgreSQL so it NEVER gets erased across container restarts or 4-hour timeouts
    // Extract exact duration using music-metadata
    let duration = 0;
    try {
      const mm = await import('music-metadata');
      const fileBuffer = fs.readFileSync(req.file.path);
      const meta = await mm.parseBuffer(fileBuffer);
      if (meta.format?.duration && isFinite(meta.format.duration)) {
        duration = Math.round(meta.format.duration);
      }
      const base64Data = fileBuffer.toString('base64');
      const mime = req.file.mimetype || 'audio/mpeg';
      await saveMediaFileDb(filename, base64Data, mime, req.file.size);
    } catch (saveErr) {
      console.error('Failed to parse or persist audio into PostgreSQL database:', saveErr);
    }

    return res.json({
      success: true,
      audioUrl,
      filename,
      duration,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

// Audio File Upload Fallback (Base64 JSON - immune to proxy multipart issues)
app.post('/api/upload/audio-base64', async (req: Request, res: Response) => {
  try {
    const { filename, base64 } = req.body;
    if (!base64) {
      return res.status(400).json({ success: false, error: 'No audio data provided' });
    }
    const cleanName = (filename || 'track.mp3').replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalFilename = `${Date.now()}-${cleanName}`;
    const filePath = path.join(AUDIO_DIR, finalFilename);
    const rawData = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(rawData, 'base64');
    fs.writeFileSync(filePath, buffer);

    let mimeType = 'audio/mpeg';
    if (cleanName.endsWith('.wav')) mimeType = 'audio/wav';
    else if (cleanName.endsWith('.ogg')) mimeType = 'audio/ogg';
    else if (cleanName.endsWith('.m4a') || cleanName.endsWith('.aac')) mimeType = 'audio/mp4';
    else if (cleanName.endsWith('.flac')) mimeType = 'audio/flac';

    // Persist permanently into PostgreSQL database
    await saveMediaFileDb(finalFilename, rawData, mimeType, buffer.length);

    let duration = 0;
    try {
      const mm = await import('music-metadata');
      const meta = await mm.parseBuffer(buffer);
      if (meta.format?.duration && isFinite(meta.format.duration)) {
        duration = Math.round(meta.format.duration);
      }
    } catch (err) {
      console.warn('Could not parse audio duration from base64:', err);
    }

    res.json({
      success: true,
      audioUrl: `/api/media/audio/${finalFilename}`,
      filename: finalFilename,
      duration,
      size: buffer.length,
    });
  } catch (err: any) {
    console.error('Base64 audio upload error:', err);
    res.status(500).json({ success: false, error: err.message || 'Audio upload failed' });
  }
});

// Cover Image Upload (Multipart Form Data)
app.post('/api/upload/cover', (req: Request, res: Response) => {
  uploadCover.single('cover')(req, res, async (err: any) => {
    if (err) {
      console.error('Cover upload error:', err);
      return res.status(400).json({ success: false, error: err.message || 'Cover upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No cover image file provided' });
    }
    const filename = req.file.filename;
    const coverUrl = `/api/media/cover/${filename}`;

    // Persist permanently into PostgreSQL
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const base64Data = fileBuffer.toString('base64');
      const mime = req.file.mimetype || 'image/jpeg';
      await saveMediaFileDb(filename, base64Data, mime, req.file.size);
    } catch (saveErr) {
      console.error('Failed to persist cover into PostgreSQL database:', saveErr);
    }

    return res.json({
      success: true,
      coverUrl,
      filename,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

// Cover Image Upload Fallback (Base64 JSON)
app.post('/api/upload/cover-base64', async (req: Request, res: Response) => {
  try {
    const { filename, base64 } = req.body;
    if (!base64) {
      return res.status(400).json({ success: false, error: 'No cover data provided' });
    }
    const cleanName = (filename || 'cover.jpg').replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalFilename = `${Date.now()}-${cleanName}`;
    const filePath = path.join(COVERS_DIR, finalFilename);
    const rawData = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(rawData, 'base64');
    fs.writeFileSync(filePath, buffer);

    let mimeType = 'image/jpeg';
    if (cleanName.endsWith('.png')) mimeType = 'image/png';
    else if (cleanName.endsWith('.webp')) mimeType = 'image/webp';
    else if (cleanName.endsWith('.gif')) mimeType = 'image/gif';
    else if (cleanName.endsWith('.svg')) mimeType = 'image/svg+xml';

    // Persist permanently into PostgreSQL
    await saveMediaFileDb(finalFilename, rawData, mimeType, buffer.length);

    res.json({
      success: true,
      coverUrl: `/api/media/cover/${finalFilename}`,
      filename: finalFilename,
      size: buffer.length,
    });
  } catch (err: any) {
    console.error('Base64 cover upload error:', err);
    res.status(500).json({ success: false, error: err.message || 'Cover upload failed' });
  }
});

// Audio Stream Endpoint with HTTP 206 Partial Content (Range) support for scrubbing/seeking
// Resurrects from PostgreSQL database automatically if ephemeral container disk was cleared
app.get('/api/media/audio/:filename', async (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(AUDIO_DIR, filename);

  // If missing from local disk cache, restore from persistent PostgreSQL database
  if (!fs.existsSync(filePath)) {
    try {
      const dbMedia = await getMediaFileDb(filename);
      if (dbMedia && dbMedia.data) {
        const buffer = Buffer.from(dbMedia.data, 'base64');
        fs.writeFileSync(filePath, buffer);
      } else {
        return res.status(404).send('Audio file not found');
      }
    } catch (e) {
      console.error('Failed to restore audio from database:', e);
      return res.status(404).send('Audio file not found');
    }
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  let contentType = 'audio/mpeg';
  if (filename.endsWith('.wav')) contentType = 'audio/wav';
  else if (filename.endsWith('.ogg')) contentType = 'audio/ogg';
  else if (filename.endsWith('.m4a') || filename.endsWith('.aac')) contentType = 'audio/mp4';
  else if (filename.endsWith('.flac')) contentType = 'audio/flac';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
      return;
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Cover Image Endpoint with Caching Headers
// Resurrects from PostgreSQL database automatically if ephemeral container disk was cleared
app.get('/api/media/cover/:filename', async (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(COVERS_DIR, filename);

  // If missing from local disk cache, restore from persistent PostgreSQL database
  if (!fs.existsSync(filePath)) {
    try {
      const dbMedia = await getMediaFileDb(filename);
      if (dbMedia && dbMedia.data) {
        const buffer = Buffer.from(dbMedia.data, 'base64');
        fs.writeFileSync(filePath, buffer);
      } else {
        return res.status(404).send('Cover not found');
      }
    } catch (e) {
      console.error('Failed to restore cover from database:', e);
      return res.status(404).send('Cover not found');
    }
  }

  let contentType = 'image/jpeg';
  if (filename.endsWith('.png')) contentType = 'image/png';
  else if (filename.endsWith('.webp')) contentType = 'image/webp';
  else if (filename.endsWith('.gif')) contentType = 'image/gif';
  else if (filename.endsWith('.svg')) contentType = 'image/svg+xml';
  else if (filename.endsWith('.mp4')) contentType = 'video/mp4';
  else if (filename.endsWith('.webm')) contentType = 'video/webm';
  else if (filename.endsWith('.mov')) contentType = 'video/quicktime';
  else if (filename.endsWith('.ogg')) contentType = 'video/ogg';

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range && contentType.startsWith('video/')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  }
});

// ----------------- GOOGLE DRIVE & 3RD-PARTY CLOUD AUDIO STREAMING -----------------
// Helper to extract Google Drive file ID or convert cloud links
function extractDriveFileId(inputUrl: string): string | null {
  const trimmed = inputUrl.trim();
  const match = trimmed.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=|uc\?export=download&id=)|[?&]id=)([a-zA-Z0-9_-]{20,})/);
  if (match) return match[1];
  // If user pasted just the ID
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(trimmed)) return trimmed;
  return null;
}

// Google Drive Audio Streaming Proxy with Byte-Range Scrubbing Support
app.get('/api/media/drive-stream/:fileId', async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId;
    if (!fileId) {
      return res.status(400).send('File ID is required');
    }

    const driveUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let driveRes = await fetch(driveUrl, { headers, redirect: 'follow' });

    // Handle Google Drive virus scan warning page for large files
    const responseText = await driveRes.clone().text().catch(() => '');
    if (responseText && responseText.includes('uc-download-link')) {
      const match = responseText.match(/href="([^"]+confirm=[^"]+)"/);
      if (match && match[1]) {
        const confirmUrl = match[1].replace(/&amp;/g, '&');
        driveRes = await fetch(confirmUrl, { headers, redirect: 'follow' });
      }
    }

    if (!driveRes.ok && driveRes.status !== 206) {
      return res.status(driveRes.status).send('Could not retrieve audio from Google Drive. Ensure the file link is set to "Anyone with the link can view".');
    }

    const contentType = driveRes.headers.get('content-type') || 'audio/mpeg';
    const contentRange = driveRes.headers.get('content-range');
    const contentLength = driveRes.headers.get('content-length');
    const acceptRanges = driveRes.headers.get('accept-ranges') || 'bytes';

    res.status(driveRes.status);
    res.setHeader('Content-Type', contentType.includes('text') || contentType.includes('html') ? 'audio/mpeg' : contentType);
    res.setHeader('Accept-Ranges', acceptRanges);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (driveRes.body) {
      // Stream directly to client
      const nodeStream = (await import('stream')).Readable.fromWeb(driveRes.body as any);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    console.error('Drive stream proxy error:', err);
    res.status(500).send('Failed to stream audio from Google Drive');
  }
});

// Import Cloud File (Google Drive, Dropbox, OneDrive, or Direct URL) into PostgreSQL Database
app.post('/api/media/import-cloud-file', async (req: Request, res: Response) => {
  try {
    const { url, preferredTitle } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const driveId = extractDriveFileId(url);
    let targetDownloadUrl = url.trim();

    if (driveId) {
      targetDownloadUrl = `https://docs.google.com/uc?export=download&id=${driveId}`;
    } else if (targetDownloadUrl.includes('dropbox.com')) {
      targetDownloadUrl = targetDownloadUrl.replace(/\?dl=[01]/, '?raw=1').replace(/&dl=[01]/, '&raw=1');
      if (!targetDownloadUrl.includes('?raw=1') && !targetDownloadUrl.includes('&raw=1')) {
        targetDownloadUrl += (targetDownloadUrl.includes('?') ? '&raw=1' : '?raw=1');
      }
    }

    console.log('Server fetching cloud audio from:', targetDownloadUrl);
    let fetchRes = await fetch(targetDownloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      redirect: 'follow',
    });

    // Check for Google Drive virus confirmation token
    const htmlPeek = await fetchRes.clone().text().catch(() => '');
    if (htmlPeek && htmlPeek.includes('uc-download-link')) {
      const match = htmlPeek.match(/href="([^"]+confirm=[^"]+)"/);
      if (match && match[1]) {
        const confirmUrl = match[1].replace(/&amp;/g, '&');
        fetchRes = await fetch(confirmUrl, { redirect: 'follow' });
      }
    }

    if (!fetchRes.ok) {
      return res.status(400).json({
        success: false,
        error: `Could not fetch file (${fetchRes.status}). If using Google Drive, make sure the link sharing is set to "Anyone with the link".`,
      });
    }

    const arrayBuf = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length < 500) {
      return res.status(400).json({
        success: false,
        error: 'File appears too small or is not an audio file. Please check link permissions.',
      });
    }

    const cleanBaseName = (preferredTitle || 'cloud_track').replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalFilename = `${Date.now()}-${cleanBaseName}.mp3`;
    const filePath = path.join(AUDIO_DIR, finalFilename);

    // 1. Write to local disk cache
    fs.writeFileSync(filePath, buffer);

    // 2. Persist permanently into PostgreSQL database
    const base64Data = buffer.toString('base64');
    const mimeType = fetchRes.headers.get('content-type') || 'audio/mpeg';
    await saveMediaFileDb(finalFilename, base64Data, mimeType, buffer.length);

    let duration = 0;
    try {
      const mm = await import('music-metadata');
      const meta = await mm.parseBuffer(buffer);
      if (meta.format?.duration && isFinite(meta.format.duration)) {
        duration = Math.round(meta.format.duration);
      }
    } catch (parseErr) {
      console.warn('Could not parse duration for cloud audio:', parseErr);
    }

    res.json({
      success: true,
      audioUrl: `/api/media/audio/${finalFilename}`,
      filename: finalFilename,
      duration,
      size: buffer.length,
      streamUrl: driveId ? `/api/media/drive-stream/${driveId}` : `/api/media/audio/${finalFilename}`,
    });
  } catch (err: any) {
    console.error('Import cloud file error:', err);
    res.status(500).json({ success: false, error: err.message || 'Import failed' });
  }
});

// Import Cloud Artwork (Google Drive Image/GIF/Video, Dropbox, or Direct Image URL)
app.post('/api/media/import-cloud-cover', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const driveId = extractDriveFileId(url);
    let targetDownloadUrl = url.trim();

    if (driveId) {
      targetDownloadUrl = `https://docs.google.com/uc?export=download&id=${driveId}`;
    }

    let fetchRes = await fetch(targetDownloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      redirect: 'follow',
    });

    // Check for Google Drive virus confirmation token
    const htmlPeek = await fetchRes.clone().text().catch(() => '');
    if (htmlPeek && htmlPeek.includes('uc-download-link')) {
      const match = htmlPeek.match(/href="([^"]+confirm=[^"]+)"/);
      if (match && match[1]) {
        const confirmUrl = match[1].replace(/&amp;/g, '&');
        fetchRes = await fetch(confirmUrl, { redirect: 'follow' });
      }
    }

    // High performance direct Google CDN fallback if uc download fails
    if (!fetchRes.ok && driveId) {
      fetchRes = await fetch(`https://lh3.googleusercontent.com/d/${driveId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
    }

    if (!fetchRes.ok) {
      return res.status(400).json({
        success: false,
        error: `Could not fetch image (${fetchRes.status}). Ensure the Google Drive file is set to "Anyone with the link".`,
      });
    }

    const arrayBuf = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Image file appears invalid or too small.',
      });
    }

    const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('gif')) ext = '.gif';
    else if (contentType.includes('webp')) ext = '.webp';
    else if (contentType.includes('mp4')) ext = '.mp4';
    else if (contentType.includes('webm')) ext = '.webm';

    const finalFilename = `${Date.now()}-drive_cover${ext}`;
    const filePath = path.join(COVERS_DIR, finalFilename);

    fs.writeFileSync(filePath, buffer);
    const base64Data = buffer.toString('base64');
    await saveMediaFileDb(finalFilename, base64Data, contentType, buffer.length);

    res.json({
      success: true,
      coverUrl: `/api/media/cover/${finalFilename}`,
      filename: finalFilename,
      mimeType: contentType,
      size: buffer.length,
    });
  } catch (err: any) {
    console.error('Import cloud cover error:', err);
    res.status(500).json({ success: false, error: err.message || 'Cover import failed' });
  }
});

// Accurate Audio Duration Detection (Inspects local files or Google Drive / Cloud streams)
app.post('/api/media/detect-duration', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'url is required' });
    }

    const mm = await import('music-metadata');
    let duration = 0;

    // 1. Local audio file
    if (url.startsWith('/api/media/audio/')) {
      const filename = path.basename(url);
      const filePath = path.join(AUDIO_DIR, filename);
      if (fs.existsSync(filePath)) {
        const meta = await mm.parseFile(filePath);
        if (meta.format?.duration && isFinite(meta.format.duration)) {
          duration = Math.round(meta.format.duration);
        }
      }
    } else {
      // 2. Google Drive stream or cloud link
      const driveId = extractDriveFileId(url);
      let targetUrl = url.trim();
      if (driveId) {
        targetUrl = `https://docs.google.com/uc?export=download&id=${driveId}`;
      }
      const fetchRes = await fetch(targetUrl, {
        headers: { Range: 'bytes=0-1048576', 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      if (fetchRes.ok) {
        const arrayBuf = await fetchRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const meta = await mm.parseBuffer(buffer);
        if (meta.format?.duration && isFinite(meta.format.duration)) {
          duration = Math.round(meta.format.duration);
        }
      }
    }

    if (duration > 0) {
      res.json({ success: true, duration });
    } else {
      res.json({ success: false, error: 'Could not detect duration' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Duration detection failed' });
  }
});

// Probe external audio / media URL (for the "Pull from web/video" feature)
app.post('/api/media/probe-url', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Try HEAD request first
    let headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
    if (!headRes || !headRes.ok) {
      // Fallback: try GET with small range
      headRes = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1024' },
        redirect: 'follow',
      }).catch(() => null);
    }

    if (!headRes || !headRes.ok) {
      return res.json({
        success: true,
        reachable: false,
        warning: 'URL could not be probed directly (CORS or network restriction), but can still be used as a stream player link.',
      });
    }

    const contentType = headRes.headers.get('content-type') || 'audio/mpeg';
    const contentLength = headRes.headers.get('content-length');
    const size = contentLength ? parseInt(contentLength, 10) : 0;

    res.json({
      success: true,
      reachable: true,
      contentType,
      size,
    });
  } catch (err: any) {
    res.json({
      success: true,
      reachable: false,
      warning: err.message || 'Probe error',
    });
  }
});

// ----------------- SYSTEM STATUS & HEALTH -----------------
app.get('/api/health', async (_req: Request, res: Response) => {
  const connected = await checkSqlAvailability();
  res.json({ ok: true, database: connected ? 'postgres' : 'local-temporary', persistent: connected });
});

app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const banner = (await getSettingDb('banner')) || {
      enabled: true,
      versionName: 'v2.6 Pro Edition',
      sloganText: 'School Audio Hub',
      colorTheme: 'sapphire-ice',
      ribbonEnabled: true,
      ribbonNotice: 'All audio streams are school-safe, ad-free, and curated for focused study',
    };
    const maintenance = (await getSettingDb('maintenance')) || {
      enabled: false,
      message: 'System maintenance in progress. Please check back shortly.',
      updatedAt: new Date().toISOString(),
      hasCountdown: false,
      estimatedFinishTime: null,
    };

    const dbOnline = await checkSqlAvailability();
    res.json({
      status: 'online',
      appName: 'YouSong',
      creator: 'Admin',
      database: dbOnline
        ? 'PostgreSQL (saved permanently)'
        : 'TEMPORARY LOCAL STORAGE (data is erased on redeploy)',
      version: banner.versionName,
      maintenance,
      banner,
    });
  } catch (error: any) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// ----------------- AUTHENTICATION -----------------
// 1. Password login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const cleanUsername = username.trim();
    const throttleKey = `${req.ip}|${cleanUsername.toLowerCase()}`;
    if (loginBlocked(throttleKey)) {
      return res.status(429).json({ success: false, error: 'Too many failed attempts. Please wait 15 minutes and try again.' });
    }

    const user = await getUserByUsername(cleanUsername);

    if (!user) {
      noteLoginFailure(throttleKey);
      return res.status(404).json({
        success: false,
        error: 'User does not exist. You can submit an account request below.',
      });
    }

    const check = await verifyPassword(password, user.passwordHash);
    if (!check.ok) {
      noteLoginFailure(throttleKey);
      return res.status(401).json({
        success: false,
        error: user.passwordHash
          ? 'Incorrect password.'
          : 'This account has no password set. Ask an admin to assign you a temporary password.',
      });
    }
    clearLoginFailures(throttleKey);

    // Quietly upgrade old weak password storage to salted scrypt
    let passwordHash = user.passwordHash;
    if (check.needsUpgrade) {
      try {
        passwordHash = await hashPasswordSecure(password);
        await updateUserDb(user.uid, { passwordHash });
      } catch (e) {
        console.warn('[Security] Could not upgrade password storage for', user.username, e);
        passwordHash = user.passwordHash;
      }
    }

    // Record login timestamp
    await recordUserLoginDb(user.uid);

    // Start the signed session
    setSessionCookie(req, res, { uid: user.uid, passwordHash });

    res.json({
      success: true,
      user: {
        id: user.uid,
        username: user.username,
        role: user.role,
        isApproved: user.isApproved,
        createdAt: toIsoString(user.createdAt) || new Date().toISOString(),
        note: user.note,
        temporaryPasswordAssigned: user.temporaryPasswordAssigned,
        isSuspended: user.isSuspended || false,
        suspendedReason: user.suspendedReason || null,
        lastLoginAt: new Date().toISOString(),
        lastSongListened: user.lastSongListened,
        lastSongListenedAt: toIsoString(user.lastSongListenedAt),
        chatBlocked: user.chatBlocked || false,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Please log in again.' });
  res.json({
    success: true,
    user: {
      id: user.uid,
      username: user.username,
      role: user.role,
      isApproved: user.isApproved,
      createdAt: toIsoString(user.createdAt) || new Date().toISOString(),
      note: user.note,
      temporaryPasswordAssigned: user.temporaryPasswordAssigned,
      isSuspended: user.isSuspended || false,
      suspendedReason: user.suspendedReason || null,
      lastLoginAt: toIsoString(user.lastLoginAt),
      lastSongListened: user.lastSongListened,
      lastSongListenedAt: toIsoString(user.lastSongListenedAt),
      chatBlocked: user.chatBlocked || false,
    },
  });
});

app.get('/api/auth/me/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const me = getAuthUser(req);
    if (!me || (me.uid !== userId && me.role !== 'admin')) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    const user = await getUserByUid(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user.uid,
        username: user.username,
        role: user.role,
        isApproved: user.isApproved,
        createdAt: toIsoString(user.createdAt) || new Date().toISOString(),
        note: user.note,
        temporaryPasswordAssigned: user.temporaryPasswordAssigned,
        isSuspended: user.isSuspended || false,
        suspendedReason: user.suspendedReason || null,
        lastLoginAt: toIsoString(user.lastLoginAt),
        lastSongListened: user.lastSongListened,
        lastSongListenedAt: toIsoString(user.lastSongListenedAt),
        chatBlocked: user.chatBlocked || false,
      },
    });
  } catch (error: any) {
    console.error('Fetch me error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Member Account Request (Requires Admin Approval)
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { username, password, note } = req.body;
    const clean = (username || '').trim().slice(0, 40);
    if (!clean) return res.status(400).json({ success: false, error: 'Username is required' });
    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters' });
    }

    const existing = await getUserByUsername(clean);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username is already taken or pending' });
    }

    const uid = `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const created = await createUserDb({
      uid,
      username: clean,
      passwordHash: await hashPasswordSecure(password),
      role: 'user',
      isApproved: false,
      note: (note || '').trim(),
    });

    res.json({
      success: true,
      user: {
        id: created.uid,
        username: created.username,
        role: created.role,
        isApproved: created.isApproved,
        createdAt:
          created.createdAt instanceof Date
            ? created.createdAt.toISOString()
            : String(created.createdAt || new Date().toISOString()),
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: error.message || 'Registration failed' });
  }
});

// 4. Change own password
app.post('/api/auth/change-password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const me = getAuthUser(req);
    if (!me) return res.status(401).json({ success: false, error: 'Please log in again.' });
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Valid new password required (minimum 4 characters)' });
    }

    // You can only change your own password here
    const user = await getUserByUid(me.uid);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const isTemp = user.temporaryPasswordAssigned === true;
    const typedCurrent = typeof currentPassword === 'string' ? currentPassword.trim() : '';

    // A temporary password may be replaced directly; otherwise the current password is required
    if (!isTemp || typedCurrent) {
      const check = await verifyPassword(typedCurrent, user.passwordHash);
      if (!check.ok) {
        return res.status(401).json({
          success: false,
          error: isTemp ? 'Current temporary password is incorrect' : 'Current password is incorrect',
        });
      }
    }

    const passwordHash = await hashPasswordSecure(newPassword.trim());
    await updateUserDb(user.uid, { passwordHash, temporaryPasswordAssigned: false });
    // The old session stops working after a password change, so give this browser a fresh one
    setSessionCookie(req, res, { uid: user.uid, passwordHash });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update password' });
  }
});

// ----------------- USER MANAGEMENT (ADMIN) -----------------
app.get('/api/users', async (req: Request, res: Response) => {
  try {
    const all = await getUsersDb();
    if (!isAdminReq(req)) {
      // Regular members only get the basics (needed to pick someone to chat with)
      return res.json({
        users: all
          .filter((u) => u.isApproved && !u.isSuspended)
          .map((u) => ({
            id: u.uid,
            username: u.username,
            role: u.role,
            isApproved: u.isApproved,
            createdAt: toIsoString(u.createdAt) || new Date().toISOString(),
          })),
      });
    }
    const formatted = all.map((u) => ({
      id: u.uid,
      username: u.username,
      role: u.role,
      isApproved: u.isApproved,
      note: u.note,
      createdAt: toIsoString(u.createdAt) || new Date().toISOString(),
      temporaryPasswordAssigned: u.temporaryPasswordAssigned,
      isSuspended: u.isSuspended || false,
      suspendedReason: u.suspendedReason || null,
      lastLoginAt: toIsoString(u.lastLoginAt),
      lastSongListened: u.lastSongListened || null,
      lastSongListenedAt: toIsoString(u.lastSongListenedAt),
      chatBlocked: u.chatBlocked || false,
    }));
    res.json({ users: formatted });
  } catch (error: any) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:uid/approve', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    await updateUserDb(uid, { isApproved: true });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Approve user error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:uid/reject', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { reason } = req.body || {};
    if (reason && reason.trim()) {
      await updateUserDb(uid, { isApproved: false, adminNote: reason.trim() });
    } else {
      await deleteUserDb(uid);
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Reject user error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/users/:uid', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const {
      newUsername,
      username,
      newTemporaryPassword,
      password,
      role,
      isApproved,
      chatBlocked,
      isSuspended,
      suspendedReason,
      adminNote,
      colorAccent,
    } = req.body;
    const updates: any = {};

    const targetUsername = newUsername || username;
    if (targetUsername && targetUsername.trim()) {
      updates.username = targetUsername.trim();
    }

    const targetPassword = newTemporaryPassword || password;
    if (targetPassword && targetPassword.trim()) {
      updates.passwordHash = await hashPasswordSecure(targetPassword.trim());
      updates.temporaryPasswordAssigned = true;
    }

    if (role && (role === 'admin' || role === 'user')) {
      updates.role = role;
    }

    if (typeof isApproved === 'boolean') {
      updates.isApproved = isApproved;
    }

    if (typeof chatBlocked === 'boolean') {
      updates.chatBlocked = chatBlocked;
    }

    if (typeof isSuspended === 'boolean') {
      updates.isSuspended = isSuspended;
    }

    if (suspendedReason !== undefined) {
      updates.suspendedReason = suspendedReason;
    }

    if (adminNote !== undefined) {
      updates.adminNote = adminNote;
    }

    if (colorAccent !== undefined) {
      updates.colorAccent = colorAccent;
    }

    const updated = await updateUserDb(uid, updates);
    res.json({
      success: true,
      user: updated
        ? {
            id: updated.uid,
            uid: updated.uid,
            username: updated.username,
            role: updated.role,
            isApproved: updated.isApproved,
            note: updated.note,
            temporaryPasswordAssigned: updated.temporaryPasswordAssigned,
            chatBlocked: updated.chatBlocked || false,
            isSuspended: updated.isSuspended || false,
            suspendedReason: updated.suspendedReason || null,
            adminNote: updated.adminNote || null,
            colorAccent: updated.colorAccent || 'cyan',
          }
        : null,
    });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/activity/listen', async (req: Request, res: Response) => {
  try {
    const { songTitle, songArtist } = req.body;
    const userId = getAuthUser(req)?.uid;
    if (userId && songTitle) {
      const summary = songArtist ? `${songTitle} · ${songArtist}` : songTitle;
      await recordUserSongListenedDb(userId, summary);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:uid', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const user = await getUserByUid(uid);
    if (user?.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete primary admin account' });
    }
    await deleteUserDb(uid);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- SONGS -----------------
app.get('/api/songs', async (req: Request, res: Response) => {
  try {
    const songsList = await getSongsDb();
    res.json({ songs: songsList });
  } catch (error: any) {
    console.error('Get songs error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/songs', async (req: Request, res: Response) => {
  try {
    const songData = req.body;
    if (!songData.title || !songData.artist || !songData.audioUrl) {
      return res.status(400).json({ error: 'Title, artist, and audio are required' });
    }

    const newSong = {
      id: songData.id || `song-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: songData.title.trim(),
      artist: songData.artist.trim(),
      album: songData.album?.trim() || '',
      genre: songData.genre?.trim() || 'Study',
      tags: songData.tags || [songData.genre?.toLowerCase() || 'study'],
      typeMood: songData.typeMood || 'Instrumental',
      duration: Number(songData.duration) || 180,
      audioUrl: songData.audioUrl,
      coverUrl: songData.coverUrl || '/src/assets/images/lofi_study_glass_1791054585559.jpg',
      addedAt: new Date().toISOString(),
      plays: 0,
      featured: !!songData.featured,
      description: songData.description || '',
      isLimitedEdition: !!songData.isLimitedEdition,
      limitedUntil: songData.limitedUntil || null,
      autoRemoveOnExpire: !!songData.autoRemoveOnExpire,
      badgeType: songData.badgeType || null,
      badgeMessage: songData.badgeMessage || songData.badgeCustomText || null,
      isPinned: !!songData.isPinned,
      isDroppingSoon: !!songData.isDroppingSoon,
      dropDate: songData.dropDate || null,
      autoReleaseOnDrop: !!songData.autoReleaseOnDrop,
    };

    const inserted = await insertSongDb(newSong);
    res.json({ success: true, song: inserted });
  } catch (error: any) {
    console.error('Insert song error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/songs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = await updateSongDb(id, updates);
    res.json({ success: true, song: updated });
  } catch (error: any) {
    console.error('Update song error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/songs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteSongDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete song error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/songs/:id/play', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};
    // ADMIN LISTENS SHOULD NEVER COUNT TOWARDS ANYTHING
    if (role === 'admin') {
      return res.json({ success: true, ignored: true, reason: 'Admin listens never count towards plays or top hits' });
    }
    await incrementSongPlayDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Increment song play error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset Plays Counter for a Song
app.post('/api/songs/:id/reset-plays', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await resetSongPlaysDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Reset song plays error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk Reset Plays Counter for multiple or all songs
app.post('/api/songs/bulk-reset-plays', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body || {};
    await bulkResetSongPlaysDb(Array.isArray(ids) ? ids : undefined);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Bulk reset song plays error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fix all previous songs with incorrect duration across database
app.post('/api/admin/songs/fix-durations', async (req: Request, res: Response) => {
  try {
    const updatedCount = await fixAllPreviousSongsDuration(AUDIO_DIR);
    res.json({ success: true, updatedCount });
  } catch (error: any) {
    console.error('Fix durations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk Update Songs (Bulk Tagging, Visibility/Hidden from users, Spotlight, Genres, Status)
app.post('/api/songs/bulk-update', async (req: Request, res: Response) => {
  try {
    const { songIds, updates, tagOperation } = req.body;
    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ success: false, error: 'songIds array is required' });
    }
    const updated = await bulkUpdateSongsDb(songIds, updates || {}, tagOperation);
    res.json({ success: true, count: updated.length, songs: updated });
  } catch (error: any) {
    console.error('Bulk update songs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk Delete Songs
app.post('/api/songs/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { songIds } = req.body;
    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ success: false, error: 'songIds array is required' });
    }
    await bulkDeleteSongsDb(songIds);
    res.json({ success: true, count: songIds.length });
  } catch (error: any) {
    console.error('Bulk delete songs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-Tag Rules Endpoints
app.get('/api/settings/auto-tags', async (_req: Request, res: Response) => {
  try {
    const rules = await getSettingDb('auto_tag_rules');
    res.json({ success: true, rules: rules || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/auto-tags', async (req: Request, res: Response) => {
  try {
    const { rules } = req.body;
    await setSettingDb('auto_tag_rules', rules);
    res.json({ success: true, rules });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Spotlight Config Endpoints
app.get('/api/settings/spotlight', async (_req: Request, res: Response) => {
  try {
    const config = await getSettingDb('spotlight_config');
    res.json({
      success: true,
      config: config || {
        enabled: false,
        title: '🌟 Exclusive Spotlight Showcase',
        subtitle: 'Experience this week’s premier sound selection — all regular channels paused.',
        bannerBadgeText: 'SPOTLIGHT ONLY MODE ACTIVE',
        theme: 'gold',
        hideAllOtherElements: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/spotlight', async (req: Request, res: Response) => {
  try {
    const { config } = req.body;
    await setSettingDb('spotlight_config', config);
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------- PLAYLISTS -----------------
app.get('/api/playlists', async (req: Request, res: Response) => {
  try {
    // Members only ever get their own playlists; admins may ask for anyone's
    const userId = isAdminReq(req) ? (req.query.userId as string | undefined) : getAuthUser(req).uid;
    const list = await getPlaylistsDb(userId);
    res.json({ playlists: list });
  } catch (error: any) {
    console.error('Get playlists error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/playlists', async (req: Request, res: Response) => {
  try {
    const { name, description, coverUrl } = req.body;
    const userId = getAuthUser(req).uid;
    if (!name || !userId) {
      return res.status(400).json({ error: 'Name and userId are required' });
    }

    const newPl = await createPlaylistDb({
      id: `pl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId,
      name: name.trim(),
      description: description?.trim() || '',
      coverUrl: coverUrl || '/src/assets/images/lofi_study_glass_1791054585559.jpg',
      songIds: [],
      createdAt: new Date().toISOString(),
    });
    res.json({ success: true, playlist: newPl });
  } catch (error: any) {
    console.error('Create playlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/playlists/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isAdminReq(req)) {
      const mine = await getPlaylistsDb(getAuthUser(req).uid);
      if (!mine.some((p: any) => p.id === id)) return res.status(403).json({ error: 'Not your playlist' });
    }
    const { userId: _ignoredOwner, id: _ignoredId, ...updates } = req.body || {};
    const updated = await updatePlaylistDb(id, updates);
    res.json({ success: true, playlist: updated });
  } catch (error: any) {
    console.error('Update playlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/playlists/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isAdminReq(req)) {
      const mine = await getPlaylistsDb(getAuthUser(req).uid);
      if (!mine.some((p: any) => p.id === id)) return res.status(403).json({ error: 'Not your playlist' });
    }
    await deletePlaylistDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete playlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- FAVORITES -----------------
app.get('/api/favorites/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (getAuthUser(req).uid !== userId && !isAdminReq(req)) return res.status(403).json({ error: 'Not allowed' });
    const favs = await getFavoritesDb(userId);
    res.json({ favorites: favs });
  } catch (error: any) {
    console.error('Get favorites error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/favorites/:userId/toggle', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (getAuthUser(req).uid !== userId && !isAdminReq(req)) return res.status(403).json({ error: 'Not allowed' });
    const { songId } = req.body;
    if (!songId) return res.status(400).json({ error: 'songId required' });
    const isFav = await toggleFavoriteDb(userId, songId);
    res.json({ success: true, isFavorite: isFav });
  } catch (error: any) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- SONG REQUESTS & CONVERSION PIPELINE -----------------
app.get('/api/requests', async (req: Request, res: Response) => {
  try {
    const list = await getRequestsDb();
    // Regular users only ever see their own submissions. The holding queue stays hidden.
    if (!isAdminReq(req)) {
      const me = getAuthUser(req).uid;
      const userFiltered = list.filter((r) => r.requestedByUserId === me);
      return res.json({ requests: userFiltered });
    }

    // Admin sees all requests in the admin dashboard review queue
    res.json({ requests: list });
  } catch (error: any) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/requests', async (req: Request, res: Response) => {
  try {
    const {
      songTitle,
      artist,
      webLink,
      coverUrl,
      notes,
      requestType,
      genre,
    } = req.body;
    const requestedByUserId = getAuthUser(req).uid;
    const requestedByUsername = getAuthUser(req).username;

    if (!songTitle || !songTitle.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (requestType !== 'feature') {
      const linkCheck = checkYouTubeLink(String(webLink || ''));
      if (!linkCheck.videoId) {
        return res.status(400).json({ error: linkCheck.message });
      }
    }

    const defaultCover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80';

    const newReq = await createRequestDb({
      id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      songTitle: songTitle.trim(),
      artist: (artist || '').trim(),
      webLink: (webLink || '').trim(),
      coverUrl: (coverUrl || defaultCover).trim(),
      notes: (notes || '').trim(),
      requestedByUserId: requestedByUserId || 'guest',
      requestedByUsername: (requestedByUsername || 'Listener').trim(),
      createdAt: new Date().toISOString(),
      status: 'pending', // Lands immediately in holding queue awaiting admin review
      requestType: requestType === 'feature' ? 'feature' : 'song',
      genre: (genre || 'Vibe / Chill').trim(),
    });

    console.log(`[SongPipeline] New song request submitted to holding queue: "${newReq.songTitle}" by ${newReq.requestedByUsername}`);
    res.json({ success: true, request: newReq });
  } catch (error: any) {
    console.error('Create request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin Review & Editing Step (Mandatory Gate):
// Admin edits song title, artist info, cover art, or notes before any conversion happens
app.patch('/api/admin/requests/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      songTitle,
      artist,
      webLink,
      coverUrl,
      notes,
      genre,
      status,
      adminNote,
    } = req.body;

    const existingReq = await getRequestByIdDb(id);
    if (!existingReq) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const updates: any = {};
    if (songTitle !== undefined) updates.songTitle = songTitle.trim();
    if (artist !== undefined) updates.artist = artist.trim();
    if (webLink !== undefined) updates.webLink = webLink.trim();
    if (coverUrl !== undefined) updates.coverUrl = coverUrl.trim();
    if (notes !== undefined) updates.notes = notes.trim();
    if (genre !== undefined) updates.genre = genre.trim();
    if (adminNote !== undefined) updates.adminNote = adminNote;
    if (status !== undefined) updates.status = status;

    const updated = await updateRequestFullDb(id, updates);
    console.log(`[SongPipeline] Admin updated request metadata for ${id}: "${updated?.songTitle}" - "${updated?.artist}"`);
    res.json({ success: true, request: updated });
  } catch (error: any) {
    console.error('Patch request error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ----------------- YOUTUBE EMBED HELPERS -----------------
// Songs from requests are played through the official YouTube embedded player.
// We only store the video ID as audioUrl = "youtube:VIDEO_ID" (no downloading / converting).
function extractYouTubeVideoId(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '').replace(/^music\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && /^[A-Za-z0-9_-]{11}$/.test(parts[1] || '')) {
        return parts[1];
      }
    }
  } catch (_) {}
  return null;
}

type YouTubeCheck = { videoId: string | null; message: string };

/** Explains in plain words why a pasted link can or cannot be used. */
function checkYouTubeLink(input: string): YouTubeCheck {
  const raw = (input || '').trim();
  if (!raw) return { videoId: null, message: 'Paste a YouTube link first.' };
  const id = extractYouTubeVideoId(raw);
  if (id) return { videoId: id, message: '' };

  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '').replace(/^music\./, '');
    const isYt = host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com';
    if (!host.includes('.')) {
      return {
        videoId: null,
        message: 'That does not look like a link. Copy it from the YouTube address bar or the Share button.',
      };
    }
    if (!isYt) {
      return {
        videoId: null,
        message: 'Only YouTube links work. Spotify, SoundCloud, Apple Music and other sites are not supported.',
      };
    }
    const first = u.pathname.split('/').filter(Boolean)[0] || '';
    if (first === 'playlist' || (u.searchParams.get('list') && !u.searchParams.get('v'))) {
      return {
        videoId: null,
        message: 'That is a playlist link. Open the one song you want and copy the link from that video.',
      };
    }
    if (first === 'channel' || first === 'c' || first === 'user' || first.startsWith('@')) {
      return {
        videoId: null,
        message: 'That is a channel link. Open the one song you want and copy the link from that video.',
      };
    }
    return {
      videoId: null,
      message: 'That YouTube link does not point to a single video. Open the song and copy its link.',
    };
  } catch {
    return {
      videoId: null,
      message: 'That does not look like a link. Copy it from the YouTube address bar or the Share button.',
    };
  }
}

// Backend Conversion & Cloud Storage (Triggered ONLY After Admin Approval):
// 1. Rips audio with yt-dlp & converts to .mp3 temporarily on server
// 2. Uploads .mp3 directly to Google Drive folder using Google Drive API
// 3. Generates public streaming URL
// 4. Immediately deletes temporary file from local server to prevent storage caps
// 5. Moves track into staging state for Test Stream verification
app.post('/api/admin/requests/:id/approve-and-process', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { songTitle, artist, coverUrl, genre } = req.body;
    let authHeader = req.headers.authorization;
    let googleAccessToken = req.body.googleAccessToken;

    if (!googleAccessToken && authHeader?.startsWith('Bearer ')) {
      googleAccessToken = authHeader.substring(7);
    }

    const requestItem = await getRequestByIdDb(id);
    if (!requestItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const finalTitle = (songTitle || requestItem.songTitle || 'Untitled').trim();
    const finalArtist = (artist || requestItem.artist || 'Unknown Artist').trim();
    const finalCover = (coverUrl || requestItem.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80').trim();
    const finalGenre = (genre || requestItem.genre || 'Vibe / Chill').trim();
    const youtubeUrl = requestItem.webLink || '';

    if (!youtubeUrl) {
      return res.status(400).json({ error: 'No YouTube link attached to this request' });
    }

    const linkCheck = checkYouTubeLink(youtubeUrl);
    const videoId = linkCheck.videoId;
    if (!videoId) {
      return res.status(400).json({ error: linkCheck.message });
    }

    // Check the video exists and allows embedding (YouTube oEmbed returns 401/403 when embedding is off)
    let oembedTitle = '';
    try {
      const oembed = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (oembed.status === 401 || oembed.status === 403) {
        return res.status(400).json({ error: 'The owner of this video does not allow it to be embedded on other sites. Ask the requester for a different upload (for example the artist\'s official audio).' });
      }
      if (oembed.status === 404) {
        return res.status(400).json({ error: 'This YouTube video was not found or is private.' });
      }
      if (oembed.ok) {
        const info: any = await oembed.json();
        oembedTitle = (info?.title || '').toString();
      }
    } catch (checkErr: any) {
      console.warn('[SongPipeline] YouTube embed check skipped:', checkErr?.message || checkErr);
    }

    const embedTitle = finalTitle === 'Untitled' && oembedTitle ? oembedTitle : finalTitle;
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const embedCover = coverUrl || requestItem.coverUrl || thumbnail;
    const audioUrl = `youtube:${videoId}`;

    // Straight to staging: nothing to download or convert.
    // (Real duration is measured by the player the first time the song plays.)
    const staged = await updateRequestFullDb(id, {
      songTitle: embedTitle,
      artist: finalArtist,
      coverUrl: embedCover,
      genre: finalGenre,
      reviewedAt: new Date().toISOString(),
      status: 'staging',
      audioUrl: audioUrl,
      stagingAudioUrl: audioUrl,
      driveFileId: null,
      driveFolderId: null,
      duration: 180,
      processingProgress: 'Ready. Use Test Stream, then Publish.',
      processingError: null,
    });

    console.log(`[SongPipeline] Request ${id} approved as YouTube embed (${videoId}) and moved to STAGING.`);
    res.json({ success: true, request: staged });
  } catch (error: any) {
    console.error('[SongPipeline] Conversion & Storage pipeline failed:', error);
    await updateRequestFullDb(id, {
      status: 'pending',
      processingProgress: null,
      processingError: error.message || 'Audio conversion failed',
    });
    res.status(500).json({ error: error.message || 'Conversion failed' });
  }
});

// Testing & Final Publishing:
// Once verified in staging, admin toggles 'Publish' to make it active on the public site library (YouSong)
app.post('/api/admin/requests/:id/publish', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { isPublished, hideVideo } = req.body;
    const requestItem = await getRequestByIdDb(id);
    if (!requestItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (isPublished) {
      // Generate a new song record in the public library
      const songId = `song-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      // YouTube songs can be flagged so listeners don't see the video box ("youtube:ID:hidden")
      let publishAudioUrl = requestItem.audioUrl || '';
      if (hideVideo && /^youtube:[A-Za-z0-9_-]{11}$/.test(publishAudioUrl)) {
        publishAudioUrl += ':hidden';
      }
      const newSong = await insertSongDb({
        id: songId,
        title: requestItem.songTitle,
        artist: requestItem.artist || 'Unknown Artist',
        album: 'YouSong Community',
        genre: requestItem.genre || 'Vibe / Chill',
        duration: requestItem.duration || 180,
        audioUrl: publishAudioUrl,
        coverUrl: requestItem.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
        addedAt: new Date().toISOString(),
        plays: 0,
        featured: false,
        description: `Requested by ${requestItem.requestedByUsername} via YouSong Pipeline.`,
        tags: [requestItem.genre?.toLowerCase() || 'vibe', 'community', 'youtube-import'],
      });

      const updated = await updateRequestFullDb(id, {
        status: 'published',
        publishedSongId: songId,
        publishedAt: new Date().toISOString(),
        processingProgress: 'Live in YouSong Public Library',
      });

      console.log(`[SongPipeline] Successfully PUBLISHED track "${newSong.title}" by "${newSong.artist}" (Song ID: ${songId}) to YouSong public library!`);
      return res.json({ success: true, request: updated, song: newSong });
    } else {
      // If toggled off, remove from public songs table and return to staging
      if (requestItem.publishedSongId) {
        await deleteSongDb(requestItem.publishedSongId);
      }
      const updated = await updateRequestFullDb(id, {
        status: 'staging',
        publishedSongId: null,
        publishedAt: null,
        processingProgress: 'Unpublished, in Staging state',
      });
      return res.json({ success: true, request: updated });
    }
  } catch (error: any) {
    console.error('Publish request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Google Drive Streaming Proxy with Range Support
app.get('/api/drive/stream/:fileId', async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    // Check if client requested a byte range (for audio seeking)
    const rangeHeader = req.headers.range;
    const fetchHeaders: any = {};
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    const driveRes = await fetch(driveUrl, { headers: fetchHeaders, redirect: 'follow' });
    
    if (!driveRes.ok && driveRes.status !== 206) {
      return res.redirect(driveUrl);
    }

    // Forward streaming headers
    res.status(driveRes.status);
    const contentType = driveRes.headers.get('content-type') || 'audio/mpeg';
    const contentLength = driveRes.headers.get('content-length');
    const contentRange = driveRes.headers.get('content-range');
    const acceptRanges = driveRes.headers.get('accept-ranges') || 'bytes';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', acceptRanges);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (driveRes.body) {
      const arrayBuffer = await driveRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } else {
      res.redirect(driveUrl);
    }
  } catch (err: any) {
    console.error('Drive streaming proxy error:', err);
    res.redirect(`https://drive.google.com/uc?export=download&id=${fileId}`);
  }
});

app.delete('/api/admin/requests/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await getRequestByIdDb(id);
    if (item?.publishedSongId) {
      await deleteSongDb(item.publishedSongId);
    }
    await deleteRequestDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- POPUPS -----------------
app.get('/api/popups', async (req: Request, res: Response) => {
  try {
    const list = await getPopupsDb();
    res.json({ popups: list });
  } catch (error: any) {
    console.error('Get popups error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/popups', async (req: Request, res: Response) => {
  try {
    const { targetUserId, title, message, type, durationMinutes, expiresAt, isDismissible } = req.body;
    let computedExpiresAt = null;
    if (durationMinutes && Number(durationMinutes) > 0) {
      computedExpiresAt = new Date(Date.now() + Number(durationMinutes) * 60 * 1000);
    } else if (expiresAt) {
      computedExpiresAt = new Date(expiresAt);
    }

    const newPopup = await createPopupDb({
      id: `popup-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      targetUserId: targetUserId || 'all',
      title: title || 'Notice',
      message: message || '',
      type: type || 'announcement',
      createdAt: new Date().toISOString(),
      active: true,
      expiresAt: computedExpiresAt || undefined,
      isDismissible: isDismissible !== false,
    });
    res.json({ success: true, popup: newPopup });
  } catch (error: any) {
    console.error('Create popup error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/popups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { active } = req.body;
    const updated = await updatePopupDb(id, active);
    res.json({ success: true, popup: updated });
  } catch (error: any) {
    console.error('Patch popup error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/popups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deletePopupDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete popup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- BANNER & MAINTENANCE SETTINGS -----------------
const getBannerHandler = async (_req: Request, res: Response) => {
  try {
    const banner = (await getSettingDb('banner')) || {
      enabled: true,
      versionName: 'v2.6 Pro Edition',
      sloganText: 'School Audio Hub',
      colorTheme: 'sapphire-ice',
      ribbonEnabled: true,
      ribbonNotice: 'All audio streams are school-safe, ad-free, and curated for focused study',
    };
    res.json({ banner });
  } catch (error: any) {
    console.error('Get banner error:', error);
    res.status(500).json({ error: error.message });
  }
};

const postBannerHandler = async (req: Request, res: Response) => {
  try {
    const current = (await getSettingDb('banner')) || {};
    const updated = {
      ...current,
      ...req.body,
      customGradientFrom: req.body.customGradientFrom !== undefined ? req.body.customGradientFrom : current.customGradientFrom,
      customGradientTo: req.body.customGradientTo !== undefined ? req.body.customGradientTo : current.customGradientTo,
    };
    await setSettingDb('banner', updated);
    res.json({ success: true, banner: updated });
  } catch (error: any) {
    console.error('Post banner error:', error);
    res.status(500).json({ error: error.message });
  }
};

app.get('/api/banner', getBannerHandler);
app.get('/api/admin/banner', getBannerHandler);
app.post('/api/banner', postBannerHandler);
app.post('/api/admin/banner', postBannerHandler);

app.get('/api/maintenance', async (req: Request, res: Response) => {
  try {
    const maintenance = (await getSettingDb('maintenance')) || {
      enabled: false,
      message: 'System maintenance in progress.',
      updatedAt: new Date().toISOString(),
      hasCountdown: false,
      estimatedFinishTime: null,
      autoDisableOnCountdown: false,
    };

    // Auto-disable maintenance mode if countdown timer reached zero and setting is enabled
    if (
      maintenance.enabled &&
      maintenance.hasCountdown &&
      maintenance.autoDisableOnCountdown &&
      maintenance.estimatedFinishTime
    ) {
      const finishDate = new Date(maintenance.estimatedFinishTime);
      if (!isNaN(finishDate.getTime()) && new Date() >= finishDate) {
        maintenance.enabled = false;
        await setSettingDb('maintenance', maintenance);
      }
    }

    res.json({ maintenance });
  } catch (error: any) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/maintenance', async (req: Request, res: Response) => {
  try {
    const { enabled, message, hasCountdown, estimatedFinishTime, autoDisableOnCountdown } = req.body;
    const current = (await getSettingDb('maintenance')) || {};
    const updated = {
      ...current,
      enabled: !!enabled,
      message: message || current.message || 'System maintenance in progress.',
      updatedAt: new Date().toISOString(),
      hasCountdown: !!hasCountdown,
      estimatedFinishTime: hasCountdown ? estimatedFinishTime || null : null,
      autoDisableOnCountdown: !!autoDisableOnCountdown,
    };
    await setSettingDb('maintenance', updated);
    res.json({ success: true, maintenance: updated });
  } catch (error: any) {
    console.error('Post maintenance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- CHAT SYSTEM (WITH STRICT ADMIN APPROVAL & OVERSIGHT) -----------------
// 1. Chat Requests
app.get('/api/chat/requests', async (req: Request, res: Response) => {
  try {
    if (!isAdminReq(req)) {
      return res.json({ requests: await getChatRequestsForUserDb(getAuthUser(req).uid) });
    }
    const { userId } = req.query;
    if (userId && typeof userId === 'string') {
      const userRequests = await getChatRequestsForUserDb(userId);
      return res.json({ requests: userRequests });
    }
    const allRequests = await getChatRequestsDb();
    res.json({ requests: allRequests });
  } catch (error: any) {
    console.error('Get chat requests error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/requests', async (req: Request, res: Response) => {
  try {
    const { receiverId, receiverUsername, reason } = req.body;
    const senderId = getAuthUser(req).uid;
    const senderUsername = getAuthUser(req).username;
    if (!senderId || !receiverId) {
      return res.status(400).json({ error: 'Sender and receiver are required' });
    }
    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot request a chat with yourself' });
    }

    // Check if sender has global chat block
    const sender = await getUserByUid(senderId);
    if (sender?.chatBlocked) {
      return res.status(403).json({ error: 'Your chat privileges have been disabled by Administrator' });
    }

    // Check pairing block
    const isBlocked = await isChatPairingBlockedDb(senderId, receiverId);
    if (isBlocked) {
      return res.status(403).json({
        error: 'Communication between these two accounts is restricted by Administrator',
      });
    }

    const requestId = `chreq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const created = await createChatRequestDb({
      id: requestId,
      senderId,
      senderUsername: senderUsername || sender?.username || 'User',
      receiverId,
      receiverUsername: receiverUsername || 'User',
      reason,
    });

    res.json({ success: true, request: created });
  } catch (error: any) {
    console.error('Create chat request error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/chat/requests/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;
    if (status !== 'approved' && status !== 'declined') {
      return res.status(400).json({ error: 'Status must be approved or declined' });
    }

    const updated = await updateChatRequestStatusDb(id, status, adminNote);

    // Approving a request opens the conversation between the two users
    let thread = null;
    if (status === 'approved') {
      const reqItem: any = (await getChatRequestByIdDb(id)) || updated;
      if (reqItem?.senderId && reqItem?.receiverId) {
        thread = await createOrForceChatThreadDb(
          reqItem.senderId,
          reqItem.senderUsername || 'User',
          reqItem.receiverId,
          reqItem.receiverUsername || 'User',
          false
        );
      }
    }
    res.json({ success: true, request: updated, thread });
  } catch (error: any) {
    console.error('Update chat request error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chat/requests/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isAdminReq(req)) {
      const item: any = await getChatRequestByIdDb(id);
      if (!item || item.senderId !== getAuthUser(req).uid) {
        return res.status(403).json({ error: 'You can only cancel your own requests' });
      }
    }
    await deleteChatRequestDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete chat request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Chat Threads
app.get('/api/chat/threads', async (req: Request, res: Response) => {
  try {
    if (!isAdminReq(req)) {
      return res.json({ threads: await getChatThreadsForUserDb(getAuthUser(req).uid) });
    }
    const { userId, mode } = req.query;
    if (userId && typeof userId === 'string') {
      const user = await getUserByUid(userId);
      // Admin in oversight mode gets all threads; in personal messaging mode gets their own threads
      if (user?.role === 'admin' && mode === 'oversight') {
        const allThreads = await getChatThreadsDb();
        return res.json({ threads: allThreads });
      }
      const userThreads = await getChatThreadsForUserDb(userId);
      return res.json({ threads: userThreads });
    }
    // Admin master list of all threads
    const allThreads = await getChatThreadsDb();
    res.json({ threads: allThreads });
  } catch (error: any) {
    console.error('Get chat threads error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin force-start a chat between any two users
app.post('/api/chat/threads/force', async (req: Request, res: Response) => {
  try {
    const { user1Id, user1Username, user2Id, user2Username } = req.body;
    if (!user1Id || !user2Id) {
      return res.status(400).json({ error: 'Both users required' });
    }
    if (user1Id === user2Id) {
      return res.status(400).json({ error: 'Cannot pair user with themselves' });
    }

    const thread = await createOrForceChatThreadDb(
      user1Id,
      user1Username || 'User A',
      user2Id,
      user2Username || 'User B',
      false
    );
    res.json({ success: true, thread });
  } catch (error: any) {
    console.error('Force chat thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin terminate / stop thread
app.patch('/api/chat/threads/:id/terminate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const updated = await setChatThreadTerminatedDb(
      id,
      true,
      reason || 'Messaging disabled by Administrator'
    );
    res.json({ success: true, thread: updated });
  } catch (error: any) {
    console.error('Terminate thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin re-open thread
app.patch('/api/chat/threads/:id/reopen', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await setChatThreadTerminatedDb(id, false, undefined);
    res.json({ success: true, thread: updated });
  } catch (error: any) {
    console.error('Reopen thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chat/threads/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteChatThreadDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete chat thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// User hide/delete thread from their view (pops back up on new message)
app.post('/api/chat/threads/:id/hide', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUser(req).uid;
    await hideChatThreadForUserDb(id, userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Hide chat thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Suspended user creates/retrieves direct appeal thread with Admin
app.post('/api/chat/appeal', async (req: Request, res: Response) => {
  try {
    // A suspended person can only open an appeal for their own account
    const userId = getAuthUser(req).uid;
    const username = getAuthUser(req).username;
    const user = await getUserByUid(userId);
    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }
    const thread = await createOrGetAppealThreadDb(userId, username);
    res.json({ success: true, thread });
  } catch (error: any) {
    console.error('Appeal chat thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Chat Messages
app.get('/api/chat/messages/:threadId', async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    const me = getAuthUser(req);
    if (me.role !== 'admin') {
      const thread: any = await getChatThreadByIdDb(threadId);
      if (!thread || (thread.user1Id !== me.uid && thread.user2Id !== me.uid)) {
        return res.status(403).json({ error: 'You are not part of this conversation' });
      }
    }
    const messages = await getChatMessagesDb(threadId);
    res.json({ messages });
  } catch (error: any) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete specific chat message
app.delete('/api/chat/messages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteChatMessageDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin master feed across all conversations for live moderation
app.get('/api/chat/messages-all', async (_req: Request, res: Response) => {
  try {
    const messages = await getAllChatMessagesDb(150);
    res.json({ messages });
  } catch (error: any) {
    console.error('Get all messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/messages', async (req: Request, res: Response) => {
  try {
    const { threadId, content } = req.body;
    const me = getAuthUser(req);
    const senderId = me.uid;
    const senderUsername = me.username;
    if (!threadId || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Thread and content are required' });
    }

    const thread = await getChatThreadByIdDb(threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Conversation thread not found' });
    }
    // Only people in the conversation (or an admin) can post in it
    if (me.role !== 'admin' && thread.user1Id !== me.uid && thread.user2Id !== me.uid) {
      return res.status(403).json({ error: 'You are not part of this conversation' });
    }
    const receiverId = thread.user1Id === me.uid ? thread.user2Id : thread.user1Id;

    // If appeal thread: check participants
    if (thread.isAppealThread) {
      const u1 = await getUserByUid(thread.user1Id);
      const u2 = await getUserByUid(thread.user2Id);
      const hasSuspendedUser = (u1 && u1.isSuspended) || (u2 && u2.isSuspended);
      const sender = await getUserByUid(senderId);
      if (!hasSuspendedUser && sender?.role !== 'admin') {
        return res.status(403).json({ error: 'This suspension appeal is already resolved. Account is active.' });
      }
    }

    // Verify sender is not globally blocked or suspended (except for active direct suspension appeal threads)
    const sender = await getUserByUid(senderId);
    if (sender?.isSuspended && !thread?.isAppealThread) {
      return res.status(403).json({ error: 'Your account is suspended. Please use the suspension appeal screen.' });
    }
    if (sender?.chatBlocked && !thread?.isAppealThread) {
      return res.status(403).json({ error: 'Your chat privileges have been disabled by Administrator' });
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const created = await createChatMessageDb({
      id: messageId,
      threadId,
      senderId,
      senderUsername: senderUsername || sender?.username || 'User',
      receiverId: receiverId || '',
      content: content.trim().slice(0, 2000),
    });

    res.json({ success: true, message: created });
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(400).json({ error: error.message || 'Could not send message' });
  }
});

// 4. Pairing Blocks
app.get('/api/chat/pairing-blocks', async (_req: Request, res: Response) => {
  try {
    const blocks = await getChatPairingBlocksDb();
    res.json({ blocks });
  } catch (error: any) {
    console.error('Get pairing blocks error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/pairing-blocks', async (req: Request, res: Response) => {
  try {
    const { user1Id, user2Id, blockedBy, reason } = req.body;
    if (!user1Id || !user2Id) {
      return res.status(400).json({ error: 'Both user IDs are required' });
    }
    const created = await createChatPairingBlockDb(
      user1Id,
      user2Id,
      blockedBy || 'admin',
      reason
    );
    res.json({ success: true, block: created });
  } catch (error: any) {
    console.error('Create pairing block error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chat/pairing-blocks/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await deleteChatPairingBlockDb(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete pairing block error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- YOUTUBE LINK CHECK -----------------
// Tells the person (or admin) right away whether a pasted link will work
app.get('/api/youtube/preview', async (req: Request, res: Response) => {
  const check = checkYouTubeLink(String(req.query.url || ''));
  if (!check.videoId) {
    return res.json({ valid: false, reason: check.message });
  }
  const videoId = check.videoId;
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (oembed.status === 401 || oembed.status === 403) {
      return res.json({
        valid: false,
        videoId,
        thumbnail,
        reason:
          'The owner of this video does not allow it to be played on other sites. Try a different upload, such as the artist\'s official audio or a lyric video.',
      });
    }
    if (oembed.status === 404) {
      return res.json({ valid: false, videoId, reason: 'That video was not found, or it is private.' });
    }
    if (!oembed.ok) {
      // YouTube did not answer; the link itself looks fine
      return res.json({ valid: true, videoId, thumbnail, title: '', author: '', checked: false });
    }
    const info: any = await oembed.json();
    res.json({
      valid: true,
      videoId,
      thumbnail,
      title: String(info?.title || ''),
      author: String(info?.author_name || '').replace(/\s*-\s*Topic$/i, ''),
      checked: true,
    });
  } catch (err: any) {
    res.json({ valid: true, videoId, thumbnail, title: '', author: '', checked: false });
  }
});

// ----------------- FEATURE REQUESTS & BUG REPORTS -----------------
const feedbackHits = new Map<string, number[]>();

async function isAdminUserId(uid: unknown): Promise<boolean> {
  if (!uid || typeof uid !== 'string') return false;
  try {
    const u = await getUserByUid(uid);
    return u?.role === 'admin';
  } catch {
    return false;
  }
}

app.post('/api/feedback', async (req: Request, res: Response) => {
  try {
    const { type, title, details, area, userAgent } = req.body || {};
    const authed = getAuthUser(req);
    const userId: string | undefined = authed?.uid;
    const username: string = authed?.username || 'Guest';
    if (type !== 'feature' && type !== 'bug') {
      return res.status(400).json({ error: 'Type must be feature or bug' });
    }
    const cleanTitle = String(title || '').trim().slice(0, 140);
    const cleanDetails = String(details || '').trim().slice(0, 4000);
    if (!cleanTitle) return res.status(400).json({ error: 'Please add a short title' });
    if (!cleanDetails) return res.status(400).json({ error: 'Please add some details' });

    // Simple spam guard: 10 submissions per hour per visitor
    const key = (typeof userId === 'string' && userId) || req.ip || 'anon';
    const now = Date.now();
    const recent = (feedbackHits.get(key) || []).filter((t) => now - t < 3600_000);
    if (recent.length >= 10) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }
    recent.push(now);
    feedbackHits.set(key, recent);

    let name = String(username || '').trim().slice(0, 60);
    if (!name && typeof userId === 'string') {
      const u = await getUserByUid(userId);
      name = u?.username || '';
    }
    const item = await createFeedbackDb({
      type,
      title: cleanTitle,
      details: cleanDetails,
      area: area ? String(area).slice(0, 60) : null,
      userId: typeof userId === 'string' ? userId : null,
      username: name || 'Guest',
      userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    });
    res.json({ success: true, item });
  } catch (error: any) {
    console.error('Create feedback error:', error);
    res.status(500).json({ error: error.message || 'Could not save your submission' });
  }
});

app.get('/api/admin/feedback', async (req: Request, res: Response) => {
  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({ error: 'Admin only' });
    }
    res.json({ items: await listFeedbackDb() });
  } catch (error: any) {
    console.error('List feedback error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/feedback/:id', async (req: Request, res: Response) => {
  try {
    const { userId, status, adminNote } = req.body || {};
    if (!isAdminReq(req)) return res.status(403).json({ error: 'Admin only' });
    if (status && !['new', 'in_progress', 'done', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const ok = await updateFeedbackDb(req.params.id, {
      status,
      adminNote: adminNote === undefined ? undefined : String(adminNote).slice(0, 1000),
    });
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Update feedback error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/feedback/:id', async (req: Request, res: Response) => {
  try {
    if (!isAdminReq(req)) return res.status(403).json({ error: 'Admin only' });
    await deleteFeedbackDb(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete feedback error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------- DATABASE BACKUP & RESTORE -----------------
app.get('/api/admin/database/export', (_req: Request, res: Response) => {
  try {
    const dbPath = path.resolve(process.cwd(), 'data/local_db.json');
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="yousong_db_backup_${timestamp}.json"`);
    res.sendFile(dbPath);
  } catch (err: any) {
    console.error('Database export error:', err);
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

app.post('/api/admin/database/import', express.json({ limit: '50mb' }), (req: Request, res: Response) => {
  try {
    const raw = req.body;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.users) || !Array.isArray(raw.songs)) {
      return res.status(400).json({ error: 'Invalid database backup JSON format' });
    }
    const dbPath = path.resolve(process.cwd(), 'data/local_db.json');
    fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2));
    res.json({ success: true, message: 'Database successfully restored from backup' });
  } catch (err: any) {
    console.error('Database import error:', err);
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

// --- Supabase Hosting, Migration & Status Endpoints ---
app.get('/api/admin/database/status', async (_req: Request, res: Response) => {
  try {
    const isSql = await checkSqlAvailability();
    const connStr = getActiveConnectionString() || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
    const maskedConn = connStr
      ? connStr.replace(/:([^:@]+)@/, ':****@')
      : null;

    res.json({
      activeHosting: isSql ? 'supabase' : 'local_file',
      engine: isSql ? 'Supabase / PostgreSQL Cloud Database' : 'Local Persistent Storage (local_db.json)',
      isSqlConnected: isSql,
      persistent: isSql,
      connectionSource: getDatabaseHealth().source,
      lastError: isSql ? null : getDatabaseHealth().lastError,
      configuredConnectionString: maskedConn,
      supabaseUrl: process.env.SUPABASE_URL || null,
      hasCredentials: Boolean(connStr || process.env.SUPABASE_URL),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/database/supabase-schema', (_req: Request, res: Response) => {
  try {
    const schemaPath = path.resolve(process.cwd(), 'supabase-schema.sql');
    if (!fs.existsSync(schemaPath)) {
      return res.status(404).json({ error: 'Schema file not found' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(schemaPath);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/database/supabase-migration-sql', (_req: Request, res: Response) => {
  try {
    const fullSql = generateSupabaseMigrationSql();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="yousong_supabase_full_migration.sql"');
    res.send(fullSql);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/database/test-supabase', async (req: Request, res: Response) => {
  try {
    const { connectionString } = req.body;
    const target = connectionString || getActiveConnectionString() || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    if (!target) {
      return res.status(400).json({ error: 'Supabase PostgreSQL connection string is required' });
    }

    const result = await testSupabaseDbConnection(target);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/database/connect-supabase', async (req: Request, res: Response) => {
  try {
    const { connectionString } = req.body;
    if (!connectionString || !connectionString.trim()) {
      setSupabaseConnectionString(undefined);
      return res.json({ success: true, message: 'Switched to local database store.', activeHosting: 'local_file' });
    }

    const test = await testSupabaseDbConnection(connectionString.trim());
    if (!test.success) {
      return res.status(400).json({
        success: false,
        error: `Could not connect to Supabase: ${test.error || 'Connection failed'}. Please check your database password.`,
      });
    }

    setSupabaseConnectionString(connectionString.trim());
    const isConnected = await checkSqlAvailability();

    res.json({
      success: true,
      message: 'Successfully connected and switched active database hosting to Supabase PostgreSQL!',
      version: test.version,
      latencyMs: test.latencyMs,
      activeHosting: isConnected ? 'supabase' : 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/database/sync-to-supabase', async (req: Request, res: Response) => {
  try {
    const { connectionString } = req.body;
    const target = connectionString || getActiveConnectionString() || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    if (!target) {
      return res.status(400).json({ error: 'Supabase connection string is required to perform data sync' });
    }

    const result = await syncLocalDataToSupabase(target);
    if (result.success) {
      setSupabaseConnectionString(target);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- SONG DURATION AUTO-FIX & BACKGROUND WORKERS -----------------
async function fixAllPreviousSongsDuration(audioDir: string): Promise<number> {
  let updatedCount = 0;
  try {
    const mm = await import('music-metadata');
    const allSongs = await getSongsDb();

    for (const song of allSongs) {
      let trueDuration = 0;

      if (song.audioUrl) {
        if (song.audioUrl.startsWith('/api/media/audio/')) {
          const fname = path.basename(song.audioUrl);
          const fpath = path.join(audioDir, fname);

          if (fs.existsSync(fpath)) {
            try {
              const meta = await mm.parseFile(fpath);
              if (meta.format?.duration && isFinite(meta.format.duration)) {
                trueDuration = Math.round(meta.format.duration);
              }
            } catch (err) {
              console.warn(`Could not parse ${fname} for duration fix:`, err);
            }
          }

          if (!trueDuration) {
            // Seed wav fallbacks if container disk is fresh
            if (fname.includes('seed_acoustic')) trueDuration = 20;
            else if (fname.includes('seed_ambient')) trueDuration = 20;
            else if (fname.includes('seed_lofi')) trueDuration = 15;
            else if (fname.includes('seed_synthwave')) trueDuration = 20;
          }
        } else if (song.audioUrl.includes('drive.google.com') || song.audioUrl.includes('/api/media/drive-stream/')) {
          const driveId = extractDriveFileId(song.audioUrl);
          if (driveId) {
            try {
              const streamUrl = `https://docs.google.com/uc?export=download&id=${driveId}`;
              const resp = await fetch(streamUrl, {
                headers: { Range: 'bytes=0-1048576', 'User-Agent': 'Mozilla/5.0' },
                redirect: 'follow',
              });
              if (resp.ok) {
                const ab = await resp.arrayBuffer();
                const meta = await mm.parseBuffer(Buffer.from(ab));
                if (meta.format?.duration && isFinite(meta.format.duration)) {
                  trueDuration = Math.round(meta.format.duration);
                }
              }
            } catch {}
          }
        }
      }

      // If duration is inaccurate (e.g. defaulted to 210 / 180 or differs from true file length), fix it!
      if (trueDuration > 0 && Math.abs(song.duration - trueDuration) >= 1) {
        await updateSongDb(song.id, { duration: trueDuration });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`Auto-corrected durations for ${updatedCount} song(s) in database.`);
    }
  } catch (e) {
    console.error('Error during fixAllPreviousSongsDuration:', e);
  }
  return updatedCount;
}

// ----------------- START SERVER & VITE -----------------
async function startServer() {
  // Make sure every table exists (chat, feedback, ...) before serving traffic
  try {
    await ensureTables();
  } catch (err) {
    console.warn('[Schema] ensureTables failed:', err);
  }
  // Admin account: optionally (re)set from ADMIN_PASSWORD, and warn about the default password
  try {
    const adminName = (process.env.ADMIN_USERNAME || 'admin').trim();
    const adminPw = process.env.ADMIN_PASSWORD;
    if (adminPw && adminPw.length >= 8) {
      const hash = await hashPasswordSecure(adminPw);
      const existingAdmin = await getUserByUsername(adminName);
      if (existingAdmin) {
        await updateUserDb(existingAdmin.uid, {
          passwordHash: hash,
          role: 'admin',
          isApproved: true,
          isSuspended: false,
          temporaryPasswordAssigned: false,
        });
      } else {
        await createUserDb({
          uid: `user-admin-${Date.now()}`,
          username: adminName,
          passwordHash: hash,
          role: 'admin',
          isApproved: true,
          note: 'Created from ADMIN_PASSWORD',
        });
      }
      console.log(`[Security] Password for admin account "${adminName}" was set from ADMIN_PASSWORD.`);
    }
    const defaultAdmin = await getUserByUsername('admin');
    if (defaultAdmin && (await verifyPassword('admin123', defaultAdmin.passwordHash)).ok) {
      console.warn('[Security] WARNING: the "admin" account still uses the default password. Change it now.');
    }
  } catch (err) {
    console.warn('[Security] Admin account check skipped:', err);
  }
  // Ensure schema extensions exist
  await initDatabaseSchemaExtensions();
  // Ensure database has default seed data
  await seedDatabaseIfEmpty();

  // Purge any legacy automated welcome broadcast completely
  await purgeWelcomePopupsDb();
  await cleanupExpiredPopupsDb();

  // Auto-delete approved and declined song requests (12-hour rule)
  await cleanupExpiredSongRequestsDb();

  // Fix all previous uploaded songs that have incorrect or default durations
  await fixAllPreviousSongsDuration(AUDIO_DIR);

  // Active automated background cleanup: auto-deletes expired broadcasts every 4 seconds
  setInterval(async () => {
    try {
      await cleanupExpiredPopupsDb();
    } catch {}
  }, 4000);

  // Automated background cleanup: auto-deletes approved/declined song requests older than 12h every 10 minutes
  setInterval(async () => {
    try {
      const removed = await cleanupExpiredSongRequestsDb();
      if (removed > 0) {
        console.log(`Auto-cleaned ${removed} expired song requests (12h rule)`);
      }
    } catch (err) {
      console.error('Request cleanup interval error:', err);
    }
  }, 10 * 60 * 1000);

  // Render sets RENDER=true; treat it as production even if NODE_ENV isn't set,
  // otherwise the server falls into Vite dev mode and the page can render blank.
  const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    const indexHtml = path.join(distPath, 'index.html');

    if (!fs.existsSync(indexHtml)) {
      console.error(
        `[static] ${indexHtml} not found. Did the Render build command run "npm run build"?`
      );
    }

    // Serve the built frontend (hashed JS/CSS live in dist/assets)
    app.use(express.static(distPath, { index: false }));

    // Unknown API routes should 404 as JSON, not return the HTML shell
    app.use('/api', (_req, res) => {
      res.status(404).json({ success: false, error: 'API route not found' });
    });

    // SPA fallback: only for page navigations, never for files with an extension.
    // A missing /assets/xyz.js must 404, not return index.html (which causes a blank screen).
    app.get('*', (req, res, next) => {
      if (path.extname(req.path)) return next();
      if (!fs.existsSync(indexHtml)) {
        return res.status(500).send('Frontend build missing: run "npm run build" before starting the server.');
      }
      res.sendFile(indexHtml);
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`YouSong Server running on port ${PORT} connected to Cloud SQL PostgreSQL`);
  });
}

startServer();
