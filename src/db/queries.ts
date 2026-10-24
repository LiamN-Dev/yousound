import { eq, desc, and, or, asc, inArray, isNotNull, lte, ilike, sql } from 'drizzle-orm';
import { db, checkSqlAvailability } from './index.ts';
import { localStore } from './localStore.ts';
import {
  users,
  songs,
  playlists,
  favorites,
  songRequests,
  popups,
  systemSettings,
  mediaFiles,
  chatRequests,
  chatThreads,
  chatMessages,
  chatPairingBlocks,
} from './schema.ts';

// ----------------- USERS -----------------
export async function getUsersDb() {
  if (!(await checkSqlAvailability())) {
    return localStore.getUsers();
  }
  try {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  } catch (error) {
    return localStore.getUsers();
  }
}

export async function getUserByUid(uid: string) {
  if (!(await checkSqlAvailability())) {
    return localStore.getUserByUid(uid);
  }
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] || localStore.getUserByUid(uid);
  } catch (error) {
    return localStore.getUserByUid(uid);
  }
}

export async function getUserByUsername(username: string) {
  if (!(await checkSqlAvailability())) {
    return localStore.getUserByUsername(username);
  }
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, username.trim()))
      .limit(1);
    return rows[0] || localStore.getUserByUsername(username);
  } catch (error) {
    return localStore.getUserByUsername(username);
  }
}

export async function createUserDb(data: {
  uid: string;
  username: string;
  email?: string;
  passwordHash?: string;
  role?: string;
  isApproved?: boolean;
  note?: string;
  temporaryPasswordAssigned?: boolean;
}) {
  if (!(await checkSqlAvailability())) {
    return localStore.createUser(data);
  }
  try {
    const inserted = await db
      .insert(users)
      .values({
        uid: data.uid,
        username: data.username.trim(),
        email: data.email || null,
        passwordHash: data.passwordHash || null,
        role: data.role || 'user',
        isApproved: data.isApproved ?? false,
        note: data.note || null,
        temporaryPasswordAssigned: data.temporaryPasswordAssigned ?? false,
      })
      .returning();
    localStore.createUser(data);
    return inserted[0];
  } catch (error) {
    return localStore.createUser(data);
  }
}

export async function updateUserDb(
  userId: string | number,
  updates: {
    username?: string;
    email?: string;
    passwordHash?: string;
    role?: string;
    isApproved?: boolean;
    note?: string;
    temporaryPasswordAssigned?: boolean;
    isSuspended?: boolean;
    suspendedReason?: string;
    adminNote?: string;
    chatBlocked?: boolean;
    colorAccent?: string;
  }
) {
  if (!(await checkSqlAvailability())) {
    return localStore.updateUser(userId, updates);
  }
  try {
    const whereClause =
      typeof userId === 'number'
        ? eq(users.id, userId)
        : isNaN(Number(userId))
        ? eq(users.uid, userId)
        : or(eq(users.id, Number(userId)), eq(users.uid, userId));

    const updated = await db
      .update(users)
      .set(updates)
      .where(whereClause!)
      .returning();
    localStore.updateUser(userId, updates);
    return updated[0] || localStore.updateUser(userId, updates);
  } catch (error) {
    return localStore.updateUser(userId, updates);
  }
}

export async function recordUserLoginDb(uid: string) {
  localStore.recordUserLogin(uid);
  if (!(await checkSqlAvailability())) return;
  try {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.uid, uid));
  } catch (_) {}
}

export async function recordUserSongListenedDb(uid: string, songSummary: string) {
  localStore.recordUserSongListened(uid, songSummary);
  if (!(await checkSqlAvailability())) return;
  try {
    await db
      .update(users)
      .set({
        lastSongListened: songSummary,
        lastSongListenedAt: new Date(),
      })
      .where(eq(users.uid, uid));
  } catch (_) {}
}

export async function deleteUserDb(uid: string) {
  localStore.deleteUser(uid);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(users).where(eq(users.uid, uid));
    return true;
  } catch (_) {
    return true;
  }
}

// ----------------- SONGS -----------------
export async function getSongsDb() {
  if (!(await checkSqlAvailability())) {
    return localStore.getSongs();
  }
  try {
    const list = await db.select().from(songs).orderBy(desc(songs.addedAt));
    if (list.length === 0) {
      return localStore.getSongs();
    }
    return list;
  } catch (error) {
    return localStore.getSongs();
  }
}

export async function insertSongDb(songData: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre: string;
  tags?: string[];
  typeMood?: string;
  duration: number;
  audioUrl: string;
  coverUrl: string;
  addedAt: string;
  plays?: number;
  featured?: boolean;
  description?: string;
  isLimitedEdition?: boolean;
  limitedUntil?: string;
  autoRemoveOnExpire?: boolean;
  badgeType?: string;
  badgeMessage?: string;
  isPinned?: boolean;
  isDroppingSoon?: boolean;
  dropDate?: string;
  autoReleaseOnDrop?: boolean;
  hiddenFrom?: string[];
  isSpotlight?: boolean;
  spotlightOrder?: number;
  spotlightNote?: string;
  dailyPlays?: number;
  dailyPlaysResetDate?: string;
  weeklyPlays?: number;
  weeklyPlaysResetDate?: string;
  isScheduledForDeletion?: boolean;
  scheduledDeletionAt?: string;
}) {
  localStore.insertSong(songData);
  if (!(await checkSqlAvailability())) {
    return songData;
  }
  try {
    const inserted = await db
      .insert(songs)
      .values({
        id: songData.id,
        title: songData.title.trim(),
        artist: songData.artist.trim(),
        album: songData.album || null,
        genre: songData.genre.trim(),
        tags: songData.tags || [],
        typeMood: songData.typeMood || null,
        duration: songData.duration,
        audioUrl: songData.audioUrl.trim(),
        coverUrl: songData.coverUrl.trim(),
        addedAt: songData.addedAt,
        plays: songData.plays ?? 0,
        featured: songData.featured ?? false,
        description: songData.description || null,
        isLimitedEdition: songData.isLimitedEdition ?? false,
        limitedUntil: songData.limitedUntil || null,
        autoRemoveOnExpire: songData.autoRemoveOnExpire ?? false,
        badgeType: songData.badgeType || null,
        badgeMessage: songData.badgeMessage || null,
        isPinned: songData.isPinned ?? false,
        isDroppingSoon: songData.isDroppingSoon ?? false,
        dropDate: songData.dropDate || null,
        autoReleaseOnDrop: songData.autoReleaseOnDrop ?? false,
        hiddenFrom: songData.hiddenFrom || [],
        isSpotlight: songData.isSpotlight ?? false,
        spotlightOrder: songData.spotlightOrder ?? 0,
        spotlightNote: songData.spotlightNote || null,
        dailyPlays: songData.dailyPlays ?? 0,
        dailyPlaysResetDate: songData.dailyPlaysResetDate || null,
        weeklyPlays: songData.weeklyPlays ?? 0,
        weeklyPlaysResetDate: songData.weeklyPlaysResetDate || null,
        isScheduledForDeletion: songData.isScheduledForDeletion ?? false,
        scheduledDeletionAt: songData.scheduledDeletionAt || null,
      })
      .returning();
    return inserted[0] || songData;
  } catch (error) {
    return songData;
  }
}

export async function updateSongDb(id: string, updates: any) {
  localStore.updateSong(id, updates);
  if (!(await checkSqlAvailability())) {
    return localStore.updateSong(id, updates);
  }
  try {
    const updated = await db
      .update(songs)
      .set(updates)
      .where(eq(songs.id, id))
      .returning();
    return updated[0] || localStore.updateSong(id, updates);
  } catch (error) {
    return localStore.updateSong(id, updates);
  }
}

export async function bulkUpdateSongsDb(
  songIds: string[],
  updates: {
    genre?: string;
    typeMood?: string;
    tagsToAdd?: string[];
    tagsToRemove?: string[];
  },
  _tagOperation?: string
) {
  localStore.bulkUpdateSongs(songIds, updates);
  if (!(await checkSqlAvailability())) {
    return localStore.bulkUpdateSongs(songIds, updates);
  }
  try {
    const list = await db.select().from(songs).where(inArray(songs.id, songIds));
    const results = [];
    for (const song of list) {
      const updatePayload: any = {};
      if (updates.genre !== undefined && updates.genre.trim()) {
        updatePayload.genre = updates.genre.trim();
      }
      if (updates.typeMood !== undefined && updates.typeMood.trim()) {
        updatePayload.typeMood = updates.typeMood.trim();
      }
      let currentTags = Array.isArray(song.tags) ? [...song.tags] : [];
      if (updates.tagsToAdd && updates.tagsToAdd.length > 0) {
        for (const t of updates.tagsToAdd) {
          const clean = t.trim().toLowerCase();
          if (clean && !currentTags.includes(clean)) currentTags.push(clean);
        }
      }
      if (updates.tagsToRemove && updates.tagsToRemove.length > 0) {
        const removeSet = new Set(updates.tagsToRemove.map((t) => t.trim().toLowerCase()));
        currentTags = currentTags.filter((t) => !removeSet.has(t.toLowerCase()));
      }
      updatePayload.tags = currentTags;
      const res = await db.update(songs).set(updatePayload).where(eq(songs.id, song.id)).returning();
      if (res[0]) results.push(res[0]);
    }
    return results;
  } catch (error) {
    return localStore.bulkUpdateSongs(songIds, updates);
  }
}

export async function deleteSongDb(id: string) {
  localStore.deleteSong(id);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(songs).where(eq(songs.id, id));
    return true;
  } catch (error) {
    return true;
  }
}

export async function bulkDeleteSongsDb(songIds: string[]) {
  localStore.bulkDeleteSongs(songIds);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(songs).where(inArray(songs.id, songIds));
    return true;
  } catch (error) {
    return true;
  }
}

export async function incrementSongPlayDb(id: string, isAdmin: boolean = false) {
  const localRes = localStore.incrementSongPlay(id, isAdmin);
  if (!(await checkSqlAvailability())) {
    return localRes;
  }
  try {
    if (isAdmin) {
      const rows = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
      return rows[0] || localRes;
    }
    const updated = await db
      .update(songs)
      .set({
        plays: sql`${songs.plays} + 1`,
        dailyPlays: sql`${songs.dailyPlays} + 1`,
        weeklyPlays: sql`${songs.weeklyPlays} + 1`,
        lastPlayedAt: new Date().toISOString(),
      })
      .where(eq(songs.id, id))
      .returning();
    return updated[0] || localRes;
  } catch (error) {
    return localRes;
  }
}

export async function resetSongPlaysDb(id: string) {
  localStore.resetSongPlays(id);
  if (!(await checkSqlAvailability())) return localStore.resetSongPlays(id);
  try {
    const updated = await db
      .update(songs)
      .set({
        plays: 0,
        dailyPlays: 0,
        weeklyPlays: 0,
      })
      .where(eq(songs.id, id))
      .returning();
    return updated[0] || localStore.resetSongPlays(id);
  } catch (error) {
    return localStore.resetSongPlays(id);
  }
}

export async function bulkResetSongPlaysDb(ids?: string[]) {
  localStore.bulkResetSongPlays(ids);
  if (!(await checkSqlAvailability())) return true;
  try {
    if (ids && ids.length > 0) {
      await db
        .update(songs)
        .set({ plays: 0, dailyPlays: 0, weeklyPlays: 0 })
        .where(inArray(songs.id, ids));
    } else {
      await db.update(songs).set({ plays: 0, dailyPlays: 0, weeklyPlays: 0 });
    }
    return true;
  } catch (error) {
    return true;
  }
}

export async function initDatabaseSchemaExtensions() {
  return true;
}

// ----------------- PLAYLISTS -----------------
export async function getPlaylistsDb(userId?: string) {
  if (!(await checkSqlAvailability())) {
    return localStore.getPlaylists(userId);
  }
  try {
    if (userId) {
      return await db.select().from(playlists).where(eq(playlists.userId, userId));
    }
    return await db.select().from(playlists);
  } catch (error) {
    return localStore.getPlaylists(userId);
  }
}

export async function createPlaylistDb(data: {
  id: string;
  userId: string;
  name: string;
  description?: string;
  coverUrl?: string;
  songIds?: string[];
  createdAt: string;
}) {
  localStore.createPlaylist(data);
  if (!(await checkSqlAvailability())) {
    return data;
  }
  try {
    const inserted = await db
      .insert(playlists)
      .values({
        id: data.id,
        userId: data.userId,
        name: data.name,
        description: data.description || null,
        coverUrl: data.coverUrl || null,
        songIds: data.songIds || [],
        createdAt: data.createdAt,
      })
      .returning();
    return inserted[0] || data;
  } catch (error) {
    return data;
  }
}

export async function updatePlaylistDb(id: string, updates: any) {
  localStore.updatePlaylist(id, updates);
  if (!(await checkSqlAvailability())) {
    return localStore.updatePlaylist(id, updates);
  }
  try {
    const updated = await db
      .update(playlists)
      .set(updates)
      .where(eq(playlists.id, id))
      .returning();
    return updated[0] || localStore.updatePlaylist(id, updates);
  } catch (error) {
    return localStore.updatePlaylist(id, updates);
  }
}

export async function deletePlaylistDb(id: string) {
  localStore.deletePlaylist(id);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(playlists).where(eq(playlists.id, id));
    return true;
  } catch (error) {
    return true;
  }
}

// ----------------- FAVORITES -----------------
export async function getFavoritesDb(userId: string): Promise<string[]> {
  if (!(await checkSqlAvailability())) {
    return localStore.getFavorites(userId);
  }
  try {
    const rows = await db.select().from(favorites).where(eq(favorites.userId, userId));
    return rows.map((r) => r.songId);
  } catch (error) {
    return localStore.getFavorites(userId);
  }
}

export async function toggleFavoriteDb(userId: string, songId: string): Promise<boolean> {
  const localResult = localStore.toggleFavorite(userId, songId);
  if (!(await checkSqlAvailability())) {
    return localResult;
  }
  try {
    const existing = await db
      .select()
      .from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.songId, songId)))
      .limit(1);

    if (existing.length > 0) {
      await db.delete(favorites).where(eq(favorites.id, existing[0].id));
      return false;
    } else {
      await db.insert(favorites).values({ userId, songId });
      return true;
    }
  } catch (error) {
    return localResult;
  }
}

// ----------------- SONG REQUESTS & PIPELINE -----------------
export async function cleanupExpiredSongRequestsDb(): Promise<number> {
  return localStore.cleanupExpiredSongRequests();
}

export async function getRequestsDb() {
  if (!(await checkSqlAvailability())) {
    return localStore.getRequests();
  }
  try {
    await cleanupExpiredSongRequestsDb();
    return await db.select().from(songRequests).orderBy(desc(songRequests.createdAt));
  } catch (error) {
    return localStore.getRequests();
  }
}

export async function getRequestByIdDb(id: string) {
  if (!(await checkSqlAvailability())) {
    return localStore.getRequestById(id);
  }
  try {
    const rows = await db.select().from(songRequests).where(eq(songRequests.id, id)).limit(1);
    return rows[0] || localStore.getRequestById(id);
  } catch (error) {
    return localStore.getRequestById(id);
  }
}

export async function createRequestDb(data: {
  id: string;
  songTitle: string;
  artist?: string;
  webLink?: string;
  coverUrl?: string;
  notes?: string;
  requestedByUserId?: string;
  requestedByUsername: string;
  createdAt: string;
  status?: string;
  adminNote?: string;
  requestType?: 'song' | 'feature';
  genre?: string;
}) {
  localStore.createRequest(data);
  if (!(await checkSqlAvailability())) {
    return localStore.getRequestById(data.id);
  }
  try {
    const inserted = await db
      .insert(songRequests)
      .values({
        id: data.id,
        songTitle: data.songTitle,
        artist: data.artist || null,
        webLink: data.webLink || null,
        coverUrl: data.coverUrl || null,
        notes: data.notes || null,
        requestedByUserId: data.requestedByUserId || null,
        requestedByUsername: data.requestedByUsername,
        createdAt: data.createdAt,
        status: data.status || 'pending',
        adminNote: data.adminNote || null,
        requestType: data.requestType || 'song',
        genre: data.genre || 'Vibe / Chill',
      })
      .returning();
    return inserted[0] || localStore.getRequestById(data.id);
  } catch (error) {
    return localStore.getRequestById(data.id);
  }
}

export async function updateRequestFullDb(
  id: string,
  updates: {
    songTitle?: string | null;
    artist?: string | null;
    webLink?: string | null;
    coverUrl?: string | null;
    notes?: string | null;
    status?: string | null;
    adminNote?: string | null;
    reviewedAt?: string | null;
    audioUrl?: string | null;
    driveFileId?: string | null;
    driveFolderId?: string | null;
    duration?: number | null;
    genre?: string | null;
    stagingAudioUrl?: string | null;
    publishedSongId?: string | null;
    publishedAt?: string | null;
    processingProgress?: string | null;
    processingError?: string | null;
  }
) {
  localStore.updateRequestFull(id, updates);
  if (!(await checkSqlAvailability())) {
    return localStore.getRequestById(id);
  }
  try {
    const cleanUpdates: any = { ...updates };
    const updated = await db
      .update(songRequests)
      .set(cleanUpdates)
      .where(eq(songRequests.id, id))
      .returning();
    return updated[0] || localStore.getRequestById(id);
  } catch (error) {
    return localStore.getRequestById(id);
  }
}

export async function updateRequestDb(id: string, status: string, adminNote?: string) {
  localStore.updateRequest(id, status, adminNote);
  if (!(await checkSqlAvailability())) {
    return localStore.getRequestById(id);
  }
  try {
    const updates: any = { status };
    if (adminNote !== undefined) updates.adminNote = adminNote;
    if (['approved', 'declined', 'staging', 'published'].includes(status)) {
      updates.reviewedAt = new Date().toISOString();
    }
    const updated = await db
      .update(songRequests)
      .set(updates)
      .where(eq(songRequests.id, id))
      .returning();
    return updated[0] || localStore.getRequestById(id);
  } catch (error) {
    return localStore.getRequestById(id);
  }
}

export async function deleteRequestDb(id: string) {
  localStore.deleteRequest(id);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(songRequests).where(eq(songRequests.id, id));
    return true;
  } catch (error) {
    return true;
  }
}

// ----------------- POPUPS -----------------
export async function getPopupsDb() {
  if (!(await checkSqlAvailability())) {
    return localStore.getPopups();
  }
  try {
    const list = await db.select().from(popups).orderBy(desc(popups.createdAt));
    return list;
  } catch (error) {
    return localStore.getPopups();
  }
}

export async function cleanupExpiredPopupsDb(): Promise<number> {
  return localStore.cleanupExpiredPopups();
}

export async function purgeWelcomePopupsDb(): Promise<void> {
  localStore.purgeWelcomePopups();
  if (!(await checkSqlAvailability())) return;
  try {
    const list = await db.select().from(popups);
    const toDelete: string[] = [];
    for (const p of list) {
      const titleLower = (p.title || '').toLowerCase();
      const msgLower = (p.message || '').toLowerCase();
      if (
        titleLower.includes('welcome') ||
        titleLower.includes('getting started') ||
        msgLower.includes('welcome to yousong') ||
        msgLower.includes('explore school-friendly')
      ) {
        toDelete.push(p.id);
      }
    }
    if (toDelete.length > 0) {
      await db.delete(popups).where(inArray(popups.id, toDelete));
    }
  } catch (_) {}
}

export async function createPopupDb(data: {
  id: string;
  targetUserId: string;
  title: string;
  message: string;
  type: string;
  createdAt: string;
  active?: boolean;
  expiresAt?: Date | null;
  isDismissible?: boolean;
}) {
  localStore.createPopup(data);
  if (!(await checkSqlAvailability())) return localStore.createPopup(data);
  try {
    const inserted = await db
      .insert(popups)
      .values({
        id: data.id,
        targetUserId: data.targetUserId,
        title: data.title,
        message: data.message,
        type: data.type,
        createdAt: data.createdAt,
        active: data.active ?? true,
        expiresAt: data.expiresAt || null,
        isDismissible: data.isDismissible ?? true,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    return localStore.createPopup(data);
  }
}

export async function updatePopupDb(id: string, active: boolean) {
  localStore.updatePopup(id, active);
  if (!(await checkSqlAvailability())) return localStore.updatePopup(id, active);
  try {
    const updated = await db
      .update(popups)
      .set({ active })
      .where(eq(popups.id, id))
      .returning();
    return updated[0];
  } catch (error) {
    return localStore.updatePopup(id, active);
  }
}

export async function deletePopupDb(id: string) {
  localStore.deletePopup(id);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(popups).where(eq(popups.id, id));
    return true;
  } catch (error) {
    return true;
  }
}

// ----------------- SYSTEM SETTINGS -----------------
export async function getSettingDb<T = any>(key: string): Promise<T | null> {
  if (!(await checkSqlAvailability())) {
    return localStore.getSetting(key) as T;
  }
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    if (!rows[0]) return localStore.getSetting(key) as T;
    return JSON.parse(rows[0].value) as T;
  } catch (error) {
    return localStore.getSetting(key) as T;
  }
}

export async function setSettingDb(key: string, value: any) {
  localStore.setSetting(key, value);
  if (!(await checkSqlAvailability())) return value;
  try {
    const stringified = typeof value === 'string' ? value : JSON.stringify(value);
    await db
      .insert(systemSettings)
      .values({ key, value: stringified, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: stringified, updatedAt: new Date() },
      });
    return value;
  } catch (error) {
    return value;
  }
}

// ----------------- MEDIA FILES -----------------
export async function saveMediaFileDb(
  id: string,
  data: string,
  mimeType: string = 'audio/mpeg',
  size: number = 0
) {
  localStore.saveMediaFile(id, data, mimeType, size);
  if (!(await checkSqlAvailability())) return;
  try {
    await db
      .insert(mediaFiles)
      .values({ id, data, mimeType, size, createdAt: new Date() })
      .onConflictDoUpdate({
        target: mediaFiles.id,
        set: { data, mimeType, size, createdAt: new Date() },
      });
  } catch (_) {}
}

export async function getMediaFileDb(id: string) {
  if (!(await checkSqlAvailability())) {
    return localStore.getMediaFile(id);
  }
  try {
    const rows = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1);
    return rows[0] || localStore.getMediaFile(id);
  } catch (_) {
    return localStore.getMediaFile(id);
  }
}

// ----------------- CHAT SYSTEM QUERIES -----------------
export async function getChatRequestsDb() {
  if (!(await checkSqlAvailability())) return localStore.getChatRequests();
  try {
    return await db.select().from(chatRequests).orderBy(desc(chatRequests.createdAt));
  } catch {
    return localStore.getChatRequests();
  }
}

export async function getChatRequestsForUserDb(userId: string) {
  if (!(await checkSqlAvailability())) return localStore.getChatRequestsForUser(userId);
  try {
    return await db
      .select()
      .from(chatRequests)
      .where(or(eq(chatRequests.senderId, userId), eq(chatRequests.receiverId, userId)))
      .orderBy(desc(chatRequests.createdAt));
  } catch {
    return localStore.getChatRequestsForUser(userId);
  }
}

export async function createChatRequestDb(data: {
  id: string;
  senderId: string;
  senderUsername: string;
  receiverId: string;
  receiverUsername: string;
  reason?: string;
}) {
  localStore.createChatRequest(data);
  if (!(await checkSqlAvailability())) return localStore.createChatRequest(data);
  try {
    const inserted = await db
      .insert(chatRequests)
      .values({
        id: data.id,
        senderId: data.senderId,
        senderUsername: data.senderUsername,
        receiverId: data.receiverId,
        receiverUsername: data.receiverUsername,
        reason: data.reason || null,
        status: 'pending',
      })
      .returning();
    return inserted[0];
  } catch {
    return localStore.createChatRequest(data);
  }
}

export async function updateChatRequestStatusDb(
  id: string,
  status: 'pending' | 'approved' | 'declined',
  adminNote?: string
) {
  localStore.updateChatRequestStatus(id, status, adminNote);
  if (!(await checkSqlAvailability())) return localStore.updateChatRequestStatus(id, status, adminNote);
  try {
    const updated = await db
      .update(chatRequests)
      .set({
        status,
        adminNote: adminNote || null,
        reviewedAt: new Date(),
      })
      .where(eq(chatRequests.id, id))
      .returning();
    return updated[0];
  } catch {
    return localStore.updateChatRequestStatus(id, status, adminNote);
  }
}

export async function deleteChatRequestDb(id: string) {
  localStore.deleteChatRequest(id);
  if (!(await checkSqlAvailability())) return true;
  try {
    await db.delete(chatRequests).where(eq(chatRequests.id, id));
    return true;
  } catch {
    return true;
  }
}

export async function getChatThreadsDb() {
  if (!(await checkSqlAvailability())) return localStore.getChatThreads();
  try {
    return await db.select().from(chatThreads).orderBy(desc(chatThreads.lastMessageAt));
  } catch {
    return localStore.getChatThreads();
  }
}

export async function getChatThreadsForUserDb(userId: string) {
  if (!(await checkSqlAvailability())) return localStore.getChatThreadsForUser(userId);
  try {
    const all = await db
      .select()
      .from(chatThreads)
      .where(or(eq(chatThreads.user1Id, userId), eq(chatThreads.user2Id, userId)))
      .orderBy(desc(chatThreads.lastMessageAt));
    return all.filter((t) => !(t.hiddenByUserIds || []).includes(userId));
  } catch {
    return localStore.getChatThreadsForUser(userId);
  }
}

export async function hideChatThreadForUserDb(threadId: string, userId: string) {
  localStore.hideChatThreadForUser(threadId, userId);
  if (!(await checkSqlAvailability())) return true;
  try {
    const thread = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1);
    if (!thread[0]) return false;
    const currentHidden = Array.isArray(thread[0].hiddenByUserIds) ? [...thread[0].hiddenByUserIds] : [];
    if (!currentHidden.includes(userId)) {
      currentHidden.push(userId);
      await db
        .update(chatThreads)
        .set({ hiddenByUserIds: currentHidden })
        .where(eq(chatThreads.id, threadId));
    }
    return true;
  } catch {
    return true;
  }
}

export async function createOrGetAppealThreadDb(userId: string, username: string) {
  return localStore.createOrForceChatThread(userId, username, 'admin', 'Administrator', true);
}

export async function getChatThreadByIdDb(threadId: string) {
  if (!(await checkSqlAvailability())) return localStore.getChatThreadById(threadId);
  try {
    const rows = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1);
    return rows[0] || localStore.getChatThreadById(threadId);
  } catch {
    return localStore.getChatThreadById(threadId);
  }
}

export async function createOrForceChatThreadDb(
  user1Id: string,
  user1Username: string,
  user2Id: string,
  user2Username: string,
  isAppeal: boolean = false
) {
  return localStore.createOrForceChatThread(user1Id, user1Username, user2Id, user2Username, isAppeal);
}

export async function setChatThreadTerminatedDb(
  threadId: string,
  isTerminated: boolean,
  reason?: string
) {
  return localStore.setChatThreadTerminated(threadId, isTerminated, reason);
}

export async function deleteChatThreadDb(threadId: string) {
  return localStore.deleteChatThread(threadId);
}

export async function deleteChatMessageDb(messageId: string) {
  return localStore.deleteChatMessage(messageId);
}

export async function getChatMessagesDb(threadId: string) {
  return localStore.getChatMessages(threadId);
}

export async function getAllChatMessagesDb(limitCount: number = 200) {
  return localStore.getAllChatMessages(limitCount);
}

export async function createChatMessageDb(data: {
  id: string;
  threadId: string;
  senderId: string;
  senderUsername: string;
  receiverId: string;
  content: string;
}) {
  return localStore.createChatMessage(data);
}

export async function getChatPairingBlocksDb() {
  return localStore.getChatPairingBlocks();
}

export async function createChatPairingBlockDb(
  user1Id: string,
  user2Id: string,
  blockedBy: string,
  reason?: string
) {
  return localStore.createChatPairingBlock(user1Id, user2Id, blockedBy, reason);
}

export async function deleteChatPairingBlockDb(id: number) {
  return localStore.deleteChatPairingBlock(id);
}

export async function isChatPairingBlockedDb(user1Id: string, user2Id: string) {
  return localStore.isChatPairingBlocked(user1Id, user2Id);
}
