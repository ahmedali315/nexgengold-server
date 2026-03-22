const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── yt-dlp — python3 for Linux/Render ───────────────────────
const YTDLP = 'python3 -m yt_dlp';

// ─── User Agent — Bot detection se bachne ke liye ─────────────
const UA = '--user-agent "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"';

// ─── Common flags ─────────────────────────────────────────────
const FLAGS = `${UA} --no-warnings --no-check-certificates`;

app.use(cors());
app.use(express.json());

// ─── TEST ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'NexGenGold Server Running! 🔥', version: '2.0.0' });
});

// ─── SEARCH ───────────────────────────────────────────────────
app.get('/search', (req, res) => {
  const query = req.query.q;
  const limit = parseInt(req.query.limit) || 10;
  if (!query) return res.status(400).json({ error: 'Query required' });
  console.log(`🔍 Searching: ${query}`);

  const cmd = `${YTDLP} ${FLAGS} "ytsearch${limit}:${query}" --dump-json --flat-playlist`;

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

  const cmd = `${YTDLP} ${FLAGS} "${url}" --dump-json`;

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
            formats.push({ label: f.height >= 2160 ? '4K' : `${f.height}p`, height: f.height, ext: f.ext || 'mp4' });
          }
        });
        formats.sort((a, b) => b.height - a.height);
      }
      formats.push({ label: 'MP3 Audio', height: 0, ext: 'mp3' });
      res.json({ success: true, video: { id: d.id, title: d.title, channel: d.uploader || d.channel, duration: formatDuration(d.duration), views: formatViews(d.view_count), thumbnail: d.thumbnail, uploadDate: d.upload_date ? formatDate(d.upload_date) : 'Unknown', formats } });
    } catch (e) {
      res.status(500).json({ error: 'Parse failed' });
    }
  });
});

// ─── DOWNLOAD URL ─────────────────────────────────────────────
app.get('/download', (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality;
  const type = req.query.type;

  if (!url) return res.status(400).json({ error: 'URL required' });
  console.log(`⬇️ Download: quality=${quality} type=${type}`);

  let formatArg = '';

  if (type === 'audio') {
    // Audio only
    formatArg = `-f "bestaudio[ext=m4a]/bestaudio/best"`;
  } else if (quality && quality !== 'undefined' && quality !== '' && !isNaN(parseInt(quality))) {
    // Video with specific quality
    const q = parseInt(quality);
    formatArg = `-f "bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best"`;
  } else {
    // Default best quality
    formatArg = `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"`;
  }

  const cmd = `${YTDLP} ${FLAGS} ${formatArg} --get-url "${url}"`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 5, timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      console.error('Download error:', error.message);
      // Try fallback with simpler format
      const fallbackCmd = `${YTDLP} ${FLAGS} -f "best" --get-url "${url}"`;
      exec(fallbackCmd, { maxBuffer: 1024 * 1024 * 5, timeout: 30000 }, (err2, stdout2) => {
        if (err2) return res.status(500).json({ error: 'Download failed', details: err2.message });
        const lines2 = stdout2.trim().split('\n').filter(l => l.trim() && l.startsWith('http'));
        if (lines2.length === 0) return res.status(500).json({ error: 'No URL found' });
        console.log(`✅ Download URL ready (fallback)`);
        res.json({ success: true, downloadUrl: lines2[0] });
      });
      return;
    }
    const lines = stdout.trim().split('\n').filter(l => l.trim() && l.startsWith('http'));
    if (lines.length === 0) return res.status(500).json({ error: 'No URL found' });
    console.log(`✅ Download URL ready`);
    res.json({ success: true, downloadUrl: lines[0] });
  });
});

// ─── TRENDING ─────────────────────────────────────────────────
app.get('/trending', (req, res) => {
  console.log('🔥 Getting trending...');

  const cmd = `${YTDLP} ${FLAGS} "ytsearch15:Pakistan trending songs 2025" --dump-json --flat-playlist`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 20, timeout: 45000 }, (error, stdout) => {
    if (error) {
      console.log('Trending failed:', error.message);
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
          thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
          uploadDate: d.upload_date ? formatDate(d.upload_date) : 'Recent',
          url: `https://www.youtube.com/watch?v=${d.id}`,
        };
      });
      console.log(`✅ Trending: ${results.length} results`);
      res.json({ success: true, results });
    } catch (e) {
      res.json({ success: true, results: [] });
    }
  });
});

// ─── HELPERS ──────────────────────────────────────────────────
function formatDuration(s) {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
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
  if (!d || d.length !== 8) return 'Recent';
  const date = new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
  const diff = Math.floor((Date.now() - date) / 86400000);
  if (diff === 0) return 'Today';
  if (diff < 2) return '1 day ago';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff/7)} weeks ago`;
  if (diff < 365) return `${Math.floor(diff/30)} months ago`;
  return `${Math.floor(diff/365)} years ago`;
}

// ─── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════╗
  ║   NexGenGold Server v2.0 🔥      ║
  ║   Port: ${PORT}                     ║
  ║   Bot fix: ✅ User Agent added   ║
  ║   Fallback: ✅ Auto retry        ║
  ╚══════════════════════════════════╝
  → GET /              Test server
  → GET /search?q=...  Search videos
  → GET /info?url=...  Video info
  → GET /download?...  Download URL
  → GET /trending      Trending videos
  `);
});
