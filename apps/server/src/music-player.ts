import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { GuildMember, VoiceChannel } from 'discord.js';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';
import { nanoid } from 'nanoid';
import { getTrack, Track, getAllTracks } from './music-store';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const MUSIC_DIR = join(import.meta.dir, '../music/tracks');

export interface QueueItem {
  trackId: string;
  title: string;
  duration: number;
  requestedBy: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  guildId: string;
  voiceChannelId: string;
  adminUserId: string;
  controlToken: string;
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  // Playback position tracking so the web UI can render a self-correcting
  // progress bar. `positionMs` is the offset at the last anchor; while playing,
  // the live position is positionMs + (Date.now() - startedAtMs).
  positionMs: number;
  startedAtMs: number;
  // Idle clock for the empty-channel sweep: set to Date.now() when the bot is
  // alone in its voice channel, cleared (null) while a human is present. The
  // sweep in discord.ts calls leaveSession once this exceeds the grace window.
  emptySince: number | null;
  // Last user-visible playback error (e.g. ffmpeg unavailable for seek/volume),
  // surfaced in the serialized state and cleared on the next successful play.
  lastError: string | null;
}

/** Current playback position of a session in seconds (0 if nothing playing). */
export function getPositionSeconds(s: PlayerState): number {
  // No valid current track -> no meaningful position.
  if (s.currentIndex < 0 || s.currentIndex >= s.queue.length) return 0;
  const base = s.isPlaying ? s.positionMs + (Date.now() - s.startedAtMs) : s.positionMs;
  const secs = Math.max(0, base) / 1000;
  // Clamp to the current track's duration so the bar never overshoots.
  const dur = s.queue[s.currentIndex]?.duration ?? 0;
  return dur > 0 ? Math.min(secs, dur) : secs;
}

const sessions = new Map<string, PlayerState>();
const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();
const ffmpegProcesses = new Map<string, any>();
const resources = new Map<string, any>();
const controlTokens = new Map<string, string>();

// Playback resilience state (not part of the persisted/serialized session).
const playStartedAt = new Map<string, number>();
const failureState = new Map<string, { count: number; first: number; trackId: string }>();
// Guards the Disconnected→rejoin backoff so overlapping stateChange events for
// the same guild can't run concurrent wait+rejoin cycles (which would inflate
// rejoinAttempts and trip the give-up cap prematurely).
const reconnecting = new Set<string>();
// Guards against two concurrent /music start calls for the same guild both
// passing the initial teardown and attaching duplicate listeners to one shared
// VoiceConnection.
const starting = new Set<string>();
const MAX_FAILURES = 4;
const FAILURE_WINDOW_MS = 10_000;
const FAST_FAIL_MS = 1500;

/** Terminate an ffmpeg child reliably: SIGTERM, then SIGKILL if it lingers. */
function killFfmpeg(proc: any): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try { if (!proc.killed) proc.kill('SIGKILL'); } catch {}
    }, 2000);
  } catch {}
}

/**
 * Record a playback failure for a guild. Returns true once playback has failed
 * MAX_FAILURES times within FAILURE_WINDOW_MS — the signal to stop instead of
 * respawning ffmpeg in a tight loop (which previously leaked to OOM).
 */
function recordFailure(guildId: string, trackId: string): boolean {
  const now = Date.now();
  const fs = failureState.get(guildId);
  // Count consecutive fast failures within the window REGARDLESS of trackId, so a
  // queue of several DISTINCT corrupt tracks (repeat='all'/shuffle) trips the
  // guard too — not only the same track repeating under repeat='one'.
  if (!fs || now - fs.first > FAILURE_WINDOW_MS) {
    failureState.set(guildId, { count: 1, first: now, trackId });
    return false;
  }
  fs.count++;
  fs.trackId = trackId;
  return fs.count >= MAX_FAILURES;
}

function clearFailures(guildId: string): void {
  failureState.delete(guildId);
}

export function generateControlToken(guildId: string): string {
  const token = nanoid(32);
  controlTokens.set(token, guildId);
  return token;
}

export function validateControlToken(token: string): string | null {
  return controlTokens.get(token) ?? null;
}

export function getSession(guildId: string): PlayerState | undefined {
  return sessions.get(guildId);
}

/** All live sessions (used by the empty-channel idle sweep). */
export function getAllSessions(): PlayerState[] {
  return [...sessions.values()];
}

export function getSessionByToken(token: string): PlayerState | undefined {
  const guildId = controlTokens.get(token);
  if (!guildId) return undefined;
  return sessions.get(guildId);
}

export function invalidateToken(token: string): void {
  controlTokens.delete(token);
}

export async function joinAndStartSession(
  member: GuildMember,
  channel: VoiceChannel,
): Promise<{ token: string; state: PlayerState }> {
  const guildId = channel.guild.id;
  // Serialize startup per guild: joinVoiceChannel returns the SAME connection for
  // an in-flight join, so two concurrent starts would attach duplicate listeners
  // and leak a player. Reject the second until the first settles.
  if (starting.has(guildId)) {
    throw new Error('A music session is already starting for this server. Try again in a moment.');
  }
  starting.add(guildId);
  await leaveSession(guildId);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,   // music bot never receives audio; lower bandwidth
    selfMute: false,
  });

  // Attach the 'error' listener BEFORE the join handshake. A networking error
  // (e.g. EHOSTUNREACH from the voice UDP socket during voice-server selection)
  // is emitted as 'error' on the connection; without a listener Node/Bun rethrows
  // it as an uncaught exception and kills the whole process. entersState's own
  // once() guards the await, but attaching here removes any listener-less window.
  connection.on('error', (error: any) => {
    console.error(`Voice connection error in guild ${guildId}:`, error?.message ?? error);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    starting.delete(guildId);
    connection.destroy();
    throw new Error('Failed to join voice channel. Make sure the bot has Connect permission and the channel is accessible.');
  }

  // Pause (the default) when there's no healthy subscriber instead of burning
  // audio into a dead connection — this is what stops the broken-pipe/respawn
  // loop when the voice connection drops.
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  connection.subscribe(player);

  const token = generateControlToken(guildId);
  const state: PlayerState = {
    guildId,
    voiceChannelId: channel.id,
    adminUserId: member.id,
    controlToken: token,
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    volume: 1.0,
    repeatMode: 'off',
    shuffle: false,
    positionMs: 0,
    startedAtMs: 0,
    emptySince: null,
    lastError: null,
  };

  sessions.set(guildId, state);
  connections.set(guildId, connection);
  players.set(guildId, player);

  // Voice-connection lifecycle, adapted from the official @discordjs/voice
  // music-bot example. This is what keeps playback alive across Discord's
  // periodic forced reconnects and tears the session down cleanly when the
  // connection is genuinely gone (instead of respawning into a dead socket).
  let readyLock = false;
  connection.on('stateChange', async (_old, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
        // Either moved channel (recoverable) or kicked (not). Give it a moment
        // to declare itself before deciding.
        try {
          await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
        } catch {
          try { connection.destroy(); } catch {}
        }
      } else if (connection.rejoinAttempts < 5) {
        // Recoverable network blip — back off and rejoin. Serialize per guild:
        // stateChange can fire repeatedly (incl. Disconnected→Disconnected) and
        // async listeners aren't awaited, so without this guard overlapping
        // cycles each call rejoin() and inflate rejoinAttempts toward the cap.
        if (!reconnecting.has(guildId)) {
          reconnecting.add(guildId);
          try {
            await wait((connection.rejoinAttempts + 1) * 5_000);
            try { connection.rejoin(); } catch {}
          } finally {
            reconnecting.delete(guildId);
          }
        }
      } else {
        try { connection.destroy(); } catch {}
      }
    } else if (newState.status === VoiceConnectionStatus.Destroyed) {
      // Connection is gone for good — stop playback and clean up. The connection
      // is already destroyed, so don't re-destroy it.
      disposeSession(guildId, false);
    } else if (
      !readyLock &&
      (newState.status === VoiceConnectionStatus.Connecting || newState.status === VoiceConnectionStatus.Signalling)
    ) {
      // Must reach Ready within 20s, else give up — covers "stuck in Signalling".
      readyLock = true;
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try { connection.destroy(); } catch {}
        }
      } finally {
        readyLock = false;
      }
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    // player.stop(true) (teardown) emits 'idle' SYNCHRONOUSLY. If this session has
    // already been disposed, bail — otherwise we'd re-enter and spawn a fresh
    // resource onto a connection that's being destroyed (fd/ffmpeg/player leak).
    if (sessions.get(guildId) !== state || players.get(guildId) !== player) return;

    // Normal play uses no ffmpeg (Opus passthrough); the seek/volume path does,
    // so reap any lingering ffmpeg here defensively.
    const prev = ffmpegProcesses.get(guildId);
    if (prev) killFfmpeg(prev);
    ffmpegProcesses.delete(guildId);

    // An Idle firing almost immediately after play() usually means the track
    // failed to load (e.g. a corrupt file), not that it finished — guard against
    // a respawn storm by stopping after repeated fast failures. But a genuinely
    // short clip that completes cleanly is NOT a failure, so only treat it as one
    // when elapsed is far below the track's expected duration (unknown duration
    // falls back to the time gate).
    const item = state.queue[state.currentIndex];
    const elapsed = Date.now() - (playStartedAt.get(guildId) ?? 0);
    const expectedMs = (item?.duration ?? 0) * 1000;
    const looksFailed = !!item && elapsed < FAST_FAIL_MS && (expectedMs === 0 || elapsed < expectedMs * 0.5);
    if (looksFailed) {
      if (recordFailure(guildId, item!.trackId)) {
        console.error(`Playback failed ${MAX_FAILURES}x within ${FAILURE_WINDOW_MS}ms in guild ${guildId}; stopping.`);
        state.isPlaying = false;
        clearFailures(guildId);
        return;
      }
    } else {
      clearFailures(guildId);
    }

    if (state.repeatMode === 'one' && state.currentIndex >= 0 && state.currentIndex < state.queue.length) {
      // If the looped track's file vanished, stop rather than strand 'playing'.
      if (!playTrackInSession(guildId, state.queue[state.currentIndex])) state.isPlaying = false;
    } else if (state.queue.length > 0) {
      // Advance, skipping any tracks that fail to load (deleted file / missing
      // metadata) so a hole in the queue can't strand the session as 'playing'
      // with no audio. Bounded by queue length; if nothing is playable, stop.
      let started = false;
      for (let i = 0; i < state.queue.length; i++) {
        if (playNext(guildId)) { started = true; break; }
        if (!state.isPlaying) break; // playNext hit end-of-queue (repeat off)
      }
      if (!started) state.isPlaying = false;
    } else {
      state.isPlaying = false;
    }
  });

  // Log errors only; the Idle transition that follows handles advancing, so we
  // never double-advance.
  player.on('error', (error: any) => {
    console.error(`Audio player error in guild ${guildId}:`, error?.message ?? error);
  });

  // The player AutoPauses when the connection has no healthy subscriber (a
  // transient reconnect). Freeze the progress offset so the UI bar doesn't drift
  // while no audio is actually flowing; it resumes from here when Playing returns.
  player.on(AudioPlayerStatus.AutoPaused, () => {
    if (sessions.get(guildId) !== state) return;
    if (state.isPlaying) {
      state.positionMs += Date.now() - state.startedAtMs;
      state.isPlaying = false;
    }
  });

  // Re-anchor when playback (re)starts — covers auto-resume after an AutoPause so
  // position keeps advancing from where it froze rather than jumping.
  player.on(AudioPlayerStatus.Playing, () => {
    if (sessions.get(guildId) !== state) return;
    if (!state.isPlaying) {
      state.startedAtMs = Date.now();
      state.isPlaying = true;
    }
  });

  starting.delete(guildId);
  return { token, state };
}

/**
 * Single teardown path for a guild's session. Critically, it clears ALL state
 * maps and invalidates the token BEFORE stopping the player — because
 * AudioPlayer.stop(true) emits 'idle' synchronously, and the Idle handler's
 * liveness guard must see a torn-down session so it bails instead of advancing
 * and spawning a fresh resource onto a dying connection. ffmpeg is killed (not
 * just dropped) so the seek/volume child can't be orphaned.
 */
function disposeSession(guildId: string, destroyConnection: boolean): void {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  const connection = connections.get(guildId);
  const ffmpeg = ffmpegProcesses.get(guildId);

  // 1) Remove state first (so the synchronous Idle from stop() is a no-op).
  sessions.delete(guildId);
  players.delete(guildId);
  connections.delete(guildId);
  ffmpegProcesses.delete(guildId);
  resources.delete(guildId);
  playStartedAt.delete(guildId);
  failureState.delete(guildId);
  reconnecting.delete(guildId);
  if (session) invalidateToken(session.controlToken);

  // 2) Now reap the real resources.
  if (ffmpeg) killFfmpeg(ffmpeg);
  if (player) { try { player.stop(true); } catch {} }
  if (connection && destroyConnection) { try { connection.destroy(); } catch {} }
}

export async function leaveSession(guildId: string): Promise<void> {
  disposeSession(guildId, true);
}

/** Tear down every active session (used on graceful shutdown). */
export function disposeAllSessions(): void {
  for (const guildId of [...sessions.keys()]) disposeSession(guildId, true);
}

export function setQueue(guildId: string, trackIds: string[]): void {
  const session = sessions.get(guildId);
  if (!session) return;
  // Preserve the currently-playing track across a reorder so audio keeps going
  // and the now-playing highlight stays correct (the queue is rebuilt here but
  // playback is NOT restarted).
  const playingTrackId = session.currentIndex >= 0 ? session.queue[session.currentIndex]?.trackId : undefined;
  session.queue = trackIds.map(id => {
    const track = getTrack(id);
    return { trackId: id, title: track?.title || 'Unknown Track', duration: track?.duration || 0, requestedBy: session.adminUserId };
  });
  if (playingTrackId) {
    const idx = session.queue.findIndex(q => q.trackId === playingTrackId);
    session.currentIndex = idx >= 0 ? idx : (session.queue.length > 0 ? 0 : -1);
  } else {
    session.currentIndex = session.queue.length > 0 ? 0 : -1;
  }
}

export function addToQueue(guildId: string, trackId: string): void {
  const session = sessions.get(guildId);
  if (!session) return;
  const track = getTrack(trackId);
  session.queue.push({ trackId, title: track?.title || 'Unknown Track', duration: track?.duration || 0, requestedBy: session.adminUserId });
}

export function clearQueue(guildId: string): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.queue = [];
  session.currentIndex = -1;
  session.isPlaying = false;
  session.positionMs = 0;
  session.startedAtMs = Date.now();
  const player = players.get(guildId);
  if (player) player.stop();
}

export function removeFromQueue(guildId: string, index: number): boolean {
  const session = sessions.get(guildId);
  if (!session || index < 0 || index >= session.queue.length) return false;
  const wasCurrent = index === session.currentIndex;
  session.queue.splice(index, 1);

  if (index < session.currentIndex) {
    // Removed something before the playing track — shift the pointer to follow it.
    session.currentIndex--;
  } else if (wasCurrent) {
    // Removed the track that's actually playing. Don't leave audio streaming a
    // track no longer in the queue: advance to whatever now occupies the slot,
    // or stop if the queue is now empty.
    if (session.queue.length === 0) {
      session.currentIndex = -1;
      session.isPlaying = false;
      const player = players.get(guildId);
      if (player) player.stop();
    } else {
      if (session.currentIndex >= session.queue.length) session.currentIndex = session.queue.length - 1;
      if (session.isPlaying) playTrackInSession(guildId, session.queue[session.currentIndex]);
    }
  }
  return true;
}

export function playTrackById(guildId: string, trackId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  const existingIdx = session.queue.findIndex(q => q.trackId === trackId);
  if (existingIdx >= 0) {
    session.currentIndex = existingIdx;
  } else {
    const track = getTrack(trackId);
    if (!track) return false;
    session.queue.push({ trackId, title: track.title, duration: track.duration, requestedBy: session.adminUserId });
    session.currentIndex = session.queue.length - 1;
  }
  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function playNext(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session || session.queue.length === 0) return false;
  if (session.shuffle && session.queue.length > 1) {
    // Pick a different track than the current one so shuffle doesn't replay the
    // same song back-to-back.
    let next = session.currentIndex;
    while (next === session.currentIndex) next = Math.floor(Math.random() * session.queue.length);
    session.currentIndex = next;
  } else if (session.shuffle) {
    // Single-track queue under shuffle: fall through to normal end-of-queue
    // handling so repeat='off' can actually stop instead of looping forever.
    session.currentIndex++;
    if (session.currentIndex >= session.queue.length) {
      if (session.repeatMode === 'all') { session.currentIndex = 0; }
      else { session.isPlaying = false; return false; }
    }
  } else {
    session.currentIndex++;
    if (session.currentIndex >= session.queue.length) {
      if (session.repeatMode === 'all') { session.currentIndex = 0; }
      else { session.isPlaying = false; return false; }
    }
  }
  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function playPrevious(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session || session.queue.length === 0) return false;
  session.currentIndex--;
  if (session.currentIndex < 0) session.currentIndex = session.queue.length - 1;
  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function togglePlayPause(guildId: string): boolean {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  if (!session || !player) return false;
  if (player.state.status === AudioPlayerStatus.Playing) {
    // Freeze the position offset at the moment we pause.
    session.positionMs += Date.now() - session.startedAtMs;
    player.pause();
    session.isPlaying = false;
  } else if (player.state.status === AudioPlayerStatus.Paused) {
    // Re-anchor wall-clock so the position keeps advancing from where it froze.
    session.startedAtMs = Date.now();
    player.unpause();
    session.isPlaying = true;
  } else if (player.state.status === AudioPlayerStatus.AutoPaused) {
    // Transient no-subscriber pause during a reconnect. Try to unpause in place;
    // do NOT fall through to the restart-from-0 path below (which loses position).
    player.unpause();
  } else if (session.queue.length > 0 && session.currentIndex >= 0) {
    return playTrackInSession(guildId, session.queue[session.currentIndex]);
  }
  return true;
}

export function setVolume(guildId: string, volume: number): void {
  const session = sessions.get(guildId);
  if (!session) return;
  const v = Math.max(0, Math.min(1, volume));
  if (v === session.volume) return;
  session.volume = v;
  // The Opus pipeline has no live volume control, so apply the new volume by
  // reloading the current track from its current position (ffmpeg bakes the
  // volume in). The web UI commits volume on release, so this fires once per
  // adjustment rather than on every drag tick.
  if (session.isPlaying && session.currentIndex >= 0) {
    const pos = getPositionSeconds(session);
    playTrackInSession(guildId, session.queue[session.currentIndex], pos);
  }
}

export function setRepeatMode(guildId: string, mode: RepeatMode): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.repeatMode = mode;
}

export function setShuffle(guildId: string, shuffle: boolean): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.shuffle = shuffle;
}

/** Seek to a position (seconds) in the current track. */
export function seek(guildId: string, position: number): boolean {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  if (!session || !player || session.queue.length === 0 || session.currentIndex < 0) return false;
  return playTrackInSession(guildId, session.queue[session.currentIndex], position);
}

/**
 * Core playback. For the common case (playing from the start at full volume) it
 * streams the file's Opus packets straight to Discord with NO ffmpeg and NO
 * re-encoding (StreamType.OggOpus) — the robust, lightweight path. ffmpeg is
 * spawned only when seeking or applying a non-unity volume.
 *
 * The AudioPlayer owns the resource lifecycle: player.play(new) / player.stop()
 * destroy the previous playStream (closing the file handle / Opus demuxer). We
 * additionally track and kill any ffmpeg child ourselves, since the player does
 * not reap a hand-spawned process.
 */
function playTrackInSession(guildId: string, item: QueueItem, seekPosition?: number): boolean {
  const connection = connections.get(guildId);
  const player = players.get(guildId);
  const session = sessions.get(guildId);
  if (!connection || !player || !session) return false;

  const track = getTrack(item.trackId);
  if (!track) return false;

  const filePath = join(MUSIC_DIR, track.filename);
  if (!existsSync(filePath)) {
    console.error(`Track file not found: ${filePath}`);
    return false;
  }

  let readStream: any = null;
  try {
    // Reap any ffmpeg from a previous seek/volume resource before replacing it.
    const prev = ffmpegProcesses.get(guildId);
    if (prev) { killFfmpeg(prev); ffmpegProcesses.delete(guildId); }

    const seeking = seekPosition !== undefined && seekPosition > 0;
    const needsFfmpeg = seeking || session.volume !== 1;

    let resource;
    if (!needsFfmpeg) {
      // Lossless Opus passthrough — no transcode, no encoder.
      readStream = createReadStream(filePath);
      readStream.on('error', (err: any) => console.error(`Read stream error in guild ${guildId}:`, err?.message ?? err));
      resource = createAudioResource(readStream, { inputType: StreamType.OggOpus });
    } else {
      // Seek and/or volume: let ffmpeg do the work in C and emit Ogg/Opus so we
      // never touch the (fragile, slow) JS Opus encoder. Copy packets when only
      // seeking; re-encode with libopus only when applying a non-unity volume.
      const args: string[] = [];
      if (seeking) args.push('-ss', String(seekPosition));
      args.push('-i', filePath);
      if (session.volume !== 1) {
        args.push('-af', `volume=${session.volume}`, '-c:a', 'libopus', '-b:a', '128k');
      } else {
        args.push('-c:a', 'copy');
      }
      args.push('-f', 'opus', '-loglevel', 'error', 'pipe:1');
      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      ffmpegProcesses.set(guildId, ffmpeg);
      ffmpeg.on('error', (err) => {
        console.error('FFmpeg error:', err);
        // ffmpeg is required for seek/volume; if it can't run, surface it instead
        // of silently leaving the controls a dead end with no audio.
        session.lastError = 'Audio transcoder (ffmpeg) failed — seeking/volume is unavailable.';
        session.isPlaying = false;
      });
      // stdout/stderr are read directly; without 'error' handlers a stream error
      // (EPIPE on player stop) would be an unhandled exception.
      ffmpeg.stdout.on('error', () => {});
      ffmpeg.stderr.on('error', () => {});
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) console.error('FFmpeg:', msg);
      });
      resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
    }

    resources.set(guildId, resource);
    player.play(resource);
    session.isPlaying = true;
    session.lastError = null; // a successful (re)start clears any prior error
    const now = Date.now();
    playStartedAt.set(guildId, now);
    // Anchor the progress position at the seek target (or 0 for a fresh track).
    session.positionMs = (seekPosition ?? 0) * 1000;
    session.startedAtMs = now;
    return true;
  } catch (err) {
    console.error('Failed to play track:', err);
    // Don't leak the just-opened fd / spawned child if resource creation threw.
    if (readStream) { try { readStream.destroy(); } catch {} }
    const f = ffmpegProcesses.get(guildId);
    if (f) { killFfmpeg(f); ffmpegProcesses.delete(guildId); }
    return false;
  }
}
