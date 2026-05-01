require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const Database = require('better-sqlite3');
const OpenAI = require('openai');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    const basename = path.basename(filePath);
    const ext = path.extname(filePath);
    if (basename === 'sw.js' || basename === 'index.html' || ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// 确保 data 目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 初始化 SQLite 数据库
const dbPath = path.join(dataDir, 'claudio.db');
const db = new Database(dbPath);

// 启用 WAL 模式提升性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 创建数据表
db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    song_id TEXT PRIMARY KEY,
    song_name TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT,
    song_name TEXT,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlist_songs (
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT,
    song_name TEXT,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (playlist_id, song_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    song_cards TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playback_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    current_song_id TEXT,
    current_song_name TEXT,
    current_song_artist TEXT,
    current_song_album TEXT,
    current_song_cover TEXT,
    progress_seconds REAL DEFAULT 0,
    queue_song_ids TEXT,
    queue_index INTEGER DEFAULT 0,
    play_mode TEXT DEFAULT 'off',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 插入默认偏好
const upsertPref = db.prepare('INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)');
upsertPref.run('theme', 'dark');
upsertPref.run('volume', '0.8');

// 插入默认播放状态
db.prepare('INSERT OR IGNORE INTO playback_state (id) VALUES (1)').run();

console.log('数据库初始化完成');

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== 收藏 API ==========
app.get('/api/favorites', (req, res) => {
  const rows = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
  res.json(rows);
});

app.post('/api/favorites', (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  db.prepare('INSERT OR REPLACE INTO favorites (song_id, song_name, artist, album, cover_url) VALUES (?, ?, ?, ?, ?)')
    .run(song_id, song_name, artist, album, cover_url);
  res.json({ ok: true });
});

app.delete('/api/favorites/:songId', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE song_id = ?').run(req.params.songId);
  res.json({ ok: true });
});

// ========== 播放历史 API ==========
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = db.prepare('SELECT * FROM play_history ORDER BY played_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.post('/api/history', (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  db.prepare('INSERT INTO play_history (song_id, song_name, artist, album, cover_url) VALUES (?, ?, ?, ?, ?)')
    .run(song_id, song_name, artist, album, cover_url);
  res.json({ ok: true });
});

// ========== 歌单 API ==========
app.get('/api/playlists', (req, res) => {
  const rows = db.prepare(`
    SELECT
      p.*,
      COUNT(ps.song_id) AS song_count,
      COALESCE((
        SELECT ps2.cover_url
        FROM playlist_songs ps2
        WHERE ps2.playlist_id = p.id
          AND ps2.cover_url IS NOT NULL
          AND ps2.cover_url != ''
        ORDER BY ps2.sort_order ASC
        LIMIT 1
      ), '') AS cover_url
    FROM playlists p
    LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
    WHERE p.type != 'daily'
    GROUP BY p.id
    ORDER BY datetime(p.created_at) DESC, p.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/playlists', (req, res) => {
  const { name, type } = req.body;
  const result = db.prepare('INSERT INTO playlists (name, type) VALUES (?, ?)').run(name, type || 'user');
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get('/api/playlists/:id', (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: '歌单不存在' });
  const songs = db.prepare('SELECT * FROM playlist_songs WHERE playlist_id = ? ORDER BY sort_order').all(req.params.id);
  res.json({
    ...playlist,
    song_count: songs.length,
    cover_url: songs.find(song => song.cover_url)?.cover_url || '',
    songs
  });
});

app.post('/api/playlists/:id/songs', (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM playlist_songs WHERE playlist_id = ?').get(req.params.id);
  const order = (maxOrder?.m || 0) + 1;
  db.prepare('INSERT OR REPLACE INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, song_id, song_name, artist, album, cover_url, order);
  res.json({ ok: true });
});

app.delete('/api/playlists/:id', (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ? AND type != 'daily'").get(req.params.id);
  if (!playlist) return res.status(404).json({ error: '歌单不存在' });

  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
});

app.delete('/api/playlists/:id/songs/:songId', (req, res) => {
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?')
    .run(req.params.id, req.params.songId);
  res.json({ ok: true });
});

app.get('/api/netease/sync-meta', (req, res) => {
  const syncPath = path.join(dataDir, 'netease-sync.json');
  if (!fs.existsSync(syncPath)) {
    return res.json({
      exists: false,
      syncedAt: null,
      nickname: '',
      likedPlaylistId: null,
      playlistCount: 0,
      playlists: []
    });
  }

  try {
    const raw = fs.readFileSync(syncPath, 'utf-8');
    const json = JSON.parse(raw);
    res.json({
      exists: true,
      syncedAt: json.syncedAt || null,
      nickname: json.nickname || '',
      likedPlaylistId: json.likedPlaylistId || null,
      playlistCount: Array.isArray(json.playlists) ? json.playlists.length : 0,
      playlists: Array.isArray(json.playlists) ? json.playlists : []
    });
  } catch (error) {
    res.status(500).json({ error: '同步摘要读取失败' });
  }
});

// ========== 偏好 API ==========
app.get('/api/preferences', (req, res) => {
  const rows = db.prepare('SELECT * FROM preferences').all();
  const prefs = {};
  rows.forEach(r => prefs[r.key] = r.value);
  res.json(prefs);
});

app.put('/api/preferences', (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)');
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) {
      stmt.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  });
  tx(req.body);
  res.json({ ok: true });
});

// ========== 播放状态 API ==========
app.get('/api/playback-state', (req, res) => {
  const state = db.prepare('SELECT * FROM playback_state WHERE id = 1').get();
  res.json(state);
});

app.put('/api/playback-state', (req, res) => {
  const { current_song_id, current_song_name, current_song_artist, current_song_album, current_song_cover, progress_seconds, queue_song_ids, queue_index, play_mode } = req.body;
  db.prepare(`UPDATE playback_state SET
    current_song_id=?, current_song_name=?, current_song_artist=?, current_song_album=?, current_song_cover=?,
    progress_seconds=?, queue_song_ids=?, queue_index=?, play_mode=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=1`)
    .run(current_song_id, current_song_name, current_song_artist, current_song_album, current_song_cover,
      progress_seconds, JSON.stringify(queue_song_ids), queue_index, play_mode);
  res.json({ ok: true });
});

// ========== 聊天历史 API ==========
app.get('/api/chat/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const rows = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.reverse());
});

// ========== 配置 API ==========
const configDir = path.join(__dirname, 'config');

app.get('/api/config', (req, res) => {
  const files = ['agent.md', 'taste.md', 'routines.md', 'moodrules.md'];
  const config = {};
  for (const f of files) {
    const fp = path.join(configDir, f);
    config[f.replace('.md', '')] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  }
  res.json(config);
});

app.post('/api/config/:filename', (req, res) => {
  const allowed = ['agent.md', 'taste.md', 'routines.md', 'moodrules.md'];
  if (!allowed.includes(req.params.filename)) return res.status(400).json({ error: '不允许的文件' });
  fs.writeFileSync(path.join(configDir, req.params.filename), req.body.content || '');
  res.json({ ok: true });
});

// ========== 环境变量配置 API ==========
const envPath = path.join(__dirname, '.env');
const MASK = '***已设置***';

function getModelApiKey() {
  return process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
}

function getModelBaseUrl() {
  return process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || '';
}

function getModelName(fallback = 'gpt-5.4') {
  return process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || fallback;
}

function getModelCandidates(preferred = getModelName()) {
  return [...new Set([
    preferred,
    'gpt-5.4',
    'gpt-5.2',
    'gpt-5.3-codex'
  ].filter(Boolean))];
}

function createModelClient() {
  const apiKey = getModelApiKey();
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY（或兼容的 ANTHROPIC_API_KEY）');
  }

  const baseURL = getModelBaseUrl();
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {})
  });
}

function isModelUnavailableError(error) {
  const message = String(error?.message || error?.error || '');
  return error?.status === 400 && /(未配置模型|model.*not.*configured|unsupported.*model|invalid.*model)/i.test(message);
}

async function createResponseWithFallback(client, request, preferredModel = getModelName()) {
  const candidates = getModelCandidates(preferredModel);
  let lastError = null;

  for (const model of candidates) {
    try {
      if (model !== preferredModel) {
        console.warn(`[model-fallback] ${preferredModel} 不可用，回退到 ${model}`);
      }
      return await client.responses.create({ ...request, model });
    } catch (error) {
      lastError = error;
      if (!isModelUnavailableError(error) || model === candidates[candidates.length - 1]) {
        throw error;
      }
    }
  }

  throw lastError || new Error('模型调用失败');
}

function toOpenAIInputMessage(message) {
  const contentType = message.role === 'assistant' ? 'output_text' : 'input_text';
  return {
    role: message.role,
    content: [
      {
        type: contentType,
        text: message.content
      }
    ]
  };
}

function extractResponseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) {
    return response.output_text;
  }

  if (Array.isArray(response?.output)) {
    return response.output
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .map(item => item?.text || '')
      .join('');
  }

  return '';
}

async function getResponseTextWithFallback(client, request, preferredModel = getModelName()) {
  const response = await createResponseWithFallback(client, request, preferredModel);
  return extractResponseText(response);
}

function parseJsonLoose(text, fallback) {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  const cleaned = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

app.get('/api/env-config', (req, res) => {
  res.json({
    OPENAI_BASE_URL: getModelBaseUrl(),
    OPENAI_API_KEY: getModelApiKey() ? MASK : '',
    OPENAI_MODEL: getModelName(),
    NETEASE_API: process.env.NETEASE_API || '',
    NETEASE_COOKIE: process.env.NETEASE_COOKIE ? MASK : ''
  });
});

app.put('/api/env-config', (req, res) => {
  const { OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL, NETEASE_API, NETEASE_COOKIE } = req.body;

  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  const updates = { OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL, NETEASE_API, NETEASE_COOKIE };
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined || val === MASK) continue; // 跳过未修改的敏感字段
    process.env[key] = val;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${val}`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, line);
    } else {
      envContent += (envContent.endsWith('\n') ? '' : '\n') + line + '\n';
    }
  }

  fs.writeFileSync(envPath, envContent);
  res.json({ ok: true });
});

// ========== 网易云 API 代理（避免浏览器 CORS） ==========
const NETEASE_API = process.env.NETEASE_API || 'http://192.168.5.103:3000';
const NETEASE_COOKIE = process.env.NETEASE_COOKIE || '';

// 构建带 cookie 的请求 URL
function neteaseUrl(path, params = {}) {
  const url = new URL(path, NETEASE_API);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  if (NETEASE_COOKIE) url.searchParams.set('cookie', NETEASE_COOKIE);
  return url.toString();
}

// 服务端解析歌曲：AI 返回的歌名 → 网易云真实数据
async function resolveSong(song) {
  try {
    const keyword = `${song.name || ''} ${song.artist || ''}`.trim();
    if (!keyword) return song;
    const r = await fetch(neteaseUrl('/cloudsearch', { keywords: keyword, type: 1, limit: 3 }));
    const data = await r.json();
    const results = data?.result?.songs || [];
    const match = results.find(r => r.name === song.name) || results[0];
    if (!match) return song;
    const cover = match.al?.picUrl || '';
    return { id: String(match.id), name: match.name, artist: (match.ar || []).map(a => a.name).join('/'), album: match.al?.name || '', cover, reason: song.reason || '' };
  } catch { return song; }
}

app.get('/api/netease/search', async (req, res) => {
  try {
    const { keywords, limit = 20 } = req.query;
    const r = await fetch(neteaseUrl('/cloudsearch', { keywords, type: 1, limit }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/song/url', async (req, res) => {
  try {
    const { id, br = 320000 } = req.query;
    const r = await fetch(neteaseUrl('/song/url', { id, br }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/lyric', async (req, res) => {
  try {
    const r = await fetch(neteaseUrl('/lyric', { id: req.query.id }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/personalized', async (req, res) => {
  try {
    const r = await fetch(neteaseUrl('/personalized', { limit: req.query.limit || 10 }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/playlist/detail', async (req, res) => {
  try {
    const r = await fetch(neteaseUrl('/playlist/detail', { id: req.query.id }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Mock 日历 API ==========
app.get('/api/schedule', (req, res) => {
  const fp = path.join(configDir, 'schedule.json');
  if (!fs.existsSync(fp)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
});

app.post('/api/schedule', (req, res) => {
  const fp = path.join(configDir, 'schedule.json');
  fs.writeFileSync(fp, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ========== 配置文件热加载 ==========
let configCache = {};

function loadConfigFiles() {
  const files = ['agent.md', 'taste.md', 'routines.md', 'moodrules.md'];
  for (const f of files) {
    const fp = path.join(configDir, f);
    configCache[f.replace('.md', '')] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  }
}
loadConfigFiles();

// 文件监听热重载
fs.watch(configDir, (event, filename) => {
  if (filename && filename.endsWith('.md')) {
    loadConfigFiles();
    console.log(`配置文件 ${filename} 已重新加载`);
  }
});

function buildSystemPrompt(currentSong, chatHistory) {
  const parts = [];
  if (configCache.agent) parts.push(configCache.agent);
  if (configCache.taste) parts.push(`## 音乐品味\n${configCache.taste}`);
  if (configCache.routines) parts.push(`## 行为习惯\n${configCache.routines}`);
  if (configCache.moodrules) parts.push(`## 情绪规则\n${configCache.moodrules}`);

  const now = new Date();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 周${weekDays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  parts.push(`## 当前时间\n${timeStr}`);

  if (currentSong) {
    parts.push(`## 当前播放\n歌曲：${currentSong.name}，艺术家：${currentSong.artist}，专辑：${currentSong.album || '未知'}`);
  }

  parts.push(`## 回复格式
你必须以 JSON 格式回复，结构如下：
{
  "say": "你对用户说的话",
  "reason": "推荐理由（如果是推荐歌曲）",
  "play": [{"id": "网易云歌曲ID", "name": "歌曲名", "artist": "艺术家", "album": "专辑", "cover": "封面URL"}],
  "segue": "你想用语音说的内容（歌曲赏析、故事等，可以为空）",
  "memory": [{"file": "taste|routines|moodrules", "add": "要追加的一句话"}]
}

## memory 字段规则
- 当你从对话中发现用户的**新偏好、新习惯、新情绪模式**，且这些信息在上方 system prompt 中**没有出现过**，才放入 memory
- 已有的习惯和偏好不要重复写入，只写新的
- file 取值：
  - "taste"：音乐偏好（喜欢的曲风、歌手、歌曲）
  - "routines"：作息习惯（起床时间、工作时段、睡前习惯）
  - "moodrules"：情绪与场景规则（什么心情听什么、特定场景、特定时间段的音乐需求）
- 如果没有新发现，memory 返回空数组 []
- memory 不是每条必返，只有确实有新信息时才返回
只返回 JSON，不要包裹在 markdown 代码块中。`);

  return parts.join('\n\n');
}

// ========== 消息分流 ==========
const simpleCommands = {
  '下一首': () => ({ action: 'next' }),
  '上一首': () => ({ action: 'prev' }),
  '暂停': () => ({ action: 'pause' }),
  '随机播放': () => ({ action: 'shuffle' }),
};

const exactCommands = {
  '播放': () => ({ action: 'play' }),
};

app.post('/api/dispatch', async (req, res) => {
  const { message, currentSong } = req.body;

  // 精确指令检测
  if (exactCommands[message]) {
    return res.json({ type: 'command', ...exactCommands[message]() });
  }

  // 包含式指令检测
  for (const [keyword, handler] of Object.entries(simpleCommands)) {
    if (message.includes(keyword)) {
      return res.json({ type: 'command', ...handler() });
    }
  }

  // 音乐搜索检测
  if (message.startsWith('搜索') || (message.startsWith('播放') && message.length > 2)) {
    const keyword = message.replace(/^(搜索|播放)/, '').trim();
    if (keyword) {
      return res.json({ type: 'music_search', keyword });
    }
  }

  // 默认走 Codex / OpenAI
  try {
    const client = createModelClient();

    // 获取聊天历史
    const history = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 20').all().reverse();

    const messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));
    messages.push({ role: 'user', content: message });

    const systemPrompt = buildSystemPrompt(currentSong, history);

    let fullContent = '';
    const stream = await createResponseWithFallback(client, {
      input: messages.map(toOpenAIInputMessage),
      instructions: systemPrompt,
      max_output_tokens: 4096,
      stream: true
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        fullContent += event.delta;
        res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta })}\n\n`);
      }

      if (event.type === 'error') {
        throw new Error(event.error?.message || event.message || 'OpenAI 流式响应失败');
      }
    }

    db.prepare('INSERT INTO chat_messages (role, content) VALUES (?, ?)').run('user', message);

    let parsed = parseJsonLoose(fullContent, null);
    if (!parsed) {
      parsed = { say: fullContent, reason: '', play: [], segue: '', memory: [] };
    }

    if (Array.isArray(parsed.memory) && parsed.memory.length > 0) {
      console.log(`[memory] AI 返回记忆:`, JSON.stringify(parsed.memory));
      const allowed = { taste: 'taste.md', routines: 'routines.md', moodrules: 'moodrules.md' };
      for (const m of parsed.memory) {
        if (m.file && m.add && allowed[m.file]) {
          const fp = path.join(__dirname, 'config', allowed[m.file]);
          fs.appendFileSync(fp, `\n- ${m.add.trim()}`, 'utf-8');
          console.log(`[memory] 写入 ${allowed[m.file]}: ${m.add.trim()}`);
        }
      }
      loadConfigFiles();
    }

    const rawSongs = parsed.play || [];
    const songCards = rawSongs.length > 0
      ? await Promise.all(rawSongs.map(s => resolveSong(s)))
      : [];

    db.prepare('INSERT INTO chat_messages (role, content, song_cards) VALUES (?, ?, ?)')
      .run('assistant', fullContent, JSON.stringify(songCards));

    res.write(`data: ${JSON.stringify({ type: 'done', parsed, songCards })}\n\n`);
    res.end();

  } catch (err) {
    console.error('Codex/OpenAI API 错误:', err);
    res.status(500).json({ type: 'error', message: err.message });
  }
});

// ========== 定时任务 ==========
let schedulerStatus = {
  dailyPlaylist: { lastRun: null, status: 'idle', lastError: null },
  moodCheck: { lastRun: null, status: 'idle', lastError: null }
};

function mapPlaylistSongRow(row) {
  return {
    id: String(row?.song_id || row?.id || ''),
    name: row?.song_name || row?.name || '',
    artist: row?.artist || '',
    album: row?.album || '',
    cover: row?.cover_url || row?.cover || ''
  };
}

function getLatestDailyPlaylistRecord() {
  const playlist = db.prepare("SELECT * FROM playlists WHERE type = 'daily' ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get();
  if (!playlist) return null;
  const songs = db.prepare('SELECT * FROM playlist_songs WHERE playlist_id = ? ORDER BY sort_order').all(playlist.id);
  return {
    ...playlist,
    songs: songs.map(mapPlaylistSongRow)
  };
}

function getCurrentMoodRecord() {
  const mood = db.prepare("SELECT value FROM preferences WHERE key = 'current_mood'").get();
  if (!mood?.value) return null;
  try {
    return JSON.parse(mood.value);
  } catch {
    return null;
  }
}

function isSameLocalDay(a, b = new Date()) {
  const ad = new Date(a);
  return ad.getFullYear() === b.getFullYear()
    && ad.getMonth() === b.getMonth()
    && ad.getDate() === b.getDate();
}

function isMoodFresh(moodData, now = Date.now()) {
  if (!moodData?.generated_at) return false;
  const generatedAt = new Date(moodData.generated_at).getTime();
  if (!Number.isFinite(generatedAt)) return false;
  return now - generatedAt < 60 * 60 * 1000;
}

function getRecentReferenceSongs(limit = 120) {
  const history = db.prepare('SELECT song_id, song_name, artist, album, cover_url FROM play_history ORDER BY played_at DESC LIMIT ?').all(limit);
  const favorites = db.prepare('SELECT song_id, song_name, artist, album, cover_url FROM favorites ORDER BY added_at DESC LIMIT ?').all(limit);
  const merged = [...history, ...favorites];
  const seen = new Set();
  const songs = [];

  for (const row of merged) {
    const song = mapPlaylistSongRow(row);
    if (!song.name) continue;
    const key = song.id || `${song.name}::${song.artist}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(song);
  }

  return songs;
}

function getRecentlyPlayedSongIds(limit = 30) {
  const rows = db.prepare("SELECT song_id FROM play_history WHERE song_id IS NOT NULL AND song_id != '' ORDER BY played_at DESC LIMIT ?").all(limit);
  return new Set(rows.map((row) => String(row.song_id)));
}

function makeSongIdentity(song) {
  const name = String(song?.name || song?.song_name || '').trim().toLowerCase();
  const artist = String(song?.artist || '').trim().toLowerCase();
  return name && artist ? `${name}::${artist}` : '';
}

function getRecentlyPlayedSongKeys(limit = 40) {
  const rows = db.prepare('SELECT song_name, artist FROM play_history ORDER BY played_at DESC LIMIT ?').all(limit);
  const keys = new Set();
  for (const row of rows) {
    const key = makeSongIdentity({ name: row.song_name, artist: row.artist });
    if (key) keys.add(key);
  }
  return keys;
}

function buildTasteSummary() {
  const recent = db.prepare('SELECT song_name, artist FROM play_history ORDER BY played_at DESC LIMIT 12').all();
  const favorites = db.prepare('SELECT song_name, artist FROM favorites ORDER BY added_at DESC LIMIT 20').all();

  const artistCount = new Map();
  const recentPairs = [];

  for (const row of [...recent, ...favorites]) {
    if (row.artist) {
      const artists = String(row.artist).split('/').map((item) => item.trim()).filter(Boolean);
      for (const artist of artists) {
        artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
      }
    }
    if (row.song_name && row.artist && recentPairs.length < 8) {
      recentPairs.push(`${row.song_name} - ${row.artist}`);
    }
  }

  const topArtists = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([artist]) => artist);

  return {
    topArtists,
    recentPairs
  };
}

function readScheduleConfig() {
  const fp = path.join(configDir, 'schedule.json');
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function buildFallbackMood(now = new Date()) {
  const schedule = readScheduleConfig()
    .map((item) => {
      const [hour = '0', minute = '0'] = String(item.time || '0:0').split(':');
      return {
        ...item,
        minutes: Number(hour) * 60 + Number(minute)
      };
    })
    .filter((item) => Number.isFinite(item.minutes))
    .sort((a, b) => a.minutes - b.minutes);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let active = schedule.filter((item) => item.minutes <= currentMinutes).pop() || schedule[0] || null;

  if (!active) {
    active = {
      event: '此刻',
      mood: now.getHours() >= 22 || now.getHours() < 6 ? 'calm' : now.getHours() < 12 ? 'focus' : 'chill'
    };
  }

  const genreByMood = {
    energetic: '活力流行 / 电子',
    focus: '器乐 / 氛围 / 后摇',
    relax: '轻松爵士 / 独立流行',
    chill: '城市流行 / R&B',
    calm: '钢琴 / 民谣 / 氛围'
  };

  return {
    mood: active.mood || 'chill',
    genre: genreByMood[active.mood] || '轻松流行',
    message: active.event ? `现在更适合 ${active.event} 的氛围，电台会偏向 ${active.mood || 'chill'} 的听感。` : '电台会保持柔和、顺耳的流动感。',
    generated_at: now.toISOString(),
    source: 'fallback'
  };
}

function scoreSongForMood(song, moodData) {
  const text = `${song.name} ${song.artist} ${song.album}`.toLowerCase();
  const mood = String(moodData?.mood || '').toLowerCase();
  const genre = String(moodData?.genre || '').toLowerCase();

  const keywordsByMood = {
    energetic: ['run', 'dance', 'power', '燃', '热血', '快乐', '夏', 'party', 'light', 'jump'],
    focus: ['piano', 'instrument', '纯音乐', '钢琴', 'light', 'night', '雨', '静', 'study', 'moon'],
    relax: ['lazy', 'jazz', '蓝调', '轻松', '午后', 'coffee', '风', 'sunset', '暖'],
    chill: ['city', 'love', '夜', '路', '街', '心', '情歌', '通勤', 'story', 'slow'],
    calm: ['sleep', 'dream', '晚安', '海', '星', 'moon', 'quiet', 'soft', '民谣', 'acoustic']
  };

  let score = 0;
  for (const keyword of keywordsByMood[mood] || []) {
    if (text.includes(keyword)) score += 3;
    if (genre.includes(keyword)) score += 1;
  }

  if (genre && text.includes(genre.replace(/\s*\/\s*/g, ' '))) score += 4;
  return score;
}

function scoreSongForTaste(song, tasteSummary) {
  const text = `${song.name} ${song.artist} ${song.album}`.toLowerCase();
  let score = 0;

  for (const artist of tasteSummary?.topArtists || []) {
    if (text.includes(String(artist).toLowerCase())) score += 4;
  }

  for (const sample of tasteSummary?.recentPairs || []) {
    const parts = String(sample).toLowerCase().split(' - ');
    if (parts[0] && text.includes(parts[0])) score += 1;
    if (parts[1] && text.includes(parts[1])) score += 2;
  }

  return score;
}

function filterBlockedSongs(songs, blockedIds, blockedKeys) {
  return songs.filter((song) => {
    const songId = String(song.id || '');
    const songKey = makeSongIdentity(song);
    if (songId && blockedIds.has(songId)) return false;
    if (songKey && blockedKeys.has(songKey)) return false;
    return !!song.name;
  });
}

async function searchMoodCandidateSongs(moodData, tasteSummary, blockedIds, blockedKeys) {
  const mood = String(moodData?.mood || '').trim();
  const genre = String(moodData?.genre || '').trim();
  const artistHints = (tasteSummary?.topArtists || []).slice(0, 3);
  const keywordSeeds = [
    `${genre} 华语`,
    `${mood} 华语`,
    `${genre} 通勤`,
    `${mood} 夜晚`
  ];

  for (const artist of artistHints) {
    keywordSeeds.push(`${genre} ${artist}`);
    keywordSeeds.push(`${mood} ${artist}`);
  }

  const keywords = [...new Set(keywordSeeds.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const seen = new Set();
  const candidates = [];

  for (const keyword of keywords) {
    try {
      const response = await fetch(neteaseUrl('/cloudsearch', { keywords: keyword, type: 1, limit: 12 }));
      const data = await response.json();
      const results = data?.result?.songs || [];

      for (const item of results) {
        const song = {
          id: String(item.id),
          name: item.name,
          artist: (item.ar || []).map((artist) => artist.name).join('/'),
          album: item.al?.name || '',
          cover: item.al?.picUrl || ''
        };
        const uniqueKey = song.id || makeSongIdentity(song);
        if (!uniqueKey || seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);
        candidates.push(song);
      }
    } catch (error) {
      console.warn('[scheduler] 网易云候选搜索失败:', keyword, error.message);
    }
  }

  return filterBlockedSongs(candidates, blockedIds, blockedKeys)
    .map((song, index) => ({
      song,
      index,
      score: scoreSongForMood(song, moodData) + scoreSongForTaste(song, tasteSummary)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.song);
}

function buildFallbackDailySongs(moodData, tasteSummary, blockedIds, blockedKeys) {
  const songs = getRecentReferenceSongs(180);
  if (songs.length === 0) return [];

  const ranked = filterBlockedSongs(songs, blockedIds, blockedKeys)
    .map((song, index) => ({
      song,
      index,
      score: scoreSongForMood(song, moodData) + scoreSongForTaste(song, tasteSummary)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  const selected = [];
  const seenArtists = new Set();

  for (const item of ranked) {
    const artistKey = item.song.artist || '';
    if (seenArtists.has(artistKey) && selected.length < 6) continue;
    selected.push(item.song);
    seenArtists.add(artistKey);
    if (selected.length >= 10) break;
  }

  return selected;
}

async function generateDailyPlaylist(options = {}) {
  const { force = false, trigger = 'manual' } = options;
  const existing = getLatestDailyPlaylistRecord();
  if (!force && existing && isSameLocalDay(existing.created_at)) {
    return existing;
  }

  console.log(`[scheduler] 执行每日歌单推荐 (${trigger})...`);
  schedulerStatus.dailyPlaylist.status = 'running';
  schedulerStatus.dailyPlaylist.lastError = null;

  try {
    let songs = [];
    const history = db.prepare('SELECT * FROM play_history ORDER BY played_at DESC LIMIT 50').all();
    const moodData = await generateMoodCheck({ force: false, trigger: `playlist-${trigger}` });
    const tasteSummary = buildTasteSummary();
    const blockedIds = getRecentlyPlayedSongIds(25);
    const blockedKeys = getRecentlyPlayedSongKeys(40);
    const candidateSongs = await searchMoodCandidateSongs(moodData, tasteSummary, blockedIds, blockedKeys);

    try {
      const client = createModelClient();
      const prompt = `根据以下信息，推荐今日歌单（10首歌），返回 JSON 格式：
[{"id": "网易云歌曲ID", "name": "歌名", "artist": "艺术家", "album": "专辑", "cover": "封面URL"}]

当前电台情绪：${moodData?.mood || 'chill'}
推荐曲风：${moodData?.genre || '轻松流行'}
情绪说明：${moodData?.message || ''}
${configCache.taste ? '品味偏好：' + configCache.taste : ''}
偏好艺人摘要：${tasteSummary.topArtists.join('、') || '暂无'}
最近偏好样本：${tasteSummary.recentPairs.join('；') || '暂无'}
今天/刚刚听过，尽量不要重复推荐这些 song_id：${[...blockedIds].join(', ') || '无'}
今天/刚刚听过，尽量不要重复这些歌曲：${[...blockedKeys].slice(0, 12).join('；') || '无'}
最近听歌记录（只做参考，不要机械重复）：${history.map(h => h.song_name + ' - ' + h.artist).join(', ')}
网易云候选池（优先从这里挑，避免瞎编 song_id）：${candidateSongs.slice(0, 20).map((song) => `${song.id}|${song.name}|${song.artist}|${song.album}`).join('；') || '暂无'}

要求：
1. 优先符合当前情绪和曲风
2. 尽量避开刚刚听过的歌
3. 如果要推荐熟悉艺人，也尽量换不同歌曲
4. 不要只复读最近播放记录
5. 优先从候选池里选歌；如果不用候选池，也必须返回真实可解析的网易云 song_id`;

      const content = await getResponseTextWithFallback(client, {
        max_output_tokens: 1024,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }]
      });
      const parsedSongs = parseJsonLoose(content, []);
      if (Array.isArray(parsedSongs) && parsedSongs.length > 0) {
        songs = (await Promise.all(parsedSongs.map((song) => resolveSong(song))))
          .map(mapPlaylistSongRow)
          .filter((song) => song.id && song.name);
        songs = filterBlockedSongs(songs, blockedIds, blockedKeys);
      }
    } catch (modelError) {
      console.warn('[scheduler] 今日歌单 AI 生成失败，改用本地回退:', modelError.message);
    }

    if (songs.length === 0) {
      songs = candidateSongs.slice(0, 10);
    }

    if (songs.length === 0) {
      songs = buildFallbackDailySongs(moodData, tasteSummary, blockedIds, blockedKeys);
    }

    if (songs.length === 0) {
      throw new Error('没有足够的听歌记录或收藏，暂时无法生成今日推荐');
    }

    const result = db.prepare('INSERT INTO playlists (name, type) VALUES (?, ?)').run('今日推荐', 'daily');
    const playlistId = result.lastInsertRowid;
    const stmt = db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
    songs.forEach((song, index) => {
      stmt.run(playlistId, song.id, song.name, song.artist, song.album || '', song.cover || '', index);
    });

    const payload = {
      id: playlistId,
      name: '今日推荐',
      type: 'daily',
      created_at: new Date().toISOString(),
      songs
    };

    schedulerStatus.dailyPlaylist.lastRun = new Date().toISOString();
    schedulerStatus.dailyPlaylist.status = 'idle';
    console.log(`[scheduler] 每日歌单推荐完成，共 ${songs.length} 首`);
    return payload;
  } catch (err) {
    console.error('每日歌单推荐失败:', err);
    schedulerStatus.dailyPlaylist.status = 'error';
    schedulerStatus.dailyPlaylist.lastError = err.message;
    throw err;
  }
}

async function generateMoodCheck(options = {}) {
  const { force = false, trigger = 'manual' } = options;
  const existing = getCurrentMoodRecord();
  if (!force && existing && isMoodFresh(existing)) {
    return existing;
  }

  console.log(`[scheduler] 执行情绪检查 (${trigger})...`);
  schedulerStatus.moodCheck.status = 'running';
  schedulerStatus.moodCheck.lastError = null;

  try {
    const now = new Date();
    let moodData = null;

    try {
      const client = createModelClient();
      const hour = now.getHours();
      const recentChats = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 10').all();

      const prompt = `当前时间：${hour}:00
${configCache.moodrules ? '情绪规则：' + configCache.moodrules : ''}
最近聊天：${recentChats.map(c => c.content).join('\n')}

判断当前电台情绪，返回 JSON：
{"mood": "情绪标签", "genre": "推荐曲风", "message": "一句话描述"}`;

      const content = await getResponseTextWithFallback(client, {
        max_output_tokens: 256,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }]
      });
      const parsed = parseJsonLoose(content, {});
      if (parsed?.mood) {
        moodData = {
          mood: parsed.mood,
          genre: parsed.genre || '',
          message: parsed.message || '',
          generated_at: now.toISOString(),
          source: 'ai'
        };
      }
    } catch (modelError) {
      console.warn('[scheduler] 情绪检查 AI 生成失败，改用本地回退:', modelError.message);
    }

    if (!moodData?.mood) {
      moodData = buildFallbackMood(now);
    }

    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('current_mood', JSON.stringify(moodData));

    schedulerStatus.moodCheck.lastRun = new Date().toISOString();
    schedulerStatus.moodCheck.status = 'idle';
    console.log('[scheduler] 情绪检查完成:', moodData.mood);
    return moodData;
  } catch (err) {
    console.error('情绪检查失败:', err);
    schedulerStatus.moodCheck.status = 'error';
    schedulerStatus.moodCheck.lastError = err.message;
    throw err;
  }
}

// 每日歌单推荐（每天 07:00）
cron.schedule('0 7 * * *', async () => {
  try {
    await generateDailyPlaylist({ force: true, trigger: 'cron' });
  } catch {}
});

// 每小时情绪检查
cron.schedule('0 * * * *', async () => {
  try {
    await generateMoodCheck({ force: true, trigger: 'cron' });
  } catch {}
});

// ========== 定时任务 API ==========
app.get('/api/scheduler/status', (req, res) => {
  res.json(schedulerStatus);
});

app.get('/api/scheduler/daily-playlist', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1';
    const payload = refresh
      ? await generateDailyPlaylist({ force: true, trigger: 'request-refresh' })
      : await generateDailyPlaylist({ force: false, trigger: 'request' });
    res.json(payload || null);
  } catch (err) {
    res.status(500).json({ error: err.message || '今日推荐生成失败' });
  }
});

app.get('/api/scheduler/mood', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1';
    const payload = refresh
      ? await generateMoodCheck({ force: true, trigger: 'request-refresh' })
      : await generateMoodCheck({ force: false, trigger: 'request' });
    res.json(payload || null);
  } catch (err) {
    res.status(500).json({ error: err.message || '情绪检测失败' });
  }
});

app.post('/api/scheduler/trigger/:task', async (req, res) => {
  try {
    const task = String(req.params.task || '').toLowerCase();
    if (task === 'daily' || task === 'daily-playlist') {
      const playlist = await generateDailyPlaylist({ force: true, trigger: 'manual-trigger' });
      return res.json({ ok: true, task, playlist });
    }
    if (task === 'mood' || task === 'mood-check') {
      const mood = await generateMoodCheck({ force: true, trigger: 'manual-trigger' });
      return res.json({ ok: true, task, mood });
    }
    if (task === 'all') {
      const [playlist, mood] = await Promise.all([
        generateDailyPlaylist({ force: true, trigger: 'manual-trigger-all' }),
        generateMoodCheck({ force: true, trigger: 'manual-trigger-all' })
      ]);
      return res.json({ ok: true, task, playlist, mood });
    }
    return res.status(400).json({ error: '未知任务，只支持 daily-playlist / mood / all' });
  } catch (err) {
    res.status(500).json({ error: err.message || '任务触发失败' });
  }
});

const https = require('https');

const certDir = path.join(__dirname, 'certs');
const hasCerts = fs.existsSync(path.join(certDir, 'cert.pem'));

if (hasCerts) {
  const server = https.createServer({
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    key: fs.readFileSync(path.join(certDir, 'key.pem'))
  }, app);
  server.listen(PORT, () => {
    console.log(`Claudio FM 服务已启动: https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Claudio FM 服务已启动: http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
