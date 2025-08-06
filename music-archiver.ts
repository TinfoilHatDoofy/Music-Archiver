import { Innertube, UniversalCache, YTMusic } from 'https://deno.land/x/youtubei/deno.ts';
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

export interface OutputTrack {
  timestamps: string[];
  track_name: string | null;
  artist_name: string | null;
  album_name: string | null;
  spotify_track_uri: string;
}

export interface DLSongResult {
  id: string;
  title: string;
  thumbnails: DLSongThumbnail[];
  duration: DLSongDuration;
  album: DLSongAlbum;
  artists: DLSongArtist[];
}

export interface DLSongAlbum {
  id: string;
  name: string;
}

export interface DLSongArtist {
  name: string;
  channel_id: string;
}

export interface DLSongDuration {
  text: string;
  seconds: number;
}

export interface DLSongThumbnail {
  url: string;
  width: number;
  height: number;
}

interface SpotifyTrack {
  ts: string;
  platform: string;
  ms_played: number;
  conn_country: string;
  ip_addr: string;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name: string | null;
  spotify_track_uri: string | null;
  episode_name: string | null;
  episode_show_name: string | null;
  spotify_episode_uri: string | null;
  audiobook_title: string | null;
  audiobook_uri: string | null;
  audiobook_chapter_uri: string | null;
  audiobook_chapter_title: string | null;
  reason_start: string;
  reason_end: string;
  shuffle: boolean;
  skipped: boolean;
  offline: boolean;
  offline_timestamp: string | null;
  incognito_mode: boolean;
}

interface Config {
  minWaitTime: number;
  maxWaitTime: number;
  outputDir: string;
  audioFormat: string;
  verbose: boolean;
  useCookieFile: boolean;
  maxDuration: number;
  blacklistedKeywords: string[];
  saveHistoryJson: boolean;
  historyJsonPath?: string;
}

interface YTMusicSong {
  id?: string;
  title?: string;
  thumbnails?: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  duration?: {
    text: string;
    seconds: number;
  };
  album?: {
    id?: string;
    name?: string;
  };
  artists?: Array<{
    name: string;
    channel_id?: string;
  }>;
}

interface DownloadStats {
  successful: number;
  failed: number;
  skipped: number;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class MusicArchiver {
  private yt!: Innertube;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true
    });
  }

  async getExistingTrackIds(): Promise<Set<string>> {
    return this.scanOutputDirectory(/___trackId_([^.]+)\./);
  }

  async getExistingYtIds(): Promise<Set<string>> {
    return this.scanOutputDirectory(/__ytId__([^.]+)\./);
  }

  private async scanOutputDirectory(pattern: RegExp): Promise<Set<string>> {
    const ids = new Set<string>();

    try {
      for await (const entry of Deno.readDir(this.config.outputDir)) {
        if (entry.isFile && entry.name.endsWith(`.${this.config.audioFormat}`)) {
          const match = entry.name.match(pattern);
          if (match) {
            ids.add(match[1]);
          }
        }
      }
    } catch (error) {
      if (this.config.verbose) {
        console.warn(`⚠️  Could not scan output directory: ${getErrorMessage(error)}`);
      }
    }

    return ids;
  }

  async parseSpotifyStreamingHistory(directoryPath: string): Promise<OutputTrack[]> {
    const trackMap = new Map<string, OutputTrack>();
    let filesProcessed = 0;
    let totalTracksProcessed = 0;

    console.info('📂 Scanning for Spotify streaming history files...');

    try {
      for await (const dirEntry of Deno.readDir(directoryPath)) {
        if (dirEntry.isFile &&
          dirEntry.name.startsWith("Streaming_History_Audio_") &&
          dirEntry.name.endsWith(".json")) {

          const filePath = join(directoryPath, dirEntry.name);
          console.info(`📄 Processing: ${dirEntry.name}`);

          try {
            const fileContent = await Deno.readTextFile(filePath);
            const tracks: SpotifyTrack[] = JSON.parse(fileContent);
            totalTracksProcessed += tracks.length;

            for (const track of tracks) {
              if (track.spotify_track_uri) {
                const existing = trackMap.get(track.spotify_track_uri);

                if (existing) {
                  existing.timestamps.push(track.ts);
                } else {
                  trackMap.set(track.spotify_track_uri, {
                    timestamps: [track.ts],
                    track_name: track.master_metadata_track_name,
                    artist_name: track.master_metadata_album_artist_name,
                    album_name: track.master_metadata_album_album_name,
                    spotify_track_uri: track.spotify_track_uri
                  });
                }
              }
            }

            filesProcessed++;
          } catch (error) {
            console.error(`❌ Error processing file ${dirEntry.name}:`, getErrorMessage(error));
          }
        }
      }

      if (filesProcessed === 0) {
        throw new Error("No Streaming_History_Audio_*.json files found in the specified directory");
      }

      const outputTracks: OutputTrack[] = deduplicateTracks(Array.from(trackMap.values()).map(data => ({
        timestamps: data.timestamps.sort(),
        track_name: data.track_name,
        artist_name: data.artist_name,
        album_name: data.album_name,
        spotify_track_uri: data.spotify_track_uri,
      }))).sort((a, b) => b.timestamps.length - a.timestamps.length);

      console.info(`✅ Processed ${filesProcessed} history files`);
      console.info(`📊 Total listening events: ${totalTracksProcessed}`);
      console.info(`🎵 Unique tracks found: ${outputTracks.length}`);

      if (this.config.saveHistoryJson && this.config.historyJsonPath) {
        await Deno.writeTextFile(this.config.historyJsonPath, JSON.stringify(outputTracks, null, 2));
        console.info(`💾 History saved to: ${this.config.historyJsonPath}`);
      }

      return outputTracks;
    } catch (error) {
      console.error("❌ Error accessing directory:", getErrorMessage(error));
      throw error;
    }
  }

  async parseSpotifyHistoryFile(filePath: string): Promise<OutputTrack[]> {
    try {
      const content = await Deno.readTextFile(filePath);
      const tracks = JSON.parse(content) as OutputTrack[];

      if (!Array.isArray(tracks)) {
        throw new Error('Invalid file format - expected array of tracks');
      }

      console.info(`📁 Found ${tracks.length} tracks in history file`);
      return tracks;
    } catch (error) {
      console.error(`❌ Failed to parse history file: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async searchYouTubeMusic(title: string, artist: string): Promise<DLSongResult | null> {
    if (!title?.trim() || !artist?.trim()) {
      console.warn(`Skipping invalid song: "${title}" by "${artist}"`);
      return null;
    }

    console.info(`🔍 Searching: ${title} by ${artist}`);

    try {
      const search = await this.yt.music.search(`${title} ${artist}`, { type: 'song' });

      if (!search.songs?.contents?.length) {
        console.warn(`❌ No results found for: ${title} by ${artist}`);
        return null;
      }

      const song = this.selectBestMatch(
        search.songs.contents as YTMusicSong[],
        title,
        artist
      );

      if (!song) {
        return null;
      }

      if (this.shouldSkipSong(song)) {
        console.warn(`⚠️  Skipping unsuitable track: ${song.title} by ${song.artists?.[0]?.name}`);
        return null;
      }

      return this.formatSongResult(song);
    } catch (error) {
      console.error(`❌ Search failed for "${title}" by "${artist}":`, getErrorMessage(error));
      return null;
    }
  }

  private selectBestMatch(songs: YTMusicSong[], targetTitle: string, targetArtist: string): YTMusicSong | null {
    const normalizedTitle = targetTitle.toLowerCase().trim();
    const normalizedArtist = targetArtist.toLowerCase().trim();

    const exactMatch = songs.find(song =>
      song.title?.toLowerCase().trim() === normalizedTitle &&
      song.artists?.some(a => a.name.toLowerCase().trim() === normalizedArtist)
    );

    if (exactMatch) {
      return exactMatch;
    }

    const firstResult = songs[0];
    if (firstResult?.title && firstResult?.artists?.[0]) {
      console.warn(`⚠️  Using closest match: ${firstResult.title} by ${firstResult.artists[0].name}`);
      return firstResult;
    }

    return null;
  }

  private shouldSkipSong(song: YTMusicSong): boolean {
    const exceedsMaxDuration = song.duration?.seconds && song.duration.seconds > this.config.maxDuration;
    const containsBlacklistedKeywords = this.config.blacklistedKeywords.some(keyword =>
      song.title?.toLowerCase().includes(keyword) ||
      song.artists?.some(a => a.name.toLowerCase().includes(keyword))
    );

    return exceedsMaxDuration || containsBlacklistedKeywords;
  }

  private formatSongResult(song: YTMusicSong): DLSongResult | null {
    if (!song.id || !song.title || !song.duration) {
      return null;
    }

    return {
      id: song.id,
      title: song.title,
      thumbnails: (song.thumbnails || []).map(thumb => ({
        url: thumb.url,
        width: thumb.width,
        height: thumb.height
      })),
      duration: song.duration,
      album: {
        id: song.album?.id || '',
        name: song.album?.name || ''
      },
      artists: (song.artists || []).map(artist => ({
        channel_id: artist.channel_id || '',
        name: artist.name
      }))
    };
  }

  async downloadSong(
    song: DLSongResult,
    trackName: string,
    artistName: string,
    spotifyUri: string
  ): Promise<boolean> {
    if (!song.id || !song.title) {
      console.error('❌ Invalid song data for download');
      return false;
    }

    const trackId = this.extractTrackId(spotifyUri);
    const filename = this.generateFilename(trackName, artistName, song.id, trackId);
    const artistNames = song.artists.map(a => a.name).join(', ');

    console.info(`⬇️  Downloading: ${song.title} by ${artistNames}`);

    if (this.config.verbose) {
      console.debug(`🔧 YouTube ID: ${song.id}`);
      console.debug(`🔧 Output filename: ${filename}`);
    }

    try {
      const ytdlpArgs = this.buildYtdlpArgs(song.id, filename);

      if (this.config.verbose) {
        console.debug(`🔧 yt-dlp command: yt-dlp ${ytdlpArgs.join(' ')}`);
      }

      const success = await this.executeYtdlp(ytdlpArgs);

      if (!success) {
        console.error(`❌ Download failed for "${song.title}"`);
        return false;
      }

      const outputPath = `${this.config.outputDir}/${filename}.${this.config.audioFormat}`;
      const fileCreated = await this.fileExists(outputPath);

      if (fileCreated) {
        console.info(`✅ Downloaded: ${filename}.${this.config.audioFormat}`);
        return true;
      } else {
        console.error(`❌ File not created: ${outputPath}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Download error for "${song.title}":`, getErrorMessage(error));
      return false;
    }
  }

  private generateFilename(trackName: string, artistName: string, ytId: string, trackId: string): string {
    const sanitizedTitle = this.sanitizeFilename(trackName);
    const sanitizedArtist = this.sanitizeFilename(artistName);
    return `${sanitizedTitle}___${sanitizedArtist}__ytId__${ytId}___trackId_${trackId}`;
  }

  private buildYtdlpArgs(videoId: string, filename: string): string[] {
    return [
      '-x',
      '--audio-format', this.config.audioFormat,
      '--embed-thumbnail',
      '--convert-thumbnails', 'jpg',

      // Square crop for album art consistency
      // can't get this to work: ffmpeg: -c:v mjpeg -vf "crop=min(iw\,ih):min(iw\,ih)"
      // so using a simpler crop filter to ensure thumbnails are square
      '--ppa', 'ThumbnailsConvertor:-vf crop=ih:ih',

      '--embed-metadata',
      '--no-playlist',
      ...(this.config.useCookieFile ? ['--cookies', 'cookies.txt'] : []),
      '-o', `${this.config.outputDir}/${filename}.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`
    ];
  }

  private async executeYtdlp(args: string[]): Promise<boolean> {
    const ytdlp = new Deno.Command('yt-dlp', {
      args,
      stdout: 'piped',
      stderr: 'piped'
    });

    const process = ytdlp.spawn();

    const outputPromise = new Response(process.stdout).text().then(output => {
      if (output.trim() && this.config.verbose) {
        console.log('📺 yt-dlp stdout:', output);
      }
    });

    const errorPromise = new Response(process.stderr).text().then(error => {
      if (error.trim() && this.config.verbose) {
        console.log('📺 yt-dlp stderr:', error);
      }
    });

    const [{ success }] = await Promise.all([
      process.status,
      outputPromise,
      errorPromise
    ]);

    return success;
  }

  async processSpotifyHistory(tracks: OutputTrack[]): Promise<void> {
    const existingYtIds = await this.getExistingYtIds();
    const stats: DownloadStats = { successful: 0, failed: 0, skipped: 0 };

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];

      if (!track.track_name || !track.artist_name) {
        console.warn(`⚠️  Skipping track with missing metadata: ${track.spotify_track_uri}`);
        stats.failed++;
        continue;
      }

      console.info(`\n[${i + 1}/${tracks.length}] Processing: ${track.track_name} by ${track.artist_name}`);
      console.info(`📊 Play count: ${track.timestamps.length}`);

      try {
        const song = await this.searchYouTubeMusic(track.track_name, track.artist_name);

        if (!song) {
          stats.failed++;
          continue;
        }

        // Small delay to avoid hitting YouTube's rate limits
        await this.delay(2000);

        if (existingYtIds.has(song.id)) {
          console.info(`⏭️  Already downloaded: ${song.title}`);
          stats.skipped++;
          continue;
        }

        const success = await this.downloadSong(
          song,
          track.track_name,
          track.artist_name,
          track.spotify_track_uri
        );

        if (success) {
          stats.successful++;
        } else {
          stats.failed++;
        }

        if (i < tracks.length - 1) {
          const waitTime = this.getRandomWaitTime();
          console.info(`⏳ Waiting ${waitTime / 1000}s before next download...`);
          await this.delay(waitTime);
        }
      } catch (error) {
        console.error(`❌ Error processing ${track.track_name}:`, getErrorMessage(error));
        stats.failed++;
      }
    }

    console.info(`\n📊 Summary: ${stats.successful} successful, ${stats.failed} failed, ${stats.skipped} skipped`);
  }

  private extractTrackId(spotifyUri: string): string {
    return spotifyUri.split(':').pop() || 'unknown';
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  private getRandomWaitTime(): number {
    const { minWaitTime, maxWaitTime } = this.config;
    return Math.floor(Math.random() * (maxWaitTime - minWaitTime + 1) + minWaitTime) * 1000;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await Deno.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function validateDependencies(): Promise<void> {
  try {
    const ytdlp = new Deno.Command('yt-dlp', { args: ['--version'] });
    const process = ytdlp.spawn();
    const { success } = await process.status;

    if (!success) {
      throw new Error('yt-dlp not found or not executable');
    }
  } catch {
    console.error('❌ yt-dlp is required but not found. Please install it first.');
    console.error('   Install: https://github.com/yt-dlp/yt-dlp#installation');
    Deno.exit(1);
  }
}

async function ensureOutputDirectory(outputDir: string): Promise<void> {
  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      console.error(`❌ Failed to create output directory: ${getErrorMessage(error)}`);
      Deno.exit(1);
    }
  }
}

async function detectInputType(input: string): Promise<'directory' | 'json'> {
  try {
    const stat = await Deno.stat(input);
    if (stat.isDirectory) {
      return 'directory';
    }
    if (stat.isFile && input.endsWith('.json')) {
      return 'json';
    }
    throw new Error('Input must be a directory containing Spotify history files or a JSON file');
  } catch (error) {
    console.error(`❌ Invalid input path: ${getErrorMessage(error)}`);
    Deno.exit(1);
  }
}

function parseCliArguments(args: string[]): { inputPath: string; config: Config } {
  const flags = parseArgs(args, {
    string: ['output-dir', 'audio-format', 'blacklist', 'max-duration', 'min-wait', 'max-wait', 'save-json'],
    boolean: ['verbose', 'no-cookies', 'help'],
    alias: {
      o: 'output-dir',
      f: 'audio-format',
      v: 'verbose',
      h: 'help',
      s: 'save-json'
    },
    default: {
      'output-dir': './downloads',
      'audio-format': 'opus',
      'max-duration': 420,
      'min-wait': 6,
      'max-wait': 10,
      'no-cookies': false,
      'verbose': false
    }
  });

  if (flags.help || flags._.length === 0) {
    console.log(`
Usage: deno run --allow-all music-archiver.ts <input> [options]

Arguments:
  <input>    Either a directory containing Spotify streaming history files
             (Streaming_History_Audio_*.json) or a pre-processed JSON file

Options:
  -o, --output-dir <dir>     Output directory for downloads (default: ./downloads)
  -f, --audio-format <fmt>   Audio format: opus, mp3, m4a, etc. (default: opus)
  --max-duration <seconds>   Skip tracks longer than this (default: 420)
  --blacklist <keywords>     Comma-separated keywords to filter out
  --min-wait <seconds>       Minimum wait between downloads (default: 6)
  --max-wait <seconds>       Maximum wait between downloads (default: 10)
  -s, --save-json <path>     Save parsed history to JSON (only when input is directory)
  --no-cookies               Don't use cookies.txt file
  -v, --verbose              Enable verbose output
  -h, --help                 Show this help message

Examples:
  # Process raw Spotify data export
  deno run --allow-all music-archiver.ts ./spotify_data -o ./music

  # Use pre-processed JSON file
  deno run --allow-all music-archiver.ts ./history.json -o ./music

  # Save parsed history for later use
  deno run --allow-all music-archiver.ts ./spotify_data -s ./parsed_history.json

  # With custom filters
  deno run --allow-all music-archiver.ts ./spotify_data --blacklist "instrumental,karaoke"
		`);
    Deno.exit(flags.help ? 0 : 1);
  }

  const inputPath = flags._[0] as string;

  const blacklistedKeywords = flags.blacklist
    ? flags.blacklist.split(',').map(k => k.trim().toLowerCase())
    : [];

  const config: Config = {
    outputDir: flags['output-dir'],
    audioFormat: flags['audio-format'],
    maxDuration: Number(flags['max-duration']),
    minWaitTime: Number(flags['min-wait']),
    maxWaitTime: Number(flags['max-wait']),
    blacklistedKeywords,
    useCookieFile: !flags['no-cookies'],
    verbose: flags.verbose,
    saveHistoryJson: !!flags['save-json'],
    historyJsonPath: flags['save-json']
  };

  return { inputPath, config };
}

function filterNewTracks(tracks: OutputTrack[], existingTrackIds: Set<string>): OutputTrack[] {
  return tracks.filter(track => {
    const trackId = track.spotify_track_uri.split(':').pop();
    return !existingTrackIds.has(trackId || '');
  });
}

function deduplicateTracks(tracks: OutputTrack[]): OutputTrack[] {
  const uniqueTracks = new Map<string, OutputTrack>();

  for (const track of tracks) {
    const key = `${track.artist_name}|${track.track_name}`;
    if (!uniqueTracks.has(key)) {
      uniqueTracks.set(key, track);
    }
  }

  return Array.from(uniqueTracks.values());
}

async function main(): Promise<void> {
  const { inputPath, config } = parseCliArguments(Deno.args);

  console.info('🚀 Music Archiver Starting...');
  console.info(`📂 Input: ${inputPath}`);
  console.info(`📁 Output: ${config.outputDir}`);
  console.info(`🎵 Format: ${config.audioFormat}`);
  console.info(`⏱️  Max duration: ${config.maxDuration}s`);
  if (config.blacklistedKeywords.length > 0) {
    console.info(`🚫 Blacklisted: ${config.blacklistedKeywords.join(', ')}`);
  }
  if (config.verbose) {
    console.info(`🔧 Verbose mode enabled`);
  }

  try {
    await validateDependencies();
    await ensureOutputDirectory(config.outputDir);

    const downloader = new MusicArchiver(config);
    await downloader.initialize();

    const inputType = await detectInputType(inputPath);
    let allTracks: OutputTrack[];

    if (inputType === 'directory') {
      console.info('📂 Processing Spotify streaming history files...');
      allTracks = await downloader.parseSpotifyStreamingHistory(inputPath);
    } else {
      console.info('📄 Loading pre-processed history file...');
      allTracks = await downloader.parseSpotifyHistoryFile(inputPath);
    }

    const existingTrackIds = await downloader.getExistingTrackIds();

    console.info(`📁 Found ${existingTrackIds.size} already downloaded tracks`);

    const newTracks = filterNewTracks(allTracks, existingTrackIds);
    const uniqueNewTracks = deduplicateTracks(newTracks);

    console.info(`🎵 ${newTracks.length} tracks not yet downloaded`);
    console.info(`🎯 ${uniqueNewTracks.length} unique tracks to download (${newTracks.length - uniqueNewTracks.length} duplicates removed)`);

    await downloader.processSpotifyHistory(uniqueNewTracks);

    console.info('🎉 Download process completed!');
  } catch (error) {
    console.error('💥 Fatal error:', getErrorMessage(error));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error('💥 Unhandled error:', getErrorMessage(error));
    Deno.exit(1);
  });
}
