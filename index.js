const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const YT_API_KEY = process.env.YT_API_KEY || '';
const COOKIES_SRC = '/etc/secrets/cookies.txt';
const COOKIES_DST = '/tmp/yt_cookies.txt';
const YTDLP = 'python3 -m yt_dlp';
const UA = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';

function setupCookies() {
  try {
    if (fs.existsSync(COOKIES_SRC)) {
      fs.copyFileSync(COOKIES_SRC, COOKIES_DST);
      fs.chmodSync(COOKIES_DST, 0o666);
      console.log('✅ Cookies ready');
      return true;
    }
  } catch (e) { console.log('Cookies error:', e.message); }
  return false;
}
setupCookies();

function getFlags() {
  setupCookies();
  const c = fs.existsSync(COOKIES_DST) ? `--cookies ${COOKIES_DST}` : '';
  return `--user-agent "${UA}" --no-warnings --no-check-certificates ${c}`;
}

app.use(cors());
app.use(express.json());

function ytApiGet(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://www.googleapis.com/youtube/v3/${path}&key=${YT_API_KEY}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function fmtDur(iso) {
  if (!iso) return '0:00';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const h=parseInt(m[1]||0), mn=parseInt(m[2]||0), s=parseInt(m[3]||0);
  if (h>0) return `${h}:${String(mn).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${mn}:${String(s).padStart(2,'0')}`;
}
function fmtDurSec(s) {
  if (!s) return '0:00';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtViews(v) {
  if (!v) return '0'; const n=parseInt(v);
  if (n>=1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n>=1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n>=1e3) return `${(n/1e3).toFixed(0)}K`;
  return String(n);
}
function fmtDate(d) {
  if (!d) return 'Recent';
  const diff=Math.floor((Date.now()-new Date(d))/86400000);
  if (diff===0) return 'Today'; if (diff<2) return '1 day ago';
  if (diff<7) return `${diff} days ago`; if (diff<30) return `${Math.floor(diff/7)} weeks ago`;
  if (diff<365) return `${Math.floor(diff/30)} months ago`;
  return `${Math.floor(diff/365)} years ago`;
}

app.get('/', (req, res) => res.json({
  status: 'NexGenGold Server Running! 🔥', version: '3.3.0',
  cookies: fs.existsSync(COOKIES_DST) ? 'loaded ✅' : 'missing ⚠️'
}));

app.get('/search', async (req, res) => {
  const query = req.query.q;
  const limit = parseInt(req.query.limit) || 10;
  if (!query) return res.status(400).json({ error: 'Query required' });
  console.log(`🔍 Searching: ${query}`);
  try {
    const s = await ytApiGet(`search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${limit}&regionCode=PK`);
    if (!s.items?.length) return res.json({ success: true, results: [] });
    const ids = s.items.map(i => i.id.videoId).join(',');
    const d = await ytApiGet(`videos?part=contentDetails,statistics&id=${ids}`);
    const det = {};
    (d.items||[]).forEach(i => { det[i.id] = { duration: fmtDur(i.contentDetails?.duration), views: fmtViews(i.statistics?.viewCount) }; });
    const results = s.items.map(i => {
      const id = i.id.videoId, sn = i.snippet;
      return { id, title: sn.title||'Unknown', channel: sn.channelTitle||'Unknown', duration: det[id]?.duration||'0:00', views: det[id]?.views||'0', thumbnail: sn.thumbnails?.high?.url||`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, uploadDate: fmtDate(sn.publishedAt), url: `https://www.youtube.com/watch?v=${id}` };
    });
    console.log(`✅ Found ${results.length} results`);
    res.json({ success: true, results });
  } catch(e) { console.error('Search:', e.message); res.status(500).json({ error: 'Search failed' }); }
});

app.get('/trending', async (req, res) => {
  console.log('🔥 Trending...');
  try {
    const t = await ytApiGet(`videos?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=PK&maxResults=15`);
    if (!t.items?.length) return res.json({ success: true, results: [] });
    const results = t.items.map(i => ({
      id: i.id, title: i.snippet?.title||'Unknown', channel: i.snippet?.channelTitle||'Unknown',
      duration: fmtDur(i.contentDetails?.duration), views: fmtViews(i.statistics?.viewCount),
      thumbnail: i.snippet?.thumbnails?.high?.url||`https://i.ytimg.com/vi/${i.id}/hqdefault.jpg`,
      uploadDate: fmtDate(i.snippet?.publishedAt), url: `https://www.youtube.com/watch?v=${i.id}`
    }));
    console.log(`✅ Trending: ${results.length}`);
    res.json({ success: true, results });
  } catch(e) { res.json({ success: true, results: [] }); }
});

app.get('/info', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const cmd = `${YTDLP} ${getFlags()} "${url}" --dump-json`;
  exec(cmd, { maxBuffer: 1024*1024*10, timeout: 30000 }, (err, out) => {
    if (err) return res.status(500).json({ error: 'Info failed' });
    try {
      const d = JSON.parse(out);
      const formats = [], seen = new Set();
      (d.formats||[]).forEach(f => { if (f.height && !seen.has(f.height)) { seen.add(f.height); formats.push({ label: f.height>=2160?'4K':`${f.height}p`, height: f.height, ext: f.ext||'mp4' }); } });
      formats.sort((a,b)=>b.height-a.height);
      formats.push({ label: 'MP3 Audio', height: 0, ext: 'mp3' });
      res.json({ success: true, video: { id: d.id, title: d.title, channel: d.uploader||d.channel, duration: fmtDurSec(d.duration), views: fmtViews(d.view_count), thumbnail: d.thumbnail, formats } });
    } catch(e) { res.status(500).json({ error: 'Parse failed' }); }
  });
});

// ─── DOWNLOAD — Simple format, multiple fallbacks ─────────────
app.get('/download', (req, res) => {
  const { url, quality, type } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  console.log(`⬇️ Download: quality=${quality} type=${type}`);

  const FLAGS = getFlags();

  // Format list — try each one until success
  let formats = [];
  if (type === 'audio') {
    formats = [
      `bestaudio`,
      `worstaudio`,
      `best`,
    ];
  } else {
    const q = (quality && quality !== 'undefined') ? parseInt(quality) : 720;
    formats = [
      `best[height<=${q}]`,
      `best[height<=480]`,
      `best[height<=360]`,
      `best`,
      `worst`,
    ];
  }

  // Try formats one by one
  function tryFormat(index) {
    if (index >= formats.length) {
      return res.status(500).json({ error: 'No format available' });
    }
    const fmt = formats[index];
    const cmd = `${YTDLP} ${FLAGS} -f "${fmt}" --get-url "${url}"`;
    console.log(`Trying format: ${fmt}`);

    exec(cmd, { maxBuffer: 1024*1024*5, timeout: 25000 }, (err, stdout) => {
      if (err) {
        console.log(`Format ${fmt} failed, trying next...`);
        return tryFormat(index + 1);
      }
      const lines = stdout.trim().split('\n').filter(l => l.trim() && l.startsWith('http'));
      if (lines.length === 0) {
        console.log(`Format ${fmt} no URL, trying next...`);
        return tryFormat(index + 1);
      }
      console.log(`✅ Download URL ready with format: ${fmt}`);
      res.json({ success: true, downloadUrl: lines[0] });
    });
  }

  tryFormat(0);
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   NexGenGold Server v3.3 🔥          ║
  ║   Port: ${PORT}                         ║
  ║   Search:   YouTube API ✅           ║
  ║   Download: yt-dlp + auto format ✅  ║
  ╚══════════════════════════════════════╝`);
});
