import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';

const DATA_DIR = join(import.meta.dir, '../music');
const METADATA_FILE = join(DATA_DIR, 'metadata.json');

// Ensure data dir exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

export interface Track {
  id: string;
  title: string;
  url: string;
  duration: number;
  filename: string;
  category: string;
  addedAt: string; // ISO date
  favorite: boolean;
}

export interface Category {
  id: string;
  name: string;
  trackIds: string[];
}

export interface MusicLibrary {
  tracks: Track[];
  categories: Category[];
}

// ---------------------------------------------------------------------------
// In-memory library cache.
//
// The library is loaded from disk ONCE at module init and then served entirely
// from memory. Every read is a plain object access (no I/O); writes mutate the
// in-memory object and schedule a debounced, atomic write-back to disk.
//
// Why: previously every exported function re-read and JSON.parsed the whole
// metadata file synchronously on each call. That ran on the same event loop as
// the Discord client, so a large queue (setQueue maps getTrack over every item)
// could stall the loop long enough to miss Discord's 3s interaction-ack window,
// making slash commands silently fail.
//
// Tradeoff: external edits to metadata.json while the process runs are no longer
// picked up — this service is the single writer, so that is acceptable.
// ---------------------------------------------------------------------------

function loadLibraryFromDisk(): MusicLibrary {
  try {
    if (existsSync(METADATA_FILE)) {
      const data = readFileSync(METADATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load music metadata, starting fresh:', err);
  }
  return { tracks: [], categories: [] };
}

const library: MusicLibrary = loadLibraryFromDisk();

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writePending = false;

/** Schedule a debounced, atomic persist of the in-memory library. */
function persist(): void {
  writePending = true;
  if (writeTimer) return; // already scheduled
  writeTimer = setTimeout(flush, 250);
}

function flush(): void {
  writeTimer = null;
  if (!writePending) return;
  writePending = false;
  try {
    const tmp = `${METADATA_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(library, null, 2), 'utf-8');
    renameSync(tmp, METADATA_FILE); // atomic on the same filesystem
  } catch (err) {
    console.error('Failed to persist music metadata:', err);
    writePending = true; // retry on next persist()
  }
}

/** Force any pending write to disk immediately. Call on graceful shutdown. */
export function flushNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flush();
}

/** Get all tracks */
export function getAllTracks(): Track[] {
  return library.tracks;
}

/** Get all categories */
export function getAllCategories(): Category[] {
  return library.categories;
}

/** Get tracks in a category */
export function getTracksByCategory(categoryId: string): Track[] {
  const cat = library.categories.find(c => c.id === categoryId);
  if (!cat) return [];
  return cat.trackIds
    .map(id => library.tracks.find(t => t.id === id))
    .filter((t): t is Track => !!t);
}

/** Get a single track by id */
export function getTrack(id: string): Track | undefined {
  return library.tracks.find(t => t.id === id);
}

/** Add a track (from download) */
export function addTrack(track: Omit<Track, 'category' | 'addedAt' | 'favorite'> & { category?: string }): Track {
  const newTrack: Track = {
    id: track.id,
    title: track.title,
    url: track.url,
    duration: track.duration,
    filename: track.filename,
    category: track.category || 'uncategorized',
    addedAt: new Date().toISOString(),
    favorite: false,
  };

  library.tracks.push(newTrack);

  // Ensure the category exists
  let cat = library.categories.find(c => c.name === newTrack.category);
  if (!cat) {
    cat = { id: nanoid(8), name: newTrack.category, trackIds: [] };
    library.categories.push(cat);
  }
  if (!cat.trackIds.includes(newTrack.id)) {
    cat.trackIds.push(newTrack.id);
  }

  persist();
  return newTrack;
}

/** Add multiple tracks (from playlist download) */
export function addTracks(
  tracks: Omit<Track, 'category' | 'addedAt'>[],
  categoryName: string
): Track[] {
  const result: Track[] = [];

  let cat = library.categories.find(c => c.name === categoryName);
  if (!cat) {
    cat = { id: nanoid(8), name: categoryName, trackIds: [] };
    library.categories.push(cat);
  }

  for (const t of tracks) {
    const newTrack: Track = {
      ...t,
      category: categoryName,
      addedAt: new Date().toISOString(),
      favorite: false,
    };
    library.tracks.push(newTrack);
    cat.trackIds.push(newTrack.id);
    result.push(newTrack);
  }

  persist();
  return result;
}

/** Remove a track by id */
export function removeTrack(id: string): boolean {
  const idx = library.tracks.findIndex(t => t.id === id);
  if (idx === -1) return false;

  library.tracks.splice(idx, 1);

  // Remove from all categories
  for (const cat of library.categories) {
    cat.trackIds = cat.trackIds.filter(tid => tid !== id);
  }

  // Remove empty categories
  library.categories = library.categories.filter(c => c.trackIds.length > 0);

  persist();
  return true;
}

/** Rename a category */
export function renameCategory(categoryId: string, newName: string): boolean {
  const cat = library.categories.find(c => c.id === categoryId);
  if (!cat) return false;
  cat.name = newName;
  persist();
  return true;
}

/** Delete a category (doesn't delete tracks) */
export function deleteCategory(categoryId: string): boolean {
  const idx = library.categories.findIndex(c => c.id === categoryId);
  if (idx === -1) return false;
  library.categories.splice(idx, 1);
  persist();
  return true;
}

/** Move track to a different category */
export function moveTrack(trackId: string, newCategory: string): boolean {
  const track = library.tracks.find(t => t.id === trackId);
  if (!track) return false;

  // Remove from old category
  for (const cat of library.categories) {
    cat.trackIds = cat.trackIds.filter(tid => tid !== trackId);
  }

  track.category = newCategory;

  // Ensure new category exists
  let cat = library.categories.find(c => c.name === newCategory);
  if (!cat) {
    cat = { id: nanoid(8), name: newCategory, trackIds: [] };
    library.categories.push(cat);
  }
  cat.trackIds.push(trackId);

  // Remove empty categories
  library.categories = library.categories.filter(c => c.trackIds.length > 0);

  persist();
  return true;
}

/** Toggle favorite status */
export function toggleFavorite(trackId: string): Track | undefined {
  const track = library.tracks.find(t => t.id === trackId);
  if (!track) return undefined;
  track.favorite = !track.favorite;
  persist();
  return track;
}

/** Get all favorite tracks */
export function getFavoriteTracks(): Track[] {
  return library.tracks.filter(t => t.favorite);
}

/** Create a new empty category */
export function createCategory(name: string): Category | undefined {
  if (!name.trim()) return undefined;
  if (library.categories.find(c => c.name === name.trim())) return undefined;
  const cat = { id: nanoid(8), name: name.trim(), trackIds: [] };
  library.categories.push(cat);
  persist();
  return cat;
}
