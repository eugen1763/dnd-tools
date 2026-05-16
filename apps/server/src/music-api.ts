import { Elysia, t } from 'elysia';
import {
  getAllTracks,
  getAllCategories,
  getTracksByCategory,
  getTrack,
  addTrack,
  addTracks,
  removeTrack,
  renameCategory,
  deleteCategory,
  moveTrack,
  Track,
} from './music-store';
import {
  getSessionByToken,
  joinAndStartSession,
  leaveSession,
  playTrackById,
  playNext,
  playPrevious,
  togglePlayPause,
  setVolume,
  setLoop,
  setShuffle,
  setQueue,
  addToQueue,
  clearQueue,
  removeFromQueue,
  PlayerState,
  validateControlToken,
  getSession,
} from './music-player';
import { downloadVideo, downloadPlaylist, DownloadResult, parseYouTubeUrl } from './youtube';
import { join } from 'path';

const MUSIC_DIR = join(import.meta.dir, '../music/tracks');

function trackToResponse(t: Track)  {
  return {
    id: t.id,
    title: t.title,
    url: t.url,
    duration: t.duration,
    category: t.category,
    addedAt: t.addedAt,
  };
}

function sessionToResponse(s: PlayerState) {
  return {
    guildId: s.guildId,
    voiceChannelId: s.voiceChannelId,
    adminUserId: s.adminUserId,
    queue: s.queue,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    volume: s.volume,
    loop: s.loop,
    shuffle: s.shuffle,
  };
}

export const musicApi = new Elysia({ prefix: '/api/music' })
  // === Session Control ===

  // Get state (by token in header)
  .get('/state', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'Invalid or expired control token' };
    return { ok: true, state: sessionToResponse(session) };
  })

  // === Library ===

  // Get all tracks
  .get('/tracks', () => {
    return { ok: true, tracks: getAllTracks().map(trackToResponse) };
  })

  // Get all categories
  .get('/categories', () => {
    const categories = getAllCategories().map(c => ({
      id: c.id,
      name: c.name,
      trackCount: c.trackIds.length,
    }));
    return { ok: true, categories };
  })

  // Get tracks by category
  .get('/categories/:id/tracks', ({ params: { id } }) => {
    const tracks = getTracksByCategory(id);
    if (tracks.length === 0) {
      const cat = getAllCategories().find(c => c.id === id);
      if (!cat) return { error: 'Category not found' };
    }
    return { ok: true, tracks: tracks.map(trackToResponse) };
  })

  // Get single track
  .get('/tracks/:id', ({ params: { id } }) => {
    const track = getTrack(id);
    if (!track) return { error: 'Track not found' };
    return { ok: true, track: trackToResponse(track) };
  })

  // === Download & Add ===

  // Download a YouTube URL (video or playlist)
  .post('/download', async ({ body, headers }) => {
    const { url, category } = body as { url: string; category?: string };
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    if (!url) return { error: 'Missing url' };

    try {
      const parsed = parseYouTubeUrl(url);

      if (parsed.type === 'playlist') {
        const result = await downloadPlaylist(url, (idx, total, title) => {
          console.log(`[Download] [${idx}/${total}] ${title}`);
        });

        const tracks = addTracks(
          result.tracks.map(t => ({
            id: t.id,
            title: t.title,
            url: t.url,
            duration: t.duration,
            filename: t.filename,
          })),
          category || result.playlistTitle || 'Playlists'
        );

        return {
          ok: true,
          type: 'playlist',
          playlistTitle: result.playlistTitle,
          tracks: tracks.map(trackToResponse),
        };
      } else {
        // Single video
        const result = await downloadVideo(url, (line) => {
          // Progress logging
          if (line.includes('%')) {
            const match = line.match(/(\d+\.?\d*)%/);
            if (match) console.log(`[Download] ${match[1]}%`);
          }
        });

        const track = addTrack({
          id: result.id,
          title: result.title,
          url: result.url,
          duration: result.duration,
          filename: result.filename,
          category: category || 'uncategorized',
        });

        return { ok: true, type: 'track', track: trackToResponse(track) };
      }
    } catch (err) {
      return { error: `Download failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  })

  // === Queue Management ===

  // Set entire queue
  .post('/queue', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { trackIds } = body as { trackIds: string[] };
    if (!Array.isArray(trackIds)) return { error: 'trackIds must be an array' };

    setQueue(session.guildId, trackIds);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Add to queue
  .post('/queue/add', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { trackId } = body as { trackId: string };
    if (!trackId) return { error: 'Missing trackId' };

    addToQueue(session.guildId, trackId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Remove from queue
  .delete('/queue/:index', ({ params: { index }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const idx = parseInt(index, 10);
    if (isNaN(idx)) return { error: 'Invalid index' };

    removeFromQueue(session.guildId, idx);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Clear queue
  .post('/queue/clear', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    clearQueue(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // === Playback Control ===

  // Play specific track
  .post('/play', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { trackId } = body as { trackId?: string };
    if (trackId) {
      playTrackById(session.guildId, trackId);
    } else if (session.queue.length > 0) {
      // Resume from current position
      togglePlayPause(session.guildId);
    }

    return { ok: true, state: sessionToResponse(session) };
  })

  // Play/pause toggle
  .post('/pause', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    togglePlayPause(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Next track
  .post('/next', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    playNext(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Previous track
  .post('/previous', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    playPrevious(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Set volume
  .post('/volume', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { volume } = body as { volume: number };
    if (typeof volume !== 'number' || volume < 0 || volume > 1) {
      return { error: 'Volume must be between 0 and 1' };
    }

    setVolume(session.guildId, volume);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Toggle loop
  .post('/loop', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    setLoop(session.guildId, !session.loop);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Toggle shuffle
  .post('/shuffle', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    setShuffle(session.guildId, !session.shuffle);
    return { ok: true, state: sessionToResponse(session) };
  })

  // === Track Management ===

  // Delete a track
  .delete('/tracks/:id', ({ params: { id }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const track = getTrack(id);
    if (!track) return { error: 'Track not found' };

    // Remove from filesystem
    const { unlinkSync, existsSync } = require('fs');
    const filePath = join(MUSIC_DIR, track.filename);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (err) {
      console.error('Failed to delete track file:', err);
    }

    removeTrack(id);
    return { ok: true };
  })

  // Move track to category
  .post('/tracks/:id/move', ({ params: { id }, body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { category } = body as { category: string };
    if (!category) return { error: 'Missing category' };

    moveTrack(id, category);
    return { ok: true };
  })

  // Rename category
  .post('/categories/:id/rename', ({ params: { id }, body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { name } = body as { name: string };
    if (!name) return { error: 'Missing name' };

    renameCategory(id, name);
    return { ok: true };
  })

  // Delete category (tracks survive, become uncategorized)
  .delete('/categories/:id', ({ params: { id }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    // Move all tracks in this category to uncategorized
    const tracks = getTracksByCategory(id);
    for (const track of tracks) {
      moveTrack(track.id, 'uncategorized');
    }
    deleteCategory(id);
    return { ok: true };
  });
