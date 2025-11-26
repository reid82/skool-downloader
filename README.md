# Skool Downloader

Bulk download videos, text content, and resources from Skool.com membership sites.

## Features

- Download videos from multiple providers (Wistia, Vimeo, YouTube, Loom, native)
- Extract text content from modules as Markdown files
- Download attached resources (PDFs, documents, etc.)
- Extract and save links to external resources (Google Docs, Notion pages, etc.)
- Resume interrupted downloads
- Organized folder structure per lesson

## Prerequisites

```bash
# Install yt-dlp and ffmpeg (only needed for video downloads)
brew install yt-dlp ffmpeg
```

## Usage

```bash
cd skool-downloader

# First time: Login to Skool
npm run start -- login

# Download everything (videos + content + resources)
npm run start -- download "https://www.skool.com/your-community"

# Download only text content and resources (no videos)
npm run start -- download "https://www.skool.com/your-community" --content-only

# Download only videos (skip text content)
npm run start -- download "https://www.skool.com/your-community" --no-content

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
| `--no-content` | Skip text content and resource download |
| `--content-only` | Only download text content and resources (no videos) |
| `--dry-run` | List videos without downloading |

## How It Works

1. **Authentication**: Opens Chrome browser for manual Skool login
2. **Crawling**: Navigates classroom pages to enumerate modules and lessons
3. **Extraction**: For each lesson:
   - Detects video provider (Wistia, Vimeo, YouTube, Loom)
   - Extracts text content from the page
   - Parses attached resources and embedded links
4. **Download**:
   - Videos downloaded via yt-dlp with best quality
   - Resources (PDFs, docs) downloaded directly
   - Text content saved as Markdown
5. **Resume**: Saves progress to JSON file for resuming interrupted downloads

## Output Structure

```
downloads/
└── Course_Name/
    └── 01_Section_Title/
        └── 01_Lesson_Title/
            ├── video.mp4           # Video file
            ├── video.en.srt        # Subtitles (if available)
            ├── content.md          # Text content as Markdown
            └── resources/
                ├── Guide.pdf       # Downloaded resources
                └── Worksheet.docx
```

## Content Download Behavior

- **PDFs and documents**: Downloaded directly if publicly accessible
- **Google Drive files**: Converted to direct download URLs
- **Dropbox links**: Converted to direct download URLs
- **Notion pages**: Link preserved in content.md (pages can't be downloaded as files)
- **Auth-required resources**: Skipped with note in content.md
- **External links**: Listed in content.md for reference

## Supported Video Providers

- Wistia (most common on Skool)
- Vimeo
- YouTube
- Loom
- Native Skool videos (m3u8 streams)

## Migration

If you have existing downloads in the old structure (`01_Lesson.mp4`), run the migration script to reorganize into the new structure:

```bash
# Preview changes (dry run)
npx tsx scripts/migrate-structure.ts --dry-run

# Run migration
npx tsx scripts/migrate-structure.ts
```
