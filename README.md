# Skool Video Downloader

Bulk download videos from Skool.com membership sites.

## Prerequisites

```bash
# Install yt-dlp and ffmpeg
brew install yt-dlp ffmpeg
```

## Usage

```bash
cd skool-downloader

# First time: Login to Skool
npm run start -- login

# Download all videos from a course
npm run start -- download "https://www.skool.com/your-community"

# Dry run (see what would be downloaded)
npm run start -- download "https://www.skool.com/your-community" --dry-run

# Download specific module only
npm run start -- download "https://www.skool.com/your-community" --module "Week 1"

# Custom output directory
npm run start -- download "https://www.skool.com/your-community" -o ~/Videos/skool

# Check progress
npm run start -- status "https://www.skool.com/your-community"

# Resume interrupted download
npm run start -- resume "https://www.skool.com/your-community"
```

## Options

| Option | Description |
|--------|-------------|
| `-o, --output <dir>` | Output directory (default: `./downloads`) |
| `-c, --concurrency <n>` | Concurrent downloads (default: 2) |
| `-m, --module <name>` | Download specific module only |
| `--no-subs` | Skip subtitle download |
| `--dry-run` | List videos without downloading |

## How It Works

1. **Authentication**: Opens Chrome browser for manual Skool login
2. **Crawling**: Navigates classroom pages to enumerate modules and lessons
3. **Extraction**: Detects video provider (Wistia, Vimeo, YouTube, Loom) for each lesson
4. **Download**: Uses yt-dlp to download videos with best quality
5. **Resume**: Saves progress to JSON file for resuming interrupted downloads

## Output Structure

```
downloads/
└── Course_Name/
    ├── 01_Module_1/
    │   ├── 01_Lesson_1.mp4
    │   ├── 01_Lesson_1.en.srt
    │   └── 02_Lesson_2.mp4
    └── 02_Module_2/
        └── 01_Lesson_1.mp4
```

## Supported Video Providers

- Wistia (most common on Skool)
- Vimeo
- YouTube
- Loom
- Native Skool videos (m3u8 streams)
