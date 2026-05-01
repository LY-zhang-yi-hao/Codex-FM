// public/js/app.js
import { restorePlayback, getAudioElement, showPlayerView } from './player.js?v=player-init-fix-v1';
import { initVisual, initAudioVisualizer, extractColors, initCustomBackground, openBackgroundStudio, resetCustomBackground } from './visual.js?v=player-init-fix-v1';
import { updateLyrics } from './lyrics.js?v=player-init-fix-v1';
import { loadChatHistory, setAvatar, getAvatar, hasCustomAvatar } from './chat.js?v=player-init-fix-v1';
import { server } from './api.js?v=player-init-fix-v1';
import './panels.js?v=player-init-fix-v1';
import './voice.js?v=player-init-fix-v1';

console.log('Claudio FM 启动中...');

// 注册 Service Worker（PWA）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js?v=original-ui-v10-network-first-ui').then((registration) => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 菜单按钮
const menuBtn = document.getElementById('menuBtn');
const topbarMenu = document.getElementById('topbarMenu');
const cfgDjAvatarFile = document.getElementById('cfgDjAvatarFile');
const cfgUserAvatarFile = document.getElementById('cfgUserAvatarFile');
const cfgDjAvatarClear = document.getElementById('cfgDjAvatarClear');
const cfgUserAvatarClear = document.getElementById('cfgUserAvatarClear');
const cfgDjAvatarPreview = document.getElementById('cfgDjAvatarPreview');
const cfgUserAvatarPreview = document.getElementById('cfgUserAvatarPreview');
const panelDjAvatarFile = document.getElementById('panelDjAvatarFile');
const panelUserAvatarFile = document.getElementById('panelUserAvatarFile');
const panelDjAvatarPreview = document.getElementById('panelDjAvatarPreview');
const panelUserAvatarPreview = document.getElementById('panelUserAvatarPreview');
const panelDjAvatarChangeBtn = document.getElementById('panelDjAvatarChangeBtn');
const panelUserAvatarChangeBtn = document.getElementById('panelUserAvatarChangeBtn');
const panelDjAvatarClearBtn = document.getElementById('panelDjAvatarClearBtn');
const panelUserAvatarClearBtn = document.getElementById('panelUserAvatarClearBtn');
const avatarCropPanel = document.getElementById('avatarCropPanel');
const avatarCropStage = document.getElementById('avatarCropStage');
const avatarCropImage = document.getElementById('avatarCropImage');
const avatarCropZoom = document.getElementById('avatarCropZoom');
const avatarCropApplyBtn = document.getElementById('avatarCropApplyBtn');
const avatarCropResetBtn = document.getElementById('avatarCropResetBtn');
const avatarCropCancelBtn = document.getElementById('avatarCropCancelBtn');
const playerMoodBubble = document.getElementById('playerMoodBubble');
const playerMoodChip = document.getElementById('playerMoodChip');
const playerMoodText = document.getElementById('playerMoodText');

const avatarCropState = {
  open: false,
  role: '',
  previewEl: null,
  src: '',
  img: null,
  baseScale: 1,
  zoom: 1,
  minZoom: 1,
  maxZoom: 3,
  x: 0,
  y: 0,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginY: 0,
  stageSize: 0
};

let playerMoodTimer = null;

function formatMoodLabel(moodValue = '') {
  const moodMap = {
    chill: 'Chill',
    warm: 'Warm',
    bright: 'Bright',
    focus: 'Focus',
    dreamy: 'Dreamy',
    mellow: 'Mellow',
    night: 'Night Ride'
  };
  return moodMap[moodValue] || moodValue || '当前电台情绪';
}

function showPlayerMoodBubble(mood) {
  if (!playerMoodBubble || !playerMoodChip || !playerMoodText) return;

  const label = [formatMoodLabel(mood?.mood), mood?.genre].filter(Boolean).join(' · ');
  playerMoodChip.textContent = label || '当前电台情绪';
  playerMoodText.textContent = mood?.message || '电台正在根据你此刻的听感，调整接下来的推荐氛围。';

  playerMoodBubble.classList.add('show');
  clearTimeout(playerMoodTimer);
  playerMoodTimer = window.setTimeout(() => {
    playerMoodBubble.classList.remove('show');
  }, 5200);
}

function setAvatarPreview(el, role) {
  if (!el) return;
  if (hasCustomAvatar(role)) {
    el.innerHTML = `<img src="${getAvatar(role)}" alt="">`;
  } else {
    el.textContent = role === 'assistant' ? '电台' : '我的';
  }
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('加载图片失败'));
    img.src = src;
  });
}

function getAvatarCropScale() {
  return avatarCropState.baseScale * avatarCropState.zoom;
}

function clampAvatarCropPosition() {
  const scale = getAvatarCropScale();
  const scaledWidth = avatarCropState.img.naturalWidth * scale;
  const scaledHeight = avatarCropState.img.naturalHeight * scale;
  const maxOffsetX = Math.max(0, (scaledWidth - avatarCropState.stageSize) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - avatarCropState.stageSize) / 2);
  avatarCropState.x = Math.min(maxOffsetX, Math.max(-maxOffsetX, avatarCropState.x));
  avatarCropState.y = Math.min(maxOffsetY, Math.max(-maxOffsetY, avatarCropState.y));
}

function renderAvatarCrop() {
  if (!avatarCropImage || !avatarCropState.img) return;
  const scale = getAvatarCropScale();
  avatarCropImage.style.width = `${avatarCropState.img.naturalWidth}px`;
  avatarCropImage.style.height = `${avatarCropState.img.naturalHeight}px`;
  avatarCropImage.style.transform = `translate(calc(-50% + ${avatarCropState.x}px), calc(-50% + ${avatarCropState.y}px)) scale(${scale})`;
}

function resetAvatarCropPosition() {
  avatarCropState.zoom = 1;
  avatarCropState.x = 0;
  avatarCropState.y = 0;
  if (avatarCropZoom) avatarCropZoom.value = '1';
  renderAvatarCrop();
}

function closeAvatarCropPanel() {
  avatarCropState.open = false;
  avatarCropState.role = '';
  avatarCropState.previewEl = null;
  avatarCropState.src = '';
  avatarCropState.img = null;
  avatarCropPanel.style.display = 'none';
  avatarCropStage?.classList.remove('dragging');
  avatarCropImage?.removeAttribute('src');
}

async function openAvatarCropPanel(role, src, previewEl) {
  const img = await loadImage(src);
  avatarCropState.open = true;
  avatarCropState.role = role;
  avatarCropState.previewEl = previewEl;
  avatarCropState.src = src;
  avatarCropState.img = img;
  avatarCropImage.src = src;
  avatarCropPanel.style.display = 'flex';
  requestAnimationFrame(() => {
    const stageSize = avatarCropStage?.clientWidth || 320;
    avatarCropState.stageSize = stageSize;
    avatarCropState.baseScale = Math.max(stageSize / img.naturalWidth, stageSize / img.naturalHeight);
    avatarCropState.minZoom = 1;
    avatarCropState.maxZoom = 3;
    avatarCropZoom.min = String(avatarCropState.minZoom);
    avatarCropZoom.max = String(avatarCropState.maxZoom);
    avatarCropZoom.value = '1';
    resetAvatarCropPosition();
  });
}

function exportAvatarCrop() {
  if (!avatarCropState.img) return '';
  const outputSize = 512;
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  const scale = getAvatarCropScale();
  const sourceStageSize = avatarCropState.stageSize;
  const sx = (avatarCropState.img.naturalWidth / 2) - ((sourceStageSize / 2) + avatarCropState.x) / scale;
  const sy = (avatarCropState.img.naturalHeight / 2) - ((sourceStageSize / 2) + avatarCropState.y) / scale;
  const sSize = sourceStageSize / scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    avatarCropState.img,
    sx,
    sy,
    sSize,
    sSize,
    0,
    0,
    outputSize,
    outputSize
  );
  return canvas.toDataURL('image/png');
}

async function handleAvatarFileChange(role, input, previewEl) {
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await readImageAsDataUrl(file);
    await openAvatarCropPanel(role, dataUrl, previewEl);
  } catch (err) {
    window.showToast(err.message || '头像更新失败');
  } finally {
    if (input) input.value = '';
  }
}

function clearAvatar(role, previewEl) {
  setAvatar(role, '');
  setAvatarPreview(previewEl, role);
  if (role === 'assistant') setAvatarPreview(panelDjAvatarPreview, role);
  if (role === 'user') setAvatarPreview(panelUserAvatarPreview, role);
  window.showToast(role === 'assistant' ? 'DJ 头像已恢复默认' : '我的头像已恢复默认');
}

avatarCropZoom?.addEventListener('input', () => {
  if (!avatarCropState.open || !avatarCropState.img) return;
  avatarCropState.zoom = parseFloat(avatarCropZoom.value) || 1;
  clampAvatarCropPosition();
  renderAvatarCrop();
});

avatarCropStage?.addEventListener('pointerdown', (e) => {
  if (!avatarCropState.open || !avatarCropState.img) return;
  avatarCropStage.setPointerCapture(e.pointerId);
  avatarCropStage.classList.add('dragging');
  avatarCropState.dragStartX = e.clientX;
  avatarCropState.dragStartY = e.clientY;
  avatarCropState.dragOriginX = avatarCropState.x;
  avatarCropState.dragOriginY = avatarCropState.y;
});

avatarCropStage?.addEventListener('pointermove', (e) => {
  if (!avatarCropStage.hasPointerCapture(e.pointerId) || !avatarCropState.img) return;
  avatarCropState.x = avatarCropState.dragOriginX + (e.clientX - avatarCropState.dragStartX);
  avatarCropState.y = avatarCropState.dragOriginY + (e.clientY - avatarCropState.dragStartY);
  clampAvatarCropPosition();
  renderAvatarCrop();
});

function stopAvatarCropDrag(pointerId) {
  if (pointerId != null && avatarCropStage?.hasPointerCapture(pointerId)) {
    avatarCropStage.releasePointerCapture(pointerId);
  }
  avatarCropStage?.classList.remove('dragging');
}

avatarCropStage?.addEventListener('pointerup', (e) => stopAvatarCropDrag(e.pointerId));
avatarCropStage?.addEventListener('pointercancel', (e) => stopAvatarCropDrag(e.pointerId));

avatarCropResetBtn?.addEventListener('click', () => {
  if (!avatarCropState.open || !avatarCropState.img) return;
  resetAvatarCropPosition();
});

avatarCropCancelBtn?.addEventListener('click', closeAvatarCropPanel);

avatarCropApplyBtn?.addEventListener('click', () => {
  if (!avatarCropState.open || !avatarCropState.role) return;
  const cropped = exportAvatarCrop();
  if (!cropped) {
    window.showToast('头像裁切失败');
    return;
  }
  setAvatar(avatarCropState.role, cropped);
  setAvatarPreview(avatarCropState.previewEl, avatarCropState.role);
  if (avatarCropState.role === 'assistant') {
    setAvatarPreview(cfgDjAvatarPreview, 'assistant');
    setAvatarPreview(panelDjAvatarPreview, 'assistant');
  } else {
    setAvatarPreview(cfgUserAvatarPreview, 'user');
    setAvatarPreview(panelUserAvatarPreview, 'user');
  }
  window.showToast(avatarCropState.role === 'assistant' ? 'DJ 头像已更新' : '我的头像已更新');
  closeAvatarCropPanel();
});

avatarCropPanel?.addEventListener('click', (e) => {
  if (e.target === avatarCropPanel) closeAvatarCropPanel();
});

menuBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  topbarMenu.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!topbarMenu?.contains(e.target)) topbarMenu?.classList.remove('show');
});

topbarMenu?.querySelectorAll('.topbar-menu-item').forEach(btn => {
  btn.addEventListener('click', async () => {
    topbarMenu.classList.remove('show');
    const action = btn.dataset.action;

    if (action === 'voice') {
      const song = window.player?.getCurrentSong?.();
      const text = song
        ? `现在为你播放的是${song.artist}的${song.name}，好好享受这首歌吧。`
        : '欢迎来到 Claudio FM，我是你的 AI DJ。点一首歌开始你的音乐之旅吧。';
      window.voice?.speak(text);
    }

    if (action === 'daily') {
      try {
        window.showToast('正在准备今日推荐...');
        const playlist = await server.get('/api/scheduler/daily-playlist');
        if (playlist?.songs?.length) {
          window.player?.setQueue(playlist.songs, 0);
          window.player?.playSong(playlist.songs[0]);
          window.showToast(`今日推荐：${playlist.songs.length} 首歌`);
        } else {
          window.showToast('今日推荐暂时生成失败');
        }
      } catch { window.showToast('获取今日推荐失败'); }
    }

    if (action === 'mood') {
      try {
        window.showToast('正在判断当前电台情绪...');
        const mood = await server.get('/api/scheduler/mood');
        if (mood?.mood) {
          showPlayerMoodBubble(mood);
        } else {
          window.showToast('情绪状态暂时不可用');
        }
      } catch { window.showToast('获取情绪失败'); }
    }

    if (action === 'bg-upload') {
      openBackgroundStudio({ pickMedia: true });
    }

    if (action === 'bg-reset') {
      try {
        await resetCustomBackground();
        window.showToast('已恢复默认背景');
      } catch {
        window.showToast('恢复默认背景失败');
      }
    }

    if (action === 'config') {
      const panel = document.getElementById('configPanel');
      panel.style.display = 'flex';
      try {
        const cfg = await server.get('/api/env-config');
        document.getElementById('cfgBaseUrl').value = cfg.OPENAI_BASE_URL || '';
        document.getElementById('cfgApiKey').value = cfg.OPENAI_API_KEY || '';
        document.getElementById('cfgModel').value = cfg.OPENAI_MODEL || '';
        document.getElementById('cfgNeteaseApi').value = cfg.NETEASE_API || '';
        document.getElementById('cfgNeteaseCookie').value = cfg.NETEASE_COOKIE || '';
        setAvatarPreview(cfgDjAvatarPreview, 'assistant');
        setAvatarPreview(cfgUserAvatarPreview, 'user');
      } catch { window.showToast('加载配置失败'); }
    }
  });
});

cfgDjAvatarFile?.addEventListener('change', () => handleAvatarFileChange('assistant', cfgDjAvatarFile, cfgDjAvatarPreview));
cfgUserAvatarFile?.addEventListener('change', () => handleAvatarFileChange('user', cfgUserAvatarFile, cfgUserAvatarPreview));
cfgDjAvatarClear?.addEventListener('click', () => clearAvatar('assistant', cfgDjAvatarPreview));
cfgUserAvatarClear?.addEventListener('click', () => clearAvatar('user', cfgUserAvatarPreview));
panelDjAvatarFile?.addEventListener('change', () => handleAvatarFileChange('assistant', panelDjAvatarFile, panelDjAvatarPreview));
panelUserAvatarFile?.addEventListener('change', () => handleAvatarFileChange('user', panelUserAvatarFile, panelUserAvatarPreview));
panelDjAvatarChangeBtn?.addEventListener('click', () => panelDjAvatarFile?.click());
panelUserAvatarChangeBtn?.addEventListener('click', () => panelUserAvatarFile?.click());
panelDjAvatarClearBtn?.addEventListener('click', () => clearAvatar('assistant', panelDjAvatarPreview));
panelUserAvatarClearBtn?.addEventListener('click', () => clearAvatar('user', panelUserAvatarPreview));

// 配置面板保存
document.getElementById('cfgSaveBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('cfgSaveBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    await server.put('/api/env-config', {
      OPENAI_BASE_URL: document.getElementById('cfgBaseUrl').value.trim(),
      OPENAI_API_KEY: document.getElementById('cfgApiKey').value.trim() || undefined,
      OPENAI_MODEL: document.getElementById('cfgModel').value.trim() || undefined,
      NETEASE_API: document.getElementById('cfgNeteaseApi').value.trim(),
      NETEASE_COOKIE: document.getElementById('cfgNeteaseCookie').value.trim() || undefined
    });
    window.showToast('配置已保存，重启服务后生效');
    document.getElementById('configPanel').style.display = 'none';
  } catch { window.showToast('保存失败'); }
  btn.disabled = false;
  btn.textContent = '保存并重启';
});

// 点击遮罩关闭配置面板
document.getElementById('configPanel')?.addEventListener('click', (e) => {
  if (e.target.id === 'configPanel') e.target.style.display = 'none';
});

setAvatarPreview(cfgDjAvatarPreview, 'assistant');
setAvatarPreview(cfgUserAvatarPreview, 'user');
setAvatarPreview(panelDjAvatarPreview, 'assistant');
setAvatarPreview(panelUserAvatarPreview, 'user');

// 初始化
async function init() {
  let playbackReady = false;
  let historyReady = false;

  try {
    showPlayerView();
    await initCustomBackground();
  } catch (err) {
    console.error('背景初始化失败:', err);
  }

  try {
    initVisual();
    initAudioVisualizer(getAudioElement());
  } catch (err) {
    console.error('视觉模块初始化失败:', err);
  }

  try {
    await restorePlayback();
    playbackReady = true;
  } catch (err) {
    console.error('恢复播放状态失败:', err);
  }

  try {
    await loadChatHistory();
    historyReady = true;
  } catch (err) {
    console.error('加载聊天记录失败:', err);
  }

  if (!playbackReady && !historyReady) {
    window.showToast('服务连接异常，请刷新或重启后端');
  } else if (!playbackReady) {
    window.showToast('播放状态恢复失败，已进入可用界面');
  } else if (!historyReady) {
    window.showToast('聊天记录加载失败，播放器可正常使用');
  }

  try {
    console.log('Claudio FM 初始化完成');
  } catch (err) {
    console.error('初始化失败:', err);
  }
}

init();

// 歌词同步
window.addEventListener('timeupdate', (e) => {
  updateLyrics(e.detail);
});

// 歌曲变化时取色
window.addEventListener('songchange', (e) => {
  const song = e.detail;
  if (song.cover) extractColors(song.cover);
});
