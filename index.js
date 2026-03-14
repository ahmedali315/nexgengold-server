const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

// ─── yt-dlp command (Python module) ──────────────────────────
const YTDLP = 'python -m yt_dlp';

app.use(cors());
app.use(express.json());

// ─── TEST ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'NexGenGold Server Running! 🔥', version: '1.0.0' });
});

// ─── SEARCH ───────────────────────────────────────────────────
app.get('/search', (req, res) => {
  const query = req.query.q;
  const limit = req.query.limit || 10;

  if (!query) return res.status(400).json({ error: 'Query required' });

  console.log(`🔍 Searching: ${query}`);

  const cmd = `${YTDLP} "ytsearch${limit}:${query}" --dump-json --flat-playlist --no-warnings`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (error, stdout) => {
    if (error) {
      console.error('Search error:', error.message);
      return res.status(500).json({ error: 'Search failed', details: error.message });
    }

    try {
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const results = lines.map(line => {
        const d = JSON.parse(line);
        return {
          id: d.id,
          title: d.title || 'Unknown Title',
          channel: d.uploader || d.channel || 'Unknown',
          duration: formatDuration(d.duration),
          views: formatViews(d.view_count),
          thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
          uploadDate: d.upload_date ? formatDate(d.upload_date) : 'Recent',
          url: `https://www.youtube.com/watch?v=${d.id}`,
        };
      });
      console.log(`✅ Found ${results.length} results`);
      res.json({ success: true, results });
    } catch (e) {
      res.status(500).json({ error: 'Parse failed', details: e.message });
    }
  });
});

// ─── VIDEO INFO ───────────────────────────────────────────────
app.get('/info', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });

  console.log(`📋 Info: ${url}`);

  const cmd = `${YTDLP} "${url}" --dump-json --no-warnings`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (error, stdout) => {
    if (error) return res.status(500).json({ error: 'Info fetch failed' });

    try {
      const d = JSON.parse(stdout);
      const formats = [];

      if (d.formats) {
        const seen = new Set();
        d.formats.forEach(f => {
          if (f.height && !seen.has(f.height)) {
            seen.add(f.height);
            let label = `${f.height}p`;
            if (f.height >= 2160) label = '4K';
            formats.push({ label, height: f.height, ext: f.ext || 'mp4' });
          }
        });
        formats.sort((a, b) => b.height - a.height);
      }

      formats.push({ label: 'MP3 Audio', height: 0, ext: 'mp3' });
      formats.push({ label: 'M4A Audio', height: 0, ext: 'm4a' });

      res.json({
        success: true,
        video: {
          id: d.id,
          title: d.title,
          channel: d.uploader || d.channel,
          duration: formatDuration(d.duration),
          views: formatViews(d.view_count),
          thumbnail: d.thumbnail,
          uploadDate: d.upload_date ? formatDate(d.upload_date) : 'Unknown',
          formats,
        }
      });
    } catch (e) {
      res.status(500).json({ error: 'Parse failed' });
    }
  });
});

// ─── DOWNLOAD URL ─────────────────────────────────────────────
app.get('/download', (req, res) => {
  const { url, quality, type } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  console.log(`⬇️ Download: quality=${quality} type=${type}`);

  let formatArg = '';
  if (type === 'audio') {
    formatArg = `-x --audio-format mp3`;
  } else if (quality) {
    formatArg = `-f "bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]"`;
  } else {
    formatArg = `-f "bestvideo+bestaudio/best"`;
  }

  const cmd = `${YTDLP} ${formatArg} --get-url "${url}" --no-warnings`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 5, timeout: 30000 }, (error, stdout) => {
    if (error) return res.status(500).json({ error: 'Could not get download URL' });
    const downloadUrl = stdout.trim().split('\n')[0];
    res.json({ success: true, downloadUrl });
  });
});

// ─── TRENDING ─────────────────────────────────────────────────
app.get('/trending', (req, res) => {
  console.log('🔥 Getting trending...');

  const cmd = `${YTDLP} "https://www.youtube.com/feed/trending" --dump-json --flat-playlist --no-warnings --playlist-end 15`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 20, timeout: 45000 }, (error, stdout) => {
    if (error) {
      console.log('Trending failed, returning empty');
      return res.json({ success: true, results: [] });
    }

    try {
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const results = lines.map(line => {
        const d = JSON.parse(line);
        return {
          id: d.id,
          title: d.title || 'Unknown',
          channel: d.uploader || d.channel || 'Unknown',
          duration: formatDuration(d.duration),
          views: formatViews(d.view_count),
          thumbnail: `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
          uploadDate: d.upload_date ? formatDate(d.upload_date) : 'Recent',
          url: `https://www.youtube.com/watch?v=${d.id}`,
        };
      });
      res.json({ success: true, results });
    } catch (e) {
      res.json({ success: true, results: [] });
    }
  });
});

// ─── HELPERS ──────────────────────────────────────────────────
function formatDuration(s) {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function formatViews(v) {
  if (!v) return '0';
  if (v >= 1e9) return `${(v/1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
  return String(v);
}

function formatDate(d) {
  if (!d || d.length !== 8) return 'Unknown';
  const date = new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
  const diff = Math.floor((Date.now() - date) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return '1 day ago';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff/7)} weeks ago`;
  if (diff < 365) return `${Math.floor(diff/30)} months ago`;
  return `${Math.floor(diff/365)} years ago`;
}

// ─── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════╗
  ║   NexGenGold Server Started! 🔥  ║
  ║   Port: ${PORT}                     ║
  ║   yt-dlp: python -m yt_dlp  ✅   ║
  ╚══════════════════════════════════╝

  Routes:
  → GET /              Test server
  → GET /search?q=...  Search videos
  → GET /info?url=...  Video info
  → GET /download?...  Download URL
  → GET /trending      Trending videos
  `);
});
