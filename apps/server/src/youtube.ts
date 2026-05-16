import { nanoid } from 'nanoid';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const YT_DLP = 'yt-dlp';
const MUSIC_DIR = join(import.meta.dir, '../music/tracks');

if (!existsSync(MUSIC_DIR)) {
  mkdirSync(MUSIC_DIR, { recursive: true });
}

export interface DownloadResult {
  id: string;
  title: string;
  url: string;
  duration: number;
  filename: string;
  playlistTitle?: string;
}

/** Extract video/playlist IDs from various YouTube URL formats */
export function parseYouTubeUrl(url: string): { type: 'video' | 'playlist'; videoId?: string; playlistId?: string } {
  // Handle youtu.be short URLs
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortMatch) return { type: 'video', videoId: shortMatch[1] };

  // Handle youtube.com watch URLs
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);

  if (listMatch) {
    return { type: 'playlist', playlistId: listMatch[1] };
  }

  if (watchMatch) {
    return { type: 'video', videoId: watchMatch[1] };
  }

  // Handle youtube.com/playlist URLs
  const playlistMatch = url.match(/\/playlist\?list=([a-zA-Z0-9_-]+)/);
  if (playlistMatch) {
    return { type: 'playlist', playlistId: playlistMatch[1] };
  }

  throw new Error(`Unable to parse YouTube URL: ${url}`);
}

/** Get metadata for a video without downloading */
export async function getVideoInfo(url: string): Promise<{ title: string; duration: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP, [
      '--print', '%(title)s',
      '--print', '%(duration)s',
      '--no-download',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp info failed: ${stderr}`));
        return;
      }
      const lines = stdout.trim().split('\n');
      resolve({
        title: lines[0] || 'Unknown Track',
        duration: parseInt(lines[1] || '0', 10),
      });
    });

    proc.on('error', reject);
  });
}

/** Download a single YouTube video as opus audio */
export async function downloadVideo(url: string, onProgress?: (line: string) => void): Promise<DownloadResult> {
  const id = nanoid(12);
  const outputTemplate = join(MUSIC_DIR, `${id}.%(ext)s`);

  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP, [
      '-x', // extract audio
      '--audio-format', 'opus',
      '--audio-quality', '0', // best quality
      '--print', 'after_move:%(title)s',
      '--print', 'after_move:%(duration)s',
      '--print', 'after_move:%(webpage_url)s',
      '-o', outputTemplate,
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) onProgress(text);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // yt-dlp prints download progress to stderr
      if (onProgress) onProgress(chunk.toString());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed (exit ${code}): ${stderr}`));
        return;
      }

      // Parse the after_move output (last 3 lines)
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const metaLines = lines.filter(l => !l.startsWith('[youtube]') && !l.startsWith('[info]') && !l.startsWith('[Metadata]') && !l.startsWith('[ExtractAudio]') && !l.startsWith('[Merger]'));

      const title = metaLines[metaLines.length - 3] || 'Unknown Track';
      const duration = parseInt(metaLines[metaLines.length - 2] || '0', 10);
      const sourceUrl = metaLines[metaLines.length - 1] || url;

      // Find the actual file
      const possibleExts = ['.opus', '.m4a', '.webm', '.mp3'];
      let filename = '';
      for (const ext of possibleExts) {
        const f = `${id}${ext}`;
        if (existsSync(join(MUSIC_DIR, f))) {
          filename = f;
          break;
        }
      }

      if (!filename) {
        // Try to find any file starting with the id
        const { readdirSync } = require('fs');
        const files = readdirSync(MUSIC_DIR);
        const match = files.find((f: string) => f.startsWith(id));
        if (match) {
          filename = match;
        } else {
          reject(new Error('Download completed but could not find the audio file'));
          return;
        }
      }

      resolve({
        id,
        title,
        url: sourceUrl,
        duration,
        filename,
      });
    });

    proc.on('error', reject);
  });
}

export interface PlaylistItem {
  id: string;
  title: string;
  url: string;
  duration: number;
  filename: string;
}

/** Download an entire YouTube playlist */
export async function downloadPlaylist(
  playlistUrl: string,
  onTrackProgress?: (index: number, total: number, title: string) => void
): Promise<{ playlistTitle: string; tracks: PlaylistItem[] }> {
  // First get playlist metadata
  const info = await new Promise<{ title: string; entries: { title: string; url: string; duration: number }[] }>((resolve, reject) => {
    const proc = spawn(YT_DLP, [
      '--flat-playlist',
      '--print', '%(playlist_title)s',
      '--print', '%(title)s',
      '--print', '%(webpage_url)s',
      '--print', '%(duration)s',
      '--dump-json',
      playlistUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`yt-dlp playlist info failed: ${stderr}`));
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const playlistTitle = lines[0] || 'Unknown Playlist';
      const entries: { title: string; url: string; duration: number }[] = [];

      for (let i = 1; i < lines.length; i += 3) {
        if (i + 2 < lines.length) {
          entries.push({
            title: lines[i],
            url: lines[i + 1],
            duration: parseInt(lines[i + 2] || '0', 10),
          });
        }
      }
      resolve({ title: playlistTitle, entries });
    });
    proc.on('error', reject);
  });

  // Download each track sequentially
  const tracks: PlaylistItem[] = [];
  for (let i = 0; i < info.entries.length; i++) {
    const entry = info.entries[i];
    onTrackProgress?.(i + 1, info.entries.length, entry.title || 'Unknown');
    try {
      const result = await downloadVideo(entry.url);
      tracks.push({
        id: result.id,
        title: result.title,
        url: result.url,
        duration: result.duration,
        filename: result.filename,
      });
    } catch (err) {
      console.error(`Failed to download playlist track ${i + 1} "${entry.title}":`, err);
      // Continue with other tracks
    }
  }

  return { playlistTitle: info.title, tracks };
}

/** Delete a track file from disk */
export function deleteTrackFile(filename: string): void {
  const { unlinkSync } = require('fs');
  const filePath = join(MUSIC_DIR, filename);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Failed to delete track file ${filename}:`, err);
  }
}

/** List all files in the tracks directory */
export function listTrackFiles(): string[] {
  const { readdirSync } = require('fs');
  try {
    return readdirSync(MUSIC_DIR).filter((f: string) => f !== '.gitkeep');
  } catch {
    return [];
  }
}
