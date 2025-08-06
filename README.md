# Music Archiver

A Deno-based tool that downloads your Spotify listening history from YouTube Music using yt-dlp. Perfect for creating a local backup of your most-played tracks.

## Features

- 📊 **Parse Spotify streaming history** - Processes your Spotify data export files
- 🔍 **YouTube Music search** - Finds the best matches for your tracks
- ⬇️ **Audio downloads** - Uses yt-dlp with embedded metadata and thumbnails
- 🚫 **Duplicate prevention** - Skips already downloaded tracks automatically
- ⏱️ **Rate limiting** - Respects YouTube's limits with configurable delays
- 🎛️ **Flexible filtering** - Filter out undesirable tracks by duration, keywords, and more

> [!CAUTION]
> **Before proceeding:** Verify that your intended use complies with:
> - Local copyright legislation
> - YouTube's and Spotify's current Terms of Service
> - Any regional restrictions on content downloading
> 
> This tool does not provide legal authorization to download copyrighted material. Users bear full legal responsibility for their actions.


## Prerequisites

- [Deno](https://deno.land/) (v1.30+)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Install from their official repo
- [FFmpeg](https://ffmpeg.org/download.html) - Required for audio processing and thumbnail conversion
- **cookies.txt** (recommended) - YouTube cookies for better access, see [yt-dlp FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp) for format
- Spotify streaming history data (see [Getting Spotify Data](#getting-spotify-data))

## Quick Start

```bash
# Download your most-played tracks
deno run --allow-all music-archiver.ts ./spotify_data_export

# Specify custom output directory and format
deno run --allow-all music-archiver.ts ./spotify_data -o ./my_music -f mp3

# Use a pre-processed history file
deno run --allow-all music-archiver.ts ./saved_history.json
```

> **Note:** The default opus format is ideal for streaming and storage, offering excellent compression with smaller file sizes while maintaining audio quality.

## Getting Spotify Data

1. Go to [Spotify Privacy Settings](https://www.spotify.com/account/privacy/)
2. Request your data export
3. Wait 1-30 days for the download link
4. Extract the ZIP and locate `Streaming_History_Audio_*.json` files
5. Point the tool to the directory containing these files

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output-dir` | Download directory | `./downloads` |
| `-f, --audio-format` | Audio format (opus, mp3, m4a, etc.) - opus default offers excellent compression | `opus` |
| `--max-duration` | Skip tracks longer than X seconds | `420` (7 min) |
| `--blacklist` | Comma-separated keywords to filter out | None |
| `--min-wait / --max-wait` | Wait time between downloads (seconds) | `6-10` |
| `-s, --save-json` | Save parsed history for later use | None |
| `--no-cookies` | Don't use cookies.txt file | `false` |
| `-v, --verbose` | Enable detailed logging | `false` |

## Examples

```bash
# Save parsed history for faster future runs
deno run --allow-all music-archiver.ts ./spotify_data -s ./my_history.json

# Filter out instrumentals and long tracks
deno run --allow-all music-archiver.ts ./spotify_data \
  --blacklist "instrumental,karaoke,remix" \
  --max-duration 300
```

## How It Works

1. **Parse** - Reads your Spotify streaming history and sorts tracks by most to least played
2. **Search** - Finds matching songs on YouTube Music using track + artist info
3. **Download** - Uses yt-dlp to download audio with embedded metadata and square-cropped thumbnails
4. **Resume** - Automatically skips previously downloaded tracks on subsequent runs

## Troubleshooting

- **"yt-dlp not found"** - Install yt-dlp following their [installation guide](https://github.com/yt-dlp/yt-dlp#installation)
- **Rate limiting errors** - Increase `--min-wait` and `--max-wait` values
- **No matches found** - Some tracks may not be available on YouTube Music

## License

MIT License - Feel free to modify and distribute as needed.
