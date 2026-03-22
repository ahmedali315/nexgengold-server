const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── YouTube API Key ──────────────────────────────────────────
const YT_API_KEY = process.env.YT_API_KEY || 'AIzaSyCRByNqSgqg0eLCu22GJDBOi8Im2IkTI1w';

// ─── yt-dlp — sirf download ke liye ─────────────────────────
const YTDLP = 'python3 -m yt_dlp';
const UA = '--user-agent "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"';
const FLAGS = `${UA} --no-warnings --no-check-certificates`;

app.use(cors());
app.use(express.json());

// ─── Helper: YouTube API call ─────────────────────────────────
function ytApiGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/youtube/v3/${path}&key=${YT_API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ─── Format helpers ───────────────────────────────────────────
function formatDuration(iso) {
  if (!iso) return '0:00';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatViews(v) {
  if (!v) return '0';
  const n = parseInt(v);
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return String(n);
}

function formatDate(d) {
  if (!d) return 'Recent';
  const date = new Date(d);
  const diff = Math.floor((Date.now() - date) / 86400000);
  if (diff === 0) return 'Today';
  if (diff < 2) return '1 day ago';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff/7)} weeks ago`;
  if (diff < 365) return `${Math.floor(diff/30)} months ago`;
  return `${Math.floor(diff/365)} years ago`;
}

function formatDurationOld(s) {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// ─── TEST ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'NexGenGold Server Running! 🔥', version: '3.0.0', search: 'YouTube API ✅', download: 'yt-dlp ✅' });
});

// ─── SEARCH — YouTube API ─────────────────────────────────────
app.get('/search', async (req, res) => {
  const query = req.query.q;
  const limit = parseInt(req.query.limit) || 10;
  if (!query) return res.status(400).json({ error: 'Query required' });
  console.log(`🔍 Searching: ${query}`);

  try {
    // Step 1: Search videos
    const searchData = await ytApiGet(
      `search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${limit}&regionCode=PK&relevanceLanguage=ur`
    );

    if (!searchData.items || searchData.items.length === 0) {
      return res.json({ success: true, results: [] });
    }

    // Step 2: Get video details (duration + views)
    const ids = searchData.items.map(i => i.id.videoId).join(',');
    const detailData = await ytApiGet(
      `videos?part=contentDetails,statistics&id=${ids}`
    );

    // Map details by ID
    const details = {};
    (detailData.items || []).forEach(item => {
      details[item.id] = {
        duration: formatDuration(item.contentDetails?.duration),
        views: formatViews(item.statistics?.viewCount),
      };
    });

    const results = searchData.items.map(item => {
      const id = item.id.videoId;
      const snippet = item.snippet;
      return {
        id,
        title: snippet.title || 'Unknown',
        channel: snippet.channelTitle || 'Unknown',
        duration: details[id]?.duration || '0:00',
        views: details[id]?.views || '0',
        thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        uploadDate: formatDate(snippet.publishedAt),
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    });

    console.log(`✅ Found ${results.length} results`);
    res.json({ success: true, results });
  } catch (e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

// ─── TRENDING — YouTube API ───────────────────────────────────
app.get('/trending', async (req, res) => {
  console.log('🔥 Getting trending...');

  try {
    // Trending videos for Pakistan
    const trendData = await ytApiGet(
      `videos?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=PK&maxResults=15&videoCategoryId=0`
    );

    if (!trendData.items || trendData.items.length === 0) {
      return res.json({ success: true, results: [] });
    }

    const results = trendData.items.map(item => ({
      id: item.id,
      title: item.snippet?.title || 'Unknown',
      channel: item.snippet?.channelTitle || 'Unknown',
      duration: formatDuration(item.contentDetails?.duration),
      views: formatViews(item.statistics?.viewCount),
      thumbnail: item.snippet?.thumbnails?.high?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      uploadDate: formatDate(item.snippet?.publishedAt),
      url: `https://www.youtube.com/watch?v=${item.id}`,
    }));

    console.log(`✅ Trending: ${results.length} results`);
    res.json({ success: true, results });
  } catch (e) {
    console.error('Trending error:', e.message);
    res.json({ success: true, results: [] });
  }
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
      res.json({ success: true, video: { id: d.id, title: d.title, channel: d.uploader || d.channel, duration: formatDurationOld(d.duration), views: formatViews(d.view_count), thumbnail: d.thumbnail, uploadDate: 'Unknown', formats } });
    } catch (e) {
      res.status(500).json({ error: 'Parse failed' });
    }
  });
});

// ─── DOWNLOAD URL — yt-dlp ────────────────────────────────────
app.get('/download', (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality;
  const type = req.query.type;

  if (!url) return res.status(400).json({ error: 'URL required' });
  console.log(`⬇️ Download: quality=${quality} type=${type}`);

  let formatArg = '';
  if (type === 'audio') {
    formatArg = `-f "bestaudio[ext=m4a]/bestaudio/best"`;
  } else if (quality && quality !== 'undefined' && quality !== '' && !isNaN(parseInt(quality))) {
    const q = parseInt(quality);
    formatArg = `-f "bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best"`;
  } else {
    formatArg = `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"`;
  }

  const cmd = `${YTDLP} ${FLAGS} ${formatArg} --get-url "${url}"`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 5, timeout: 30000 }, (error, stdout) => {
    if (error) {
      console.error('Download error:', error.message);
      // Fallback
      const fallback = `${YTDLP} ${FLAGS} -f "best" --get-url "${url}"`;
      exec(fallback, { maxBuffer: 1024 * 1024 * 5, timeout: 30000 }, (err2, stdout2) => {
        if (err2) return res.status(500).json({ error: 'Download failed', details: err2.message });
        const lines = stdout2.trim().split('\n').filter(l => l.trim() && l.startsWith('http'));
        if (lines.length === 0) return res.status(500).json({ error: 'No URL found' });
        console.log(`✅ Download URL ready (fallback)`);
        res.json({ success: true, downloadUrl: lines[0] });
      });
      return;
    }
    const lines = stdout.trim().split('\n').filter(l => l.trim() && l.startsWith('http'));
    if (lines.length === 0) return res.status(500).json({ error: 'No URL found' });
    console.log(`✅ Download URL ready`);
    res.json({ success: true, downloadUrl: lines[0] });
  });
});

// ─── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   NexGenGold Server v3.0 🔥          ║
  ║   Port: ${PORT}                         ║
  ║   Search:   YouTube API v3 ✅        ║
  ║   Trending: YouTube API v3 ✅        ║
  ║   Download: yt-dlp ✅                ║
  ╚══════════════════════════════════════╝
  → GET /              Test server
  → GET /search?q=...  Search videos
  → GET /info?url=...  Video info
  → GET /download?...  Download URL
  → GET /trending      Trending videos
  `);
});
