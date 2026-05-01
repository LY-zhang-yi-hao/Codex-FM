// public/js/panels.js — 头像弹出面板逻辑
import { server } from './api.js';

function favToSong(s) {
  return { id: s.song_id, name: s.song_name, artist: s.artist, album: s.album || '', cover: s.cover_url || '' };
}

function playlistSongToSong(s) {
  return { id: s.song_id, name: s.song_name, artist: s.artist, album: s.album || '', cover: s.cover_url || '' };
}

function cleanPlaylistName(name = '') {
  return name.replace(/^\[NCM\]\s*/u, '').trim();
}

function formatSyncTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function setLoading(el, text = '加载中...') {
  el.innerHTML = `<p class="panel-empty">${text}</p>`;
}

async function loadFavorites() {
  try {
    const favs = await server.get('/api/favorites');
    document.getElementById('favoritesList').innerHTML = favs.length === 0
      ? '<p class="panel-empty">还没有收藏歌曲</p>'
      : favs.map((s, i) => `
        <div class="panel-song">
          ${s.cover_url && s.cover_url.startsWith('http')
            ? `<img class="panel-song-cover" src="${s.cover_url}" alt="" onerror="this.style.display='none'">`
            : '<div class="panel-song-cover" style="background:rgba(255,255,255,0.06)"></div>'}
          <div class="panel-song-info">
            <div class="panel-song-name">${s.song_name}</div>
            <div class="panel-song-artist">${s.artist}</div>
          </div>
          <button class="panel-song-play" data-index="${i}" title="播放">▶</button>
          <button class="panel-song-add" data-song='${JSON.stringify(favToSong(s))}' title="加入队列">+</button>
          <button class="panel-song-del" data-id="${s.song_id}" title="取消收藏">✕</button>
        </div>
      `).join('');

    // 绑定按钮 — 播放时追加到现有队列，不替换
    const allSongs = favs.map(favToSong);
    document.querySelectorAll('.panel-song-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const song = allSongs[idx];
        window.player?.addToQueue?.([song]);
        window.player?.playSong?.(song);
        window.player?.addToQueue?.(allSongs);
        window.showToast(`正在播放：${song.name}`);
      });
    });
    document.querySelectorAll('.panel-song-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const song = JSON.parse(btn.dataset.song);
        window.player?.addToQueue?.([song]);
        window.showToast(`已加入队列：${song.name}`);
      });
    });
    document.querySelectorAll('.panel-song-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await server.del(`/api/favorites/${btn.dataset.id}`);
        window.showToast('已取消收藏');
        loadFavorites();
      });
    });
  } catch (e) {
    document.getElementById('favoritesList').textContent = '加载失败';
  }
}

// DJ 头像 → 电台信息面板
document.getElementById('djAvatar').addEventListener('click', async () => {
  document.getElementById('djPanel').style.display = 'flex';

  try {
    const prefs = await server.get('/api/preferences');
    const profile = prefs.taste_profile ? JSON.parse(prefs.taste_profile) : null;
    document.getElementById('tasteProfile').innerHTML = profile
      ? `<p>${profile.description || '品味画像生成中...'}</p>`
      : '<p style="color:var(--text-muted)">品味画像将在每天早上 7 点自动生成</p>';
  } catch (e) {
    document.getElementById('tasteProfile').textContent = '加载失败';
  }
});

// 用户面板入口（header 按钮 + 消息头像）
function openUserPanel() {
  document.getElementById('userPanel').style.display = 'flex';
  loadFavorites();
  loadHistory();
}

async function loadHistory() {
  try {
    const rows = await server.get('/api/history?limit=50');
    // 按 song_id 去重，只保留最新一条
    const seen = new Set();
    const unique = rows.filter(r => {
      if (seen.has(r.song_id)) return false;
      seen.add(r.song_id);
      return true;
    });

    document.getElementById('historyList').innerHTML = unique.length === 0
      ? '<p class="panel-empty">还没有播放记录</p>'
      : unique.map(s => {
          const t = formatPlayedAt(s.played_at);
          return `
          <div class="panel-song">
            ${s.cover_url && s.cover_url.startsWith('http')
              ? `<img class="panel-song-cover" src="${s.cover_url}" alt="" onerror="this.style.display='none'">`
              : '<div class="panel-song-cover" style="background:rgba(255,255,255,0.06)"></div>'}
            <div class="panel-song-info">
              <div class="panel-song-name">${s.song_name}</div>
              <div class="panel-song-artist">${s.artist}</div>
            </div>
            <span class="panel-song-time">${t}</span>
            <button class="panel-song-play" data-song='${JSON.stringify(favToSong(s))}' title="播放">▶</button>
          </div>`;
        }).join('');

    document.querySelectorAll('#historyList .panel-song-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const song = JSON.parse(btn.dataset.song);
        window.player?.playSong?.(song);
        window.player?.addToQueue?.([song]);
        window.showToast(`正在播放：${song.name}`);
      });
    });
  } catch (e) {
    document.getElementById('historyList').textContent = '加载失败';
  }
}

const playlistPanel = document.getElementById('playlistPanel');
const playlistPanelTitle = document.getElementById('playlistPanelTitle');
const playlistPanelSummary = document.getElementById('playlistPanelSummary');
const playlistPanelContent = document.getElementById('playlistPanelContent');
const playlistPanelActions = document.getElementById('playlistPanelActions');
const playlistPanelBack = document.getElementById('playlistPanelBack');
const playlistPlayAllBtn = document.getElementById('playlistPlayAllBtn');
const playlistAddAllBtn = document.getElementById('playlistAddAllBtn');
const playlistFab = document.getElementById('playlistFab');

let playlistList = [];
let playlistSyncMeta = null;
let activePlaylist = null;
const playlistDetailCache = new Map();

function openPlaylistPanel() {
  playlistPanel.style.display = 'flex';
  renderPlaylistHome();
}

function closePlaylistDetail() {
  activePlaylist = null;
  playlistPanelBack.classList.add('is-hidden');
  playlistPanelActions.classList.add('is-hidden');
}

async function renderPlaylistHome() {
  closePlaylistDetail();
  playlistPanelTitle.textContent = '我的歌单';
  playlistPanelSummary.textContent = '正在读取网易云歌单...';
  setLoading(playlistPanelContent);

  try {
    const [playlists, syncMeta] = await Promise.all([
      server.get('/api/playlists'),
      server.get('/api/netease/sync-meta')
    ]);
    playlistList = Array.isArray(playlists) ? playlists : [];
    playlistSyncMeta = syncMeta || null;

    const summaryPieces = [];
    if (playlistSyncMeta?.nickname) summaryPieces.push(playlistSyncMeta.nickname);
    summaryPieces.push(`${playlistList.length} 个歌单`);
    if (playlistSyncMeta?.syncedAt) summaryPieces.push(`${formatSyncTime(playlistSyncMeta.syncedAt)} 同步`);
    playlistPanelSummary.textContent = summaryPieces.join(' · ');

    if (playlistList.length === 0) {
      playlistPanelContent.innerHTML = '<p class="panel-empty">当前还没有同步进来的歌单</p>';
      return;
    }

    playlistPanelContent.innerHTML = `
      <div class="playlist-list">
        ${playlistList.map((playlist) => `
          <div class="panel-song playlist-row" data-playlist-id="${playlist.id}">
            ${playlist.cover_url && playlist.cover_url.startsWith('http')
              ? `<img class="panel-song-cover playlist-row-cover" src="${playlist.cover_url}" alt="" onerror="this.style.display='none'">`
              : '<div class="panel-song-cover playlist-row-cover" style="background:rgba(255,255,255,0.06)"></div>'}
            <div class="panel-song-info">
              <div class="panel-song-name">${cleanPlaylistName(playlist.name)}</div>
              <div class="panel-song-artist">${playlist.song_count || 0} 首 · ${playlist.type === 'netease' ? '网易云同步' : '本地歌单'}</div>
              ${playlistSyncMeta?.likedPlaylistId && cleanPlaylistName(playlist.name).includes('喜欢的音乐')
                ? '<div class="playlist-row-badge">喜欢的音乐</div>'
                : ''}
            </div>
            <button class="panel-song-play playlist-row-play" data-playlist-id="${playlist.id}" title="播放整个歌单">▶</button>
            <div class="playlist-open-hint">›</div>
          </div>
        `).join('')}
      </div>
    `;

    playlistPanelContent.querySelectorAll('.playlist-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('.playlist-row-play')) return;
        const playlistId = Number(row.dataset.playlistId);
        openPlaylistDetail(playlistId);
      });
    });

    playlistPanelContent.querySelectorAll('.playlist-row-play').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const playlistId = Number(btn.dataset.playlistId);
        const detail = await loadPlaylistDetail(playlistId);
        if (!detail?.songs?.length) {
          window.showToast('这个歌单还没有歌曲');
          return;
        }
        const songs = detail.songs.map(playlistSongToSong);
        window.player?.setQueue?.(songs, 0);
        window.player?.playSong?.(songs[0]);
        window.showToast(`开始播放：${cleanPlaylistName(detail.name)}`);
      });
    });
  } catch (error) {
    playlistPanelSummary.textContent = '读取失败';
    playlistPanelContent.innerHTML = '<p class="panel-empty">歌单加载失败，请稍后重试</p>';
  }
}

async function loadPlaylistDetail(playlistId) {
  if (playlistDetailCache.has(playlistId)) return playlistDetailCache.get(playlistId);
  const detail = await server.get(`/api/playlists/${playlistId}`);
  playlistDetailCache.set(playlistId, detail);
  return detail;
}

async function openPlaylistDetail(playlistId) {
  const base = playlistList.find((item) => Number(item.id) === Number(playlistId));
  playlistPanelBack.classList.remove('is-hidden');
  playlistPanelActions.classList.add('is-hidden');
  playlistPanelTitle.textContent = base ? cleanPlaylistName(base.name) : '歌单详情';
  playlistPanelSummary.textContent = '正在读取歌单歌曲...';
  setLoading(playlistPanelContent);

  try {
    const detail = await loadPlaylistDetail(playlistId);
    activePlaylist = detail;
    const songs = Array.isArray(detail.songs) ? detail.songs : [];
    playlistPanelTitle.textContent = cleanPlaylistName(detail.name);
    playlistPanelSummary.textContent = `${songs.length} 首歌${playlistSyncMeta?.nickname ? ` · ${playlistSyncMeta.nickname}` : ''}`;
    playlistPanelActions.classList.toggle('is-hidden', songs.length === 0);

    if (songs.length === 0) {
      playlistPanelContent.innerHTML = '<p class="panel-empty">这个歌单还没有歌曲</p>';
      return;
    }

    playlistPanelContent.innerHTML = songs.map((song, index) => `
      <div class="panel-song">
        ${song.cover_url && song.cover_url.startsWith('http')
          ? `<img class="panel-song-cover" src="${song.cover_url}" alt="" onerror="this.style.display='none'">`
          : '<div class="panel-song-cover" style="background:rgba(255,255,255,0.06)"></div>'}
        <div class="panel-song-info">
          <div class="panel-song-name">${song.song_name}</div>
          <div class="panel-song-artist">${song.artist}</div>
        </div>
        <span class="panel-song-time">${index + 1}</span>
        <button class="panel-song-play" data-song-index="${index}" title="播放">▶</button>
        <button class="panel-song-add" data-song-index="${index}" title="加入队列">+</button>
      </div>
    `).join('');

    playlistPanelContent.querySelectorAll('.panel-song-play').forEach((btn) => {
      btn.addEventListener('click', () => {
        const songIndex = Number(btn.dataset.songIndex);
        const normalizedSongs = songs.map(playlistSongToSong);
        window.player?.setQueue?.(normalizedSongs, songIndex);
        window.player?.playSong?.(normalizedSongs[songIndex]);
        window.showToast(`正在播放：${normalizedSongs[songIndex].name}`);
      });
    });

    playlistPanelContent.querySelectorAll('.panel-song-add').forEach((btn) => {
      btn.addEventListener('click', () => {
        const songIndex = Number(btn.dataset.songIndex);
        const song = playlistSongToSong(songs[songIndex]);
        window.player?.addToQueue?.([song]);
        window.showToast(`已加入队列：${song.name}`);
      });
    });
  } catch (error) {
    playlistPanelSummary.textContent = '读取失败';
    playlistPanelContent.innerHTML = '<p class="panel-empty">歌单详情加载失败，请稍后重试</p>';
  }
}

function formatPlayedAt(dateStr) {
  const sh = { timeZone: 'Asia/Shanghai' };
  const opts = { ...sh, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };

  // SQLite CURRENT_TIMESTAMP 是 UTC，补 Z 强制按 UTC 解析
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  const dateStr_sh = d.toLocaleDateString('en-US', { ...sh, year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayStr_sh = new Date().toLocaleDateString('en-US', { ...sh, year: 'numeric', month: '2-digit', day: '2-digit' });
  const isToday = dateStr_sh === todayStr_sh;

  const timeStr = d.toLocaleString('en-US', opts);
  // en-US 格式: "04/25/2026, 09:22"
  const match = timeStr.match(/(\d{2}):(\d{2})/);
  const hh = match ? match[1] : '00';
  const mm = match ? match[2] : '00';

  if (isToday) return `${hh}:${mm}`;
  const dateMatch = timeStr.match(/(\d{2})\/(\d{2})\/\d{4}/);
  const month = dateMatch ? Number(dateMatch[1]) : '';
  const day = dateMatch ? Number(dateMatch[2]) : '';
  return `${month}/${day} ${hh}:${mm}`;
}

document.getElementById('userAvatar').addEventListener('click', openUserPanel);
playlistFab?.addEventListener('click', openPlaylistPanel);
playlistPanelBack?.addEventListener('click', renderPlaylistHome);

playlistPlayAllBtn?.addEventListener('click', () => {
  if (!activePlaylist?.songs?.length) return;
  const songs = activePlaylist.songs.map(playlistSongToSong);
  window.player?.setQueue?.(songs, 0);
  window.player?.playSong?.(songs[0]);
  window.showToast(`开始播放：${cleanPlaylistName(activePlaylist.name)}`);
});

playlistAddAllBtn?.addEventListener('click', () => {
  if (!activePlaylist?.songs?.length) return;
  const songs = activePlaylist.songs.map(playlistSongToSong);
  window.player?.addToQueue?.(songs);
  window.showToast(`已加入队列：${songs.length} 首`);
});

// 聊天消息中点击用户头像也打开面板
document.getElementById('chatMessages')?.addEventListener('click', (e) => {
  const avatar = e.target.closest('.msg.user .msg-avatar');
  if (avatar) openUserPanel();
});

// 点击遮罩关闭
document.querySelectorAll('.panel-overlay').forEach(panel => {
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.style.display = 'none';
  });
});
