require('dotenv').config();

const requiredEnvVars = [
  'BOT_TOKEN',
  'DOMAIN_HUBS',
  'CHAVE_HUBS',
  'LIST_OWNERS',
  'PAYMENT_API_URL',
  'PAYMENT_CLIENT_ID',
  'PAYMENT_CLIENT_SECRET',
  'PAYER_NAME',
  'PAYER_DOCUMENT',
  'BUTTON_TEXT',
  'BUTTON_URL',
  'LIKES_REGIONS'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(`\n[ERRO FATAL] Variáveis de ambiente faltando: ${missingVars.join(', ')}\n`);
  process.exit(1);
}

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const messages = require('./banco-dados/messages-txt.js');
const paymentSystem = require('./banco-dados/payment.js');

const token = process.env.BOT_TOKEN;
const API_7XHUB = process.env.DOMAIN_HUBS;
const API_KEY = process.env.CHAVE_HUBS;
const LIST_OWNERS = process.env.LIST_OWNERS.split(',').map(id => id.trim());
const BUTTON_TEXT = process.env.BUTTON_TEXT;
const BUTTON_URL = process.env.BUTTON_URL;

const LIKES_REGIONS = [];
process.env.LIKES_REGIONS.split(',').forEach(item => {
  const [request, name] = item.split('|').map(s => s.trim());
  if (request && name) {
    LIKES_REGIONS.push({ request, name });
  }
});

if (LIKES_REGIONS.length === 0) {
  console.error('\n[ERRO FATAL] Nenhuma região configurada em LIKES_REGIONS\n');
  process.exit(1);
}

const DB_DIR = './banco-dados/banco-json';
const USERS_FILE = path.join(DB_DIR, 'users.json');
const REQUESTS_FILE = path.join(DB_DIR, 'requests.json');
const PLAYERS_FILE = path.join(DB_DIR, 'players.json');
const QUEUE_FILE = path.join(DB_DIR, 'queue.json');
const ADMIN_LOGS_FILE = path.join(DB_DIR, 'admin_logs.json');
const BLOCKED_USERS_FILE = path.join(DB_DIR, 'blocked_users.json');

const MIN_LIKES_FOR_DEDUCTION = 1;
const MIN_LIKES_FOR_PLAYER_COOLDOWN = 1;
const MAX_QUEUE_SIZE = 50;
const MAX_CONCURRENT_REQUESTS = 5;
const REQUEST_TIMEOUT = 45000;
const MAX_VIP_DAYS_NORMAL_DONO = 30;
const QUEUE_ITEM_TIMEOUT = 60000;
const QUEUE_CLEANUP_INTERVAL = 30000;
const PLAYER_COOLDOWN_HOURS = 7;
const PLAYER_COOLDOWN_MS = PLAYER_COOLDOWN_HOURS * 60 * 60 * 1000;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function generateShortId() {
  return Math.random().toString(36).slice(2, 8);
}

class QueueSystem {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.processingMap = new Map();
    this.activeProcesses = 0;
    this.isProcessing = false;
    this.lastCleanup = Date.now();
  }

  add(item) {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return false;
    }
    const existing = this.queue.find(q => q.requestId === item.requestId);
    if (existing) return false;
    this.queue.push({
      ...item,
      addedAt: Date.now(),
      lastUpdate: Date.now(),
      attempts: 0,
      maxAttempts: 1,
      processing: false
    });
    return true;
  }

  remove(requestId) {
    const index = this.queue.findIndex(q => q.requestId === requestId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    if (this.processing.has(requestId)) {
      this.processing.delete(requestId);
      this.processingMap.delete(requestId);
      this.activeProcesses--;
      return true;
    }
    return false;
  }

  getNext() {
    if (this.activeProcesses >= MAX_CONCURRENT_REQUESTS) {
      return null;
    }
    const available = this.queue.filter(item =>
      !item.processing &&
      !this.processing.has(item.requestId) &&
      Date.now() - item.addedAt < QUEUE_ITEM_TIMEOUT
    );
    if (available.length === 0) return null;
    const item = available[0];
    const index = this.queue.findIndex(q => q.requestId === item.requestId);
    if (index !== -1) {
      this.queue[index].processing = true;
      this.queue[index].lastUpdate = Date.now();
      this.processing.add(item.requestId);
      this.processingMap.set(item.requestId, {
        startTime: Date.now(),
        chatId: item.chatId,
        messageId: item.messageId
      });
      this.activeProcesses++;
      return this.queue[index];
    }
    return null;
  }

  complete(requestId, success = true) {
    if (this.processing.has(requestId)) {
      this.processing.delete(requestId);
      this.processingMap.delete(requestId);
      this.activeProcesses--;
    }
    const index = this.queue.findIndex(q => q.requestId === requestId);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
    return success;
  }

  markForRetry(requestId) {
    const index = this.queue.findIndex(q => q.requestId === requestId);
    if (index !== -1) {
      this.queue[index].attempts++;
      this.queue[index].processing = false;
      this.queue[index].lastUpdate = Date.now();
      if (this.queue[index].attempts >= this.queue[index].maxAttempts) {
        this.queue.splice(index, 1);
        return false;
      }
      this.processing.delete(requestId);
      this.processingMap.delete(requestId);
      this.activeProcesses--;
      return true;
    }
    return false;
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const item = this.queue[i];
      if (now - item.addedAt > QUEUE_ITEM_TIMEOUT) {
        const processingInfo = this.processingMap.get(item.requestId);
        if (processingInfo) {
          const msgData = messages.queueTimeout(processingInfo.chatId, processingInfo.messageId, i + 1, 60);
          safeEditMessageText(processingInfo.chatId, processingInfo.messageId, msgData.text, msgData.options);
        }
        this.queue.splice(i, 1);
        this.processing.delete(item.requestId);
        this.processingMap.delete(item.requestId);
        removed++;
      }
    }
    this.activeProcesses = this.processing.size;
    this.lastCleanup = now;
    return removed;
  }

  getStats() {
    return {
      total: this.queue.length,
      processing: this.activeProcesses,
      waiting: this.queue.length - this.activeProcesses,
      maxConcurrent: MAX_CONCURRENT_REQUESTS,
      maxQueue: MAX_QUEUE_SIZE
    };
  }

  getPosition(requestId) {
    const waitingItems = this.queue.filter(item => !item.processing);
    const index = waitingItems.findIndex(item => item.requestId === requestId);
    if (index !== -1) return index + 1;
    const processingIndex = Array.from(this.queue.entries()).findIndex(([i, item]) => item.requestId === requestId);
    if (processingIndex !== -1) return processingIndex + 1;
    return null;
  }
}

const queueSystem = new QueueSystem();

let usersCache = {};
let requestsCache = {};
let playersCache = {};
let adminLogsCache = [];
let blockedUsersCache = {};
let cacheLoaded = false;
let broadcastsPending = {};

function loadAllData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch { usersCache = {}; }

  try {
    if (fs.existsSync(REQUESTS_FILE)) {
      requestsCache = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
    }
  } catch { requestsCache = {}; }

  try {
    if (fs.existsSync(PLAYERS_FILE)) {
      playersCache = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
    }
  } catch { playersCache = {}; }

  try {
    if (fs.existsSync(ADMIN_LOGS_FILE)) {
      adminLogsCache = JSON.parse(fs.readFileSync(ADMIN_LOGS_FILE, 'utf8'));
    }
  } catch { adminLogsCache = []; }

  try {
    if (fs.existsSync(BLOCKED_USERS_FILE)) {
      blockedUsersCache = JSON.parse(fs.readFileSync(BLOCKED_USERS_FILE, 'utf8'));
    }
  } catch { blockedUsersCache = {}; }

  cacheLoaded = true;
  loadQueueFromStorage();
}

function loadQueueFromStorage() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const queueData = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      const now = Date.now();
      if (queueData.queue && Array.isArray(queueData.queue)) {
        const validItems = queueData.queue.filter(item =>
          item &&
          item.requestId &&
          now - item.addedAt < QUEUE_ITEM_TIMEOUT
        );
        validItems.forEach(item => {
          queueSystem.add({
            ...item,
            processing: false,
            lastUpdate: now
          });
        });
      }
    }
  } catch {}
}

function saveAllData() {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(usersCache, null, 2)); } catch {}
  try { fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requestsCache, null, 2)); } catch {}
  try { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playersCache, null, 2)); } catch {}
  try { saveQueueToStorage(); } catch {}
  try { fs.writeFileSync(ADMIN_LOGS_FILE, JSON.stringify(adminLogsCache, null, 2)); } catch {}
  try { fs.writeFileSync(BLOCKED_USERS_FILE, JSON.stringify(blockedUsersCache, null, 2)); } catch {}
}

function saveQueueToStorage() {
  try {
    const queueData = {
      queue: queueSystem.queue.map(item => ({
        chatId: item.chatId,
        uid: item.uid,
        requestId: item.requestId,
        userId: item.userId,
        username: item.username,
        region: item.region,
        regionName: item.regionName,
        addedAt: item.addedAt,
        messageId: item.messageId
      })),
      lastUpdated: Date.now()
    };
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueData, null, 2));
  } catch {}
}

function saveUsers() { try { fs.writeFileSync(USERS_FILE, JSON.stringify(usersCache, null, 2)); } catch {} }
function saveRequests() { try { fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requestsCache, null, 2)); } catch {} }
function savePlayers() { try { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playersCache, null, 2)); } catch {} }
function saveAdminLogs() { try { fs.writeFileSync(ADMIN_LOGS_FILE, JSON.stringify(adminLogsCache, null, 2)); } catch {} }
function saveBlockedUsers() { try { fs.writeFileSync(BLOCKED_USERS_FILE, JSON.stringify(blockedUsersCache, null, 2)); } catch {} }

function isAdmin(userId) {
  return LIST_OWNERS.includes(userId.toString());
}

function isBlocked(userId) {
  if (blockedUsersCache[userId]) return true;
  const user = usersCache[userId];
  return user ? user.blocked : false;
}

function blockUser(userId, adminId, reason) {
  const now = Date.now();
  const user = usersCache[userId];
  blockedUsersCache[userId] = {
    userId: userId,
    username: user ? user.username : '',
    blockedAt: now,
    blockedBy: adminId,
    reason: reason || '',
    blockedDate: new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };
  if (user) {
    user.blocked = true;
    user.blockedAt = now;
    user.blockedBy = adminId;
    user.blockReason = reason || '';
    saveUsers();
  }
  saveBlockedUsers();
  logAdminAction(adminId, 'block', userId, { reason: reason });
  return true;
}

function unblockUser(userId, adminId, reason) {
  if (blockedUsersCache[userId]) delete blockedUsersCache[userId];
  const user = usersCache[userId];
  if (user) {
    user.blocked = false;
    user.blockedAt = 0;
    user.blockedBy = null;
    user.blockReason = '';
    saveUsers();
  }
  saveBlockedUsers();
  logAdminAction(adminId, 'unblock', userId, { reason: reason });
  return true;
}

function isVip(userId) {
  if (isBlocked(userId)) return false;
  const user = usersCache[userId];
  if (!user || !user.vip) return false;
  return user.vipExpires > Date.now();
}

function getVipDaysLeft(userId) {
  const user = usersCache[userId];
  if (!user || !user.vip) return 0;
  const now = Date.now();
  if (user.vipExpires <= now) return 0;
  return Math.ceil((user.vipExpires - now) / (1000 * 60 * 60 * 24));
}

function registerUser(userId, username) {
  if (isBlocked(userId)) return false;
  if (!usersCache[userId]) {
    usersCache[userId] = {
      username: username || '',
      registeredAt: Date.now(),
      vip: false,
      vipExpires: 0,
      vipLimit: null,
      vipUsed: 0,
      lastVipReset: null,
      vipResetDate: null,
      dailyRequests: 0,
      lastRequestDate: null,
      lastLikeTime: 0,
      totalRequests: 0,
      totalLikesSent: 0,
      vipTimes: 0,
      addedByAdmin: null,
      lastAdminAction: null,
      blocked: false,
      blockedAt: 0,
      blockedBy: null,
      blockReason: '',
      lastPaymentRequest: 0
    };
    saveUsers();
  } else if (usersCache[userId].username !== username) {
    usersCache[userId].username = username || '';
    saveUsers();
  }
  return true;
}

function canUserRequest(userId, chatId) {
  if (isBlocked(userId)) return { can: false, reason: 'blocked' };
  const user = usersCache[userId];
  if (!user) return { can: false, reason: 'not_registered' };

  if (isVip(userId)) {
    const vipCheck = canUserUseVip(userId);
    if (!vipCheck.can) return vipCheck;
    return { can: true, type: 'vip' };
  }

  if (isAdmin(userId)) return { can: true, type: 'admin' };

  return { can: false, reason: 'no_access' };
}

function updateUserRequest(userId, likesAdded) {
  const user = usersCache[userId];
  if (user && likesAdded >= MIN_LIKES_FOR_DEDUCTION) {
    user.totalRequests += 1;
    user.totalLikesSent += likesAdded;
    user.lastRequestDate = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    user.lastLikeTime = Date.now();
    saveUsers();
  }
}

function updatePlayerRecord(uid, playerName, region, likesAdded) {
  const now = Date.now();
  playersCache[uid] = {
    playerName: playerName || 'Unknown',
    region: region || 'BR',
    lastRequestTime: now,
    lastLikesAdded: likesAdded,
    totalLikesAdded: (playersCache[uid]?.totalLikesAdded || 0) + likesAdded,
    totalRequests: (playersCache[uid]?.totalRequests || 0) + 1
  };
  savePlayers();
}

function canSendLikesToPlayer(uid) {
  const player = playersCache[uid];
  if (!player) return true;
  const now = Date.now();
  const timeSinceLastRequest = now - player.lastRequestTime;
  if (timeSinceLastRequest < PLAYER_COOLDOWN_MS && player.lastLikesAdded >= MIN_LIKES_FOR_PLAYER_COOLDOWN) {
    return false;
  }
  return true;
}

function checkExpiredVips() {
  let updated = false;
  const now = Date.now();

  for (const userId in usersCache) {
    if (usersCache[userId].vip && usersCache[userId].vipExpires <= now) {
      usersCache[userId].vip = false;
      usersCache[userId].vipExpires = 0;
      updated = true;
    }
  }

  if (updated) {
    saveUsers();
  }
}

function generateRequestId(userId, uid) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${userId}_${uid}_${timestamp}_${random}`;
}

function saveRequestData(requestId, data) {
  requestsCache[requestId] = {
    ...data,
    savedAt: Date.now(),
    userId: data.userId
  };
  saveRequests();
}

function getRequestData(requestId) {
  return requestsCache[requestId];
}

function cleanupOldRequests() {
  const now = Date.now();
  const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
  let updated = false;
  for (const requestId in requestsCache) {
    if (requestsCache[requestId].savedAt < oneWeekAgo) {
      delete requestsCache[requestId];
      updated = true;
    }
  }
  if (updated) saveRequests();
}

function logAdminAction(adminId, action, targetUserId = null, details = null) {
  adminLogsCache.push({
    adminId: adminId,
    action: action,
    targetUserId: targetUserId,
    details: details,
    timestamp: Date.now(),
    date: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  });
  if (adminLogsCache.length > 1000) adminLogsCache.splice(0, 200);
  saveAdminLogs();
}

async function safeEditMessageText(chatId, messageId, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: options.parse_mode || 'HTML',
      reply_markup: options.reply_markup
    });
    return true;
  } catch (error) {
    if (error && error.response && error.response.description && error.response.description.includes('message to edit not found')) {
      try {
        await bot.sendMessage(chatId, text, {
          parse_mode: options.parse_mode || 'HTML',
          reply_markup: options.reply_markup
        });
      } catch (sendError) {}
    } else if (error && error.response && error.response.description && error.response.description.includes('BUTTON_DATA_INVALID')) {
      try {
        await bot.sendMessage(chatId, text, {
          parse_mode: options.parse_mode || 'HTML'
        });
      } catch (sendError) {}
    }
    return false;
  }
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    const result = await bot.sendMessage(chatId, text, options);
    return result;
  } catch (error) {
    return null;
  }
}

async function deleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    return false;
  }
}

async function processQueue() {
  if (queueSystem.isProcessing) return;
  queueSystem.isProcessing = true;
  try {
    const now = Date.now();
    if (now - queueSystem.lastCleanup > QUEUE_CLEANUP_INTERVAL) {
      queueSystem.cleanup();
      saveQueueToStorage();
    }
    while (true) {
      const stats = queueSystem.getStats();
      if (stats.processing >= MAX_CONCURRENT_REQUESTS) break;
      const item = queueSystem.getNext();
      if (!item) break;
      processQueueItem(item).then(async (success) => {
        if (success) {
          queueSystem.complete(item.requestId, true);
        } else {
          if (queueSystem.markForRetry(item.requestId)) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            queueSystem.complete(item.requestId, false);
          }
        }
        saveQueueToStorage();
      }).catch(() => {
        queueSystem.complete(item.requestId, false);
        saveQueueToStorage();
      });
    }
  } catch (error) {
  } finally {
    queueSystem.isProcessing = false;
  }
}

async function processQueueItem(item) {
  let success = false;

  try {
    const url = `${API_7XHUB}?id=${item.uid}&key=${API_KEY}&region=${item.region}`;
    console.log(`[API Request] Enviando requisição: ${url}`);
    
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    const data = response.data;
    console.log(`[API Response] Status: ${response.status}, Dados:`, JSON.stringify(data, null, 2));

    if (!data.sucesso || data.statuscode !== 200) {
      console.log(`[API Error] sucesso: ${data.sucesso}, statuscode: ${data.statuscode}, mensagem: ${data.mensagem || 'N/A'}`);
      
      const errorMsg = data.mensagem || 'erro_desconhecido';
      
      if (errorMsg.includes('player_not_found') || errorMsg.includes('jogador nao encontrado')) {
        const msgData = messages.playerNotFound(item.chatId, item.messageId, item.regionName || item.region, response.status, item.uid, item.userId);
        await safeEditMessageText(item.chatId, item.messageId, msgData.text, msgData.options);
        return false;
      }

      if (errorMsg.includes('KEY_NOT_FOUND') || errorMsg.includes('KEY_INACTIVE') || errorMsg.includes('KEY_BLOCKED') || errorMsg.includes('KEY_EXPIRED')) {
        const msgData = messages.apiKeyError(item.chatId, item.messageId, errorMsg);
        await safeEditMessageText(item.chatId, item.messageId, msgData.text, msgData.options);
        return false;
      }

      if (errorMsg.includes('LIMIT_EXCEEDED') || errorMsg.includes('TOTAL_LIMIT_EXCEEDED')) {
        const msgData = messages.apiKeyError(item.chatId, item.messageId, errorMsg);
        await safeEditMessageText(item.chatId, item.messageId, msgData.text, msgData.options);
        return false;
      }

      const msgData = messages.playerNotFound(item.chatId, item.messageId, item.regionName || item.region, response.status, item.uid, item.userId);
      await safeEditMessageText(item.chatId, item.messageId, msgData.text, msgData.options);
      return false;
    }

    const playerDataArray = data.data;
    if (!playerDataArray || !Array.isArray(playerDataArray) || playerDataArray.length === 0) {
      const msgData = messages.playerNotFound(item.chatId, item.messageId, item.regionName || item.region, response.status, item.uid, item.userId);
      await safeEditMessageText(item.chatId, item.messageId, msgData.text, msgData.options);
      return false;
    }

    const playerInfo = playerDataArray[0];
    const conta = playerInfo.conta || {};
    const likes = playerInfo.likes || {};
    const external = playerInfo.external || {};

    const totalLikesAdded = likes.enviadas || 0;
    const initialLikes = likes.antes || 0;
    const finalLikes = likes.depois || 0;
    const playerNickname = conta.nome_conta || 'N/A';
    const playerId = conta.id_conta || item.uid;
    const contabilizado = external.contabilizado || false;

    console.log(`[API Success] Jogador: ${playerNickname}, Likes enviados: ${totalLikesAdded}, Likes antes: ${initialLikes}, Likes depois: ${finalLikes}, Contabilizado: ${contabilizado}`);

    if (totalLikesAdded >= MIN_LIKES_FOR_DEDUCTION) {
      updateUserRequest(item.userId, totalLikesAdded);
      if (item.isVip) incrementVipUsage(item.userId);
    }

    if (totalLikesAdded >= MIN_LIKES_FOR_PLAYER_COOLDOWN) {
      updatePlayerRecord(item.uid, playerNickname, item.region, totalLikesAdded);
    }

    const regionData = item.regionName;
    
    let message = '';
    
    if (totalLikesAdded > 0) {
      message = `<b><u>🚀 | LIKES ADICIONADOS COM SUCESSO!</u></b>\n\n` +
        `<blockquote>` +
        `<b> → Detalhes do pedido finalizado:</b>\n` +
        `<b> ↳ Jogador:</b> <code>${playerNickname}</code>\n` +
        `<b> ↳ ContaId:</b> <code>${playerId}</code>\n` +
        `<b> ↳ Região:</b> <code>${regionData}</code>\n` +
        `<b> ↳ Likes Antes:</b> <code>${initialLikes} likes</code>\n` +
        `<b> ↳ Likes Depois:</b> <code>${finalLikes} likes</code>\n` +
        `<b> ↳ Total Adicionado:</b> <code>${totalLikesAdded} likes</code>\n` +
        `<b> ↳ Status da API:</b> <code>Sucesso</code>\n` +
        `<b> ↳ Contabilizado:</b> <code>${contabilizado ? 'Sim' : 'Não'}</code>` +
        `</blockquote>\n\n` +
        `<b><u>💐 | Pedido processado com sucesso!</u></b>`;
    } else {
      message = `<b><u>🚫 | NENHUM LIKE ADICIONADO!</u></b>\n\n` +
        `<blockquote>` +
        `<b> → Detalhes do pedido finalizado:</b>\n` +
        `<b> ↳ Jogador:</b> <code>${playerNickname}</code>\n` +
        `<b> ↳ ContaId:</b> <code>${playerId}</code>\n` +
        `<b> ↳ Região:</b> <code>${regionData}</code>\n` +
        `<b> ↳ Likes Antes:</b> <code>${initialLikes} likes</code>\n` +
        `<b> ↳ Likes Depois:</b> <code>${finalLikes} likes</code>\n` +
        `<b> ↳ Total Adicionado:</b> <code>${totalLikesAdded} likes</code>\n` +
        `<b> ↳ Status da API:</b> <code>Sucesso</code>\n` +
        `<b> ↳ Contabilizado:</b> <code>${contabilizado ? 'Sim' : 'Não'}</code>` +
        `</blockquote>\n\n` +
        `<b><u>⚠️ | Nenhum like foi adicionado ao jogador.</u></b>`;
    }

    await safeEditMessageText(item.chatId, item.messageId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: BUTTON_TEXT, url: BUTTON_URL }
        ]]
      }
    });

    success = true;

  } catch (error) {
    console.log(`[API Error] Detalhes do erro:`, {
      message: error.message,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : 'N/A'
    });

    if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
      const msgData = messages.queueTimeout(item.chatId, item.messageId, 0, 45);
      await safeEditMessageText(item.chatId, item.messageId, msgData.text, msgData.options);
    } else {
      const responseTime = Date.now() - item.addedAt;
      const status = error.response ? error.response.status : 'N/A';
      const responseData = error.response ? JSON.stringify(error.response.data || {}) : '{}';
      const errorMessage = messages.genericError(item.chatId, item.messageId, item.userId, item.uid, {
        responseTime: `${responseTime}ms`,
        status: status,
        response: responseData,
        apiUrl: API_7XHUB
      });
      await safeEditMessageText(item.chatId, item.messageId, errorMessage.text, errorMessage.options);
    }
  }

  return success;
}

let activeBotsInChats = {};

function shouldBotRespond(chatId) {
  const chatIdStr = chatId.toString();
  
  if (!chatIdStr.startsWith('-100') && chatId >= 0) {
    return true;
  }
  
  const botId = bot.token.split(':')[0];
  
  if (!activeBotsInChats[chatIdStr]) {
    activeBotsInChats[chatIdStr] = botId;
    return true;
  }
  
  if (activeBotsInChats[chatIdStr] === botId) {
    return true;
  }
  
  return false;
}

async function checkAndUpdateBotPresence(chatId) {
  try {
    const chatIdStr = chatId.toString();
    
    if (!chatIdStr.startsWith('-100') && chatId >= 0) {
      return true;
    }
    
    const botId = bot.token.split(':')[0];
    const chatMember = await bot.getChatMember(chatId, botId);
    
    if (chatMember && chatMember.status !== 'left' && chatMember.status !== 'kicked') {
      activeBotsInChats[chatIdStr] = botId;
      return true;
    } else {
      if (activeBotsInChats[chatIdStr] === botId) {
        delete activeBotsInChats[chatIdStr];
      }
      return false;
    }
  } catch (error) {
    if (activeBotsInChats[chatId.toString()]) {
      delete activeBotsInChats[chatId.toString()];
    }
    return false;
  }
}

function canUserUseVip(userId) {
  const user = usersCache[userId];
  if (!user || !user.vip || user.vipExpires <= Date.now()) return { can: false, reason: 'vip_expired' };
  
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  if (user.vipLimit !== null && user.vipLimit > 0) {
    if (!user.lastVipReset || user.lastVipReset < todayTimestamp) {
      user.vipUsed = 0;
      user.lastVipReset = now.getTime();
      user.vipResetDate = new Date(now).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      saveUsers();
    }
    if (user.vipUsed >= user.vipLimit) {
      return { can: false, reason: 'vip_limit_reached', limit: user.vipLimit, used: user.vipUsed };
    }
  }
  return { can: true, reason: 'vip_access_granted' };
}

function incrementVipUsage(userId) {
  const user = usersCache[userId];
  if (!user || !user.vip) return;
  
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  if (!user.lastVipReset || user.lastVipReset < todayTimestamp) {
    user.vipUsed = 0;
    user.lastVipReset = now.getTime();
    user.vipResetDate = new Date(now).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
  user.vipUsed = (user.vipUsed || 0) + 1;
  saveUsers();
}

let bot = null;

function buildMainStartInline(userId) {
  const inlineKeyboard = [];
  const firstRow = [];
  if (isAdmin(userId)) firstRow.push({ text: "Admin", callback_data: `md_${userId}` });
  firstRow.push({ text: "Perfil", callback_data: `mh_${userId}` });
  inlineKeyboard.push(firstRow);

  return inlineKeyboard;
}

function buildPlansKeyboard(userId, plans) {
  const keyboard = [];
  
  for (let i = 0; i < plans.length; i += 2) {
    const row = [];
    row.push({ 
      text: `${plans[i].nome} - R$ ${plans[i].valor.toFixed(2)}`, 
      callback_data: `select_plan_${userId}_${plans[i].id}` 
    });
    
    if (i + 1 < plans.length) {
      row.push({ 
        text: `${plans[i + 1].nome} - R$ ${plans[i + 1].valor.toFixed(2)}`, 
        callback_data: `select_plan_${userId}_${plans[i + 1].id}` 
      });
    }
    keyboard.push(row);
  }
  
  keyboard.push([{ text: "❌ CANCELAR", callback_data: `mp_${userId}` }]);
  
  return keyboard;
}

function buildAdminPlansKeyboard(adminId, targetUserId, plans) {
  const keyboard = [];
  
  for (let i = 0; i < plans.length; i += 2) {
    const row = [];
    row.push({ 
      text: `${plans[i].nome} - R$ ${plans[i].valor.toFixed(2)}`, 
      callback_data: `admin_add_vip_${adminId}_${targetUserId}_${plans[i].id}` 
    });
    
    if (i + 1 < plans.length) {
      row.push({ 
        text: `${plans[i + 1].nome} - R$ ${plans[i + 1].valor.toFixed(2)}`, 
        callback_data: `admin_add_vip_${adminId}_${targetUserId}_${plans[i + 1].id}` 
      });
    }
    keyboard.push(row);
  }
  
  keyboard.push([{ text: "❌ CANCELAR", callback_data: `mp_${adminId}` }]);
  
  return keyboard;
}

function activateVipPlan(userId, plan, adminId = null) {
  const expires = Date.now() + (plan.dias * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const isAdminAdd = adminId !== null;
  
  if (!usersCache[userId]) {
    usersCache[userId] = {
      username: '',
      registeredAt: now,
      vip: true,
      vipExpires: expires,
      vipLimit: plan.limite,
      vipUsed: 0,
      lastVipReset: null,
      vipResetDate: null,
      dailyRequests: 0,
      lastRequestDate: null,
      lastLikeTime: 0,
      totalRequests: 0,
      totalLikesSent: 0,
      vipTimes: 1,
      addedByAdmin: isAdminAdd ? adminId : 'system_payment',
      lastAdminAction: isAdminAdd ? {
        adminId: adminId,
        action: 'addvip',
        plan: plan.nome,
        timestamp: now
      } : {
        adminId: 'system_payment',
        action: 'payment_plan',
        plan: plan.nome,
        timestamp: now
      },
      blocked: false,
      blockedAt: 0,
      blockedBy: null,
      blockReason: '',
      lastPaymentRequest: now
    };
  } else {
    const wasVip = usersCache[userId].vip;
    const oldExpires = usersCache[userId].vipExpires || 0;
    let newExpires = expires;
    if (wasVip && oldExpires > now) newExpires = oldExpires + (plan.dias * 24 * 60 * 60 * 1000);
    
    usersCache[userId].vip = true;
    usersCache[userId].vipExpires = newExpires;
    usersCache[userId].vipLimit = plan.limite;
    usersCache[userId].vipUsed = 0;
    usersCache[userId].lastVipReset = null;
    usersCache[userId].vipTimes = (usersCache[userId].vipTimes || 0) + 1;
    usersCache[userId].addedByAdmin = isAdminAdd ? adminId : usersCache[userId].addedByAdmin;
    usersCache[userId].lastAdminAction = isAdminAdd ? {
      adminId: adminId,
      action: 'addvip',
      plan: plan.nome,
      timestamp: now
    } : {
      adminId: 'system_payment',
      action: 'payment_plan',
      plan: plan.nome,
      timestamp: now
    };
    usersCache[userId].lastPaymentRequest = now;
  }
  
  saveUsers();
  return true;
}

const pendingPaymentMessages = {};

function addPendingPaymentMessage(userId, chatId, messageId) {
  if (!pendingPaymentMessages[userId]) {
    pendingPaymentMessages[userId] = [];
  }
  
  const existing = pendingPaymentMessages[userId].find(msg => msg.messageId === messageId);
  if (!existing) {
    pendingPaymentMessages[userId].push({
      chatId: chatId,
      messageId: messageId,
      timestamp: Date.now()
    });
  }
}

async function clearPendingPaymentMessages(userId) {
  const pending = pendingPaymentMessages[userId];
  if (pending && pending.length > 0) {
    for (const msg of pending) {
      try {
        await deleteMessage(msg.chatId, msg.messageId);
      } catch {}
    }
    delete pendingPaymentMessages[userId];
  }
}

function getRegionsKeyboard(userId, uid) {
  if (LIKES_REGIONS.length === 0) return null;
  
  const keyboard = [];
  const buttonsPerRow = 2;
  
  for (let i = 0; i < LIKES_REGIONS.length; i += buttonsPerRow) {
    const row = [];
    for (let j = 0; j < buttonsPerRow && (i + j) < LIKES_REGIONS.length; j++) {
      const region = LIKES_REGIONS[i + j];
      row.push({
        text: region.name,
        callback_data: `region_${userId}_${uid}_${region.request}`
      });
    }
    if (row.length > 0) keyboard.push(row);
  }
  
  return keyboard;
}

function setupMainEventHandlers(botInstance) {
  bot = botInstance;

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }
    
    if (msg.chat.type !== 'private' && !shouldBotRespond(chatId)) {
      return;
    }

    if (isBlocked(userId)) {
      const blockedInfo = blockedUsersCache[userId];
      const msgData = messages.userBlocked(chatId, msg.message_id, userId, blockedInfo);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (!registerUser(userId, username)) return;

    const inlineKeyboard = buildMainStartInline(userId);

    const message = `<b><u>🌪️ | SEJA BEM-VINDO(A) USUÁRIO!</u></b>\n\n` +
      `<blockquote><b>🪐 | O que o bot pode entregar pro usuário?</b>\n` +
      `→ Este bot envia até 220 likes no Free Fire\n` +
      `→ Curtidas enviadas com contas guest\n` +
      `→ Sistema rápido, automático e seguro\n` +
      `→ Painel administrativo ativo\n` +
      `→ Funcionalidades avançadas</blockquote>\n\n` +
      `<b><u>☠️ | Botões de interações disponíveis abaixo.</u></b>`;

    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_to_message_id: msg.message_id,
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  });

  bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;

    try {
      if (!await checkAndUpdateBotPresence(chatId)) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ | Bot não está mais no grupo!",
          show_alert: true
        });
        return;
      }
      
      if (message.chat.type !== 'private' && !shouldBotRespond(chatId)) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ | Outro bot está respondendo neste grupo!",
          show_alert: true
        });
        return;
      }

      if (isBlocked(userId)) {
        const blockedInfo = blockedUsersCache[userId];
        const msgData = messages.userBlocked(chatId, message.message_id, userId, blockedInfo);
        await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      }

      if (data.startsWith('mp_')) {
        const targetUserId = data.replace('mp_', '');
        if (userId !== targetUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ Apenas o usuário que solicitou!",
            show_alert: true
          });
          return;
        }
        const inlineKeyboard = buildMainStartInline(userId);
        const messageText = `<b><u>🌪️ | SEJA BEM-VINDO(A) USUÁRIO!</u></b>\n\n` +
          `<blockquote><b>🪐 | O que o bot pode entregar pro usuário?</b>\n` +
          `→ Este bot envia até 220 likes no Free Fire\n` +
          `→ Curtidas enviadas com contas guest\n` +
          `→ Sistema rápido, automático e seguro\n` +
          `→ Painel administrativo ativo\n` +
          `→ Funcionalidades avançadas</blockquote>\n\n` +
          `<b><u>☠️ | Botões de interações disponíveis abaixo.</u></b>`;
        await safeEditMessageText(chatId, message.message_id, messageText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
        await bot.answerCallbackQuery(callbackQuery.id);
      
      } else if (data.startsWith('md_')) {
        const targetUserId = data.replace('md_', '');
        if (userId !== targetUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ Apenas o administrador pode acessar!",
            show_alert: true
          });
          return;
        }
        
        if (!isAdmin(userId)) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "❌ | Opção exclusiva para administradores!", show_alert: true });
          return;
        }
        const messageText = `<b><u>🫠 | BEM VINDO, ADMIN!</u></b>\n\n` +
          `<blockquote><b>😱 | Lista de comandos disponíveis:</b>\n` +
          `/addvip {ID} — Adicionar VIP\n` +
          `/delvip {ID} — Remover VIP\n` +
          `/checkvip {ID} — Verificar status VIP\n` +
          `/block {ID} {motivo} — Bloquear usuário\n` +
          `/desblock {ID} {motivo} — Desbloquear usuário\n` +
          `/not {mensagem} — Envio de anúncios\n` +
          `/stats — Estatísticas gerais do bot</blockquote>\n\n` +
          `<b><u>⚙️ | Utilize este painel com responsabilidade.</u></b>`;
        await safeEditMessageText(chatId, message.message_id, messageText, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: "↩️ | VOLTAR", callback_data: `mp_${userId}` }]
            ]
          }
        });
        await bot.answerCallbackQuery(callbackQuery.id);
      
      } else if (data.startsWith('mh_')) {
        const targetUserId = data.replace('mh_', '');
        if (userId !== targetUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "❌ Apenas o usuário que solicitou!", show_alert: true });
          return;
        }
        const user = usersCache[userId] || {};
        const isUserVip = isVip(userId);
        const isUserAdmin = isAdmin(userId);
        const registrationDate = user.registeredAt ? new Date(user.registeredAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'N/A';
        const daysRegistered = user.registeredAt ? Math.ceil((Date.now() - user.registeredAt) / (1000 * 60 * 60 * 24)) : 0;

        let historicoMessage = `<b><u>📊 | PERFIL DO USUÁRIO</u></b>\n\n` +
          `<blockquote><b>→ Informações da conta:</b>\n` +
          `<b> ↳ Seu ID:</b> <code>${userId}</code>\n`;

        if (user.username) historicoMessage += `<b> ↳ Username:</b> @${user.username}\n`;
        historicoMessage += `<b> ↳ Registro:</b> ${registrationDate} (há ${daysRegistered} dias)\n`;

        if (isUserAdmin) {
          historicoMessage += `<b> ↳ Status:</b> <code>👑 ADMIN (acesso total)</code>\n`;
        } else if (isUserVip) {
          const daysLeft = getVipDaysLeft(userId);
          const vipExpiration = new Date(user.vipExpires).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          const vipLimit = user.vipLimit ? `${user.vipLimit} por dia` : 'Ilimitado';
          const vipUsedToday = user.vipUsed || 0;
          historicoMessage += `<b> ↳ Status:</b> <code>VIP ATIVO ✅</code>\n` +
            `<b> ↳ Dias restantes:</b> <code>${daysLeft} dias</code>\n` +
            `<b> ↳ Limite diário:</b> <code>${vipLimit}</code>\n` +
            `<b> ↳ Usado hoje:</b> <code>${vipUsedToday}</code>\n` +
            `<b> ↳ Expira em:</b> <code>${vipExpiration}</code>\n` +
            `<b> ↳ Vezes VIP:</b> <code>${user.vipTimes || 0} vezes</code>\n`;
        } else {
          historicoMessage += `<b> ↳ Status:</b> <code>ACESSO VIP NECESSÁRIO ❌</code>\n`;
        }

        historicoMessage += `<b> ↳ Total de /like:</b> <code>${user.totalRequests || 0} vezes</code>\n` +
          `<b> ↳ Total likes enviados:</b> <code>${user.totalLikesSent || 0}</code>\n` +
          `</blockquote>\n\n` +
          `<b><u>⏳ | Histórico desde seu primeiro acesso.</u></b>`;

        const inlineKeyboard = [
          [{ text: "↩️ | VOLTAR", callback_data: `mp_${userId}` }]
        ];

        await safeEditMessageText(chatId, message.message_id, historicoMessage, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });

        await bot.answerCallbackQuery(callbackQuery.id);
      
      } else if (data.startsWith('region_')) {
        const parts = data.split('_');
        if (parts.length !== 4) return;
        const callbackUserId = parts[1];
        const uid = parts[2];
        const selectedRegion = parts[3];
        
        if (userId !== callbackUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "❌ Apenas o usuário que solicitou!",
            show_alert: true 
          });
          return;
        }

        const user = usersCache[userId];
        const canRequest = canUserRequest(userId, chatId);
        
        if (!canRequest.can) {
          if (canRequest.reason === 'no_access') {
            const msgData = messages.vipOnly(chatId, userId, message.message_id);
            await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
          } else if (canRequest.reason === 'vip_limit_reached') {
            const msgData = messages.vipLimitReached(chatId, message.message_id, canRequest.limit, canRequest.used);
            await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
          }
          await bot.answerCallbackQuery(callbackQuery.id);
          return;
        }

        const stats = queueSystem.getStats();
        if (stats.total >= MAX_QUEUE_SIZE) {
          await safeEditMessageText(chatId, message.message_id, messages.queueFull(chatId, message.message_id).text, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: BUTTON_TEXT, url: BUTTON_URL }
              ]]
            }
          });
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "❌ | Fila cheia! Tente novamente mais tarde.", 
            show_alert: false 
          });
          return;
        }

        const regionObj = LIKES_REGIONS.find(r => r.request === selectedRegion);
        if (!regionObj) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Região não encontrada!",
            show_alert: false
          });
          return;
        }

        const requestId = generateRequestId(userId, uid);
        const regionName = regionObj.name;
        const queueItem = {
          chatId,
          uid,
          requestId,
          userId,
          username: user?.username || '',
          messageId: message.message_id,
          totalRequests: user ? user.totalRequests : 0,
          isVip: canRequest.type === 'vip',
          isGroup: false,
          region: selectedRegion,
          regionName: regionName,
          addedAt: Date.now()
        };

        if (!queueSystem.add(queueItem)) {
          await safeEditMessageText(chatId, message.message_id, messages.queueFull(chatId, message.message_id).text, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: BUTTON_TEXT, url: BUTTON_URL }
              ]]
            }
          });
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Erro ao adicionar à fila!",
            show_alert: false
          });
          return;
        }

        saveQueueToStorage();

        const position = queueSystem.getPosition(requestId);
        const userLimit = user && user.vipLimit ? user.vipLimit : 'Ilimitado';
        const msgData = messages.requestReceived(
          chatId, message.message_id, uid, regionName, userLimit, position, 
          stats.total + 1, user?.username || '', user ? user.totalRequests : 0, 0
        );

        await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);

        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "✅ | Região selecionada! Pedido na fila.",
          show_alert: false
        });

        processQueue();

      } else if (data.startsWith('show_plans_')) {
        const targetUserId = data.replace('show_plans_', '');
        if (userId !== targetUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Apenas quem solicitou pode ver planos",
            show_alert: true
          });
          return;
        }

        const plans = paymentSystem.getAllPlans();
        const keyboard = buildPlansKeyboard(userId, plans);
        
        const msgData = messages.vipOnly(chatId, userId, message.message_id);
        await safeEditMessageText(chatId, message.message_id, msgData.text, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });

        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "📋 | Planos carregados!",
          show_alert: false
        });

      } else if (data.startsWith('select_plan_')) {
        const parts = data.split('_');
        if (parts.length < 4) return;
        
        const targetUserId = parts[2];
        const planId = parts.slice(3).join('_');
        
        if (userId !== targetUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Apenas quem solicitou pode gerar pagamentos",
            show_alert: true
          });
          return;
        }

        const user = usersCache[userId];
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        if (user && user.lastPaymentRequest && (now - user.lastPaymentRequest < fiveMinutes)) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "🙄 | Você gerou pagamento recentemente, aguarde no mínimo 5 minutos.",
            show_alert: true
          });
          return;
        }

        const plan = paymentSystem.getPlanById(planId);
        if (!plan) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Plano não encontrado",
            show_alert: true
          });
          return;
        }

        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "⏳ | Gerando pagamento...",
          show_alert: false
        });

        try {
          const paymentResult = await paymentSystem.createPayment(userId, planId);
          
          if (paymentResult.success) {
            if (user) {
              user.lastPaymentRequest = now;
              saveUsers();
            }
            
            addPendingPaymentMessage(userId, chatId, message.message_id);
            
            const msgData = messages.paymentGenerated(chatId, message.message_id, userId, plan, paymentResult.copyPasteCode);
            await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
            
            paymentSystem.startPaymentMonitoring(paymentResult.transactionId, async (result) => {
              if (result.status === 'COMPLETO') {
                activateVipPlan(userId, plan, null);
                const msgData = messages.paymentSuccess(chatId, message.message_id, userId, plan, usersCache[userId].vipTimes);
                await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
              } else if (result.status === 'TIMEOUT' || result.status === 'FALHA') {
                await clearPendingPaymentMessages(userId);
              }
            });
          } else {
            await safeEditMessageText(chatId, message.message_id, "❌ | Erro ao gerar pagamento. Tente novamente.", {
              parse_mode: 'HTML'
            });
          }
        } catch (error) {
          await safeEditMessageText(chatId, message.message_id, `❌ | Erro: ${error.message}`, {
            parse_mode: 'HTML'
          });
        }

      } else if (data.startsWith('cancel_payment_')) {
        const targetUserId = data.replace('cancel_payment_', '');
        if (userId !== targetUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Apenas quem solicitou pode cancelar",
            show_alert: true
          });
          return;
        }

        const activePayment = paymentSystem.getUserActivePayment(userId);
        if (activePayment) {
          paymentSystem.cancelPayment(activePayment.transactionId);
        }

        await clearPendingPaymentMessages(userId);
        await bot.answerCallbackQuery(callbackQuery.id);

      } else if (data.startsWith('admin_add_vip_')) {
        const parts = data.split('_');
        if (parts.length < 6) return;
        
        const adminUserId = parts[3];
        const targetUserId = parts[4];
        const planId = parts.slice(5).join('_');
        
        if (userId !== adminUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Apenas o administrador pode adicionar VIP",
            show_alert: true
          });
          return;
        }
        
        if (!isAdmin(adminUserId)) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Você não é administrador",
            show_alert: true
          });
          return;
        }

        const plan = paymentSystem.getPlanById(planId);
        if (!plan) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Plano não encontrado",
            show_alert: true
          });
          return;
        }

        if (!usersCache[targetUserId]) {
          registerUser(targetUserId, '');
        }

        if (!usersCache[targetUserId].addedByAdmin || usersCache[targetUserId].addedByAdmin === adminUserId || LIST_OWNERS.indexOf(adminUserId) === 0) {
          activateVipPlan(targetUserId, plan, adminUserId);
          logAdminAction(adminUserId, 'addvip', targetUserId, { plan: plan.nome, days: plan.dias, limit: plan.limite });

          const msgData = messages.adminVipAdded(chatId, message.message_id, targetUserId, plan);
          await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);

          await bot.answerCallbackQuery(callbackQuery.id, {
            text: `✅ | VIP ${plan.nome} adicionado com sucesso!`,
            show_alert: false
          });
        } else {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ | Você não pode gerenciar este usuário",
            show_alert: true
          });
        }

      } else if (data.startsWith('div_confirm_')) {
        const adminId = data.replace('div_confirm_', '');
        if (userId !== adminId) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "❌ | Apenas o administrador que criou pode confirmar.", 
            show_alert: true 
          });
          return;
        }
        const messageText = broadcastsPending[adminId];
        if (!messageText) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "❌ | Mensagem não encontrada ou expirada.", 
            show_alert: true 
          });
          return;
        }
        let totalSent = 0;
        let totalFailed = 0;
        const userIds = Object.keys(usersCache);
        for (const uid of userIds) {
          try {
            const u = usersCache[uid];
            const sendResult = await safeSendMessage(uid, messageText, { parse_mode: 'HTML' });
            if (sendResult) totalSent++; else totalFailed++;
          } catch {
            totalFailed++;
          }
        }
        delete broadcastsPending[adminId];
        const msgData = messages.divConfirmed(chatId, message.message_id, totalSent, totalFailed);
        await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
        await bot.answerCallbackQuery(callbackQuery.id);
      
      } else if (data.startsWith('div_cancel_')) {
        const adminId = data.replace('div_cancel_', '');
        if (userId !== adminId) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "❌ | Apenas o administrador que criou pode cancelar.", 
            show_alert: true 
          });
          return;
        }
        delete broadcastsPending[adminId];
        const msgData = messages.divCancelled(chatId, message.message_id);
        await safeEditMessageText(chatId, message.message_id, msgData.text, msgData.options);
        await bot.answerCallbackQuery(callbackQuery.id);
      
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "ℹ️ | Ação desconhecida.", 
          show_alert: false 
        });
      }
    } catch (error) {
      console.error('Erro no callback:', error);
      await bot.answerCallbackQuery(callbackQuery.id, { 
        text: "❌ | Ocorreu um erro ao processar sua solicitação!", 
        show_alert: false 
      });
    }
  });

  bot.onText(/\/like/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }
    
    if (msg.chat.type !== 'private' && !shouldBotRespond(chatId)) {
      return;
    }

    if (isBlocked(userId)) {
      const blockedInfo = blockedUsersCache[userId];
      const msgData = messages.userBlocked(chatId, msg.message_id, userId, blockedInfo);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (!registerUser(userId, username)) return;

    const match = msg.text.match(/\/like (.+)/);
    if (!match) {
      const canRequest = canUserRequest(userId, chatId);
      if (canRequest.can || isAdmin(userId)) {
        const msgData = messages.invalidUsage(chatId, msg.message_id);
        safeSendMessage(chatId, msgData.text, msgData.options);
      } else {
        const msgData = messages.vipOnly(chatId, userId, msg.message_id);
        safeSendMessage(chatId, msgData.text, msgData.options);
      }
      return;
    }

    const uid = match[1].trim();
    if (!uid || isNaN(uid)) {
      const canRequest = canUserRequest(userId, chatId);
      if (canRequest.can || isAdmin(userId)) {
        const msgData = messages.invalidUsage(chatId, msg.message_id);
        safeSendMessage(chatId, msgData.text, msgData.options);
      } else {
        const msgData = messages.vipOnly(chatId, userId, msg.message_id);
        safeSendMessage(chatId, msgData.text, msgData.options);
      }
      return;
    }

    if (!canSendLikesToPlayer(uid)) {
      const player = playersCache[uid];
      const playerName = player ? player.playerName : 'N/A';
      const now = Date.now();
      const lastRequestTime = player ? player.lastRequestTime : now;
      const nextAvailableTime = lastRequestTime + PLAYER_COOLDOWN_MS;
      const timeRemainingMs = nextAvailableTime - now;
      const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
      const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeRemainingMs % (1000 * 60)) / 1000);
      const timeRemaining = `${hours}h ${minutes}m ${seconds}s`;
      const msgData = messages.playerRecentLikes(chatId, msg.message_id, playerName, timeRemaining);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const canRequest = canUserRequest(userId, chatId);
    if (!canRequest.can) {
      if (canRequest.reason === 'blocked') return;
      else if (canRequest.reason === 'no_access') {
        const msgData = messages.vipOnly(chatId, userId, msg.message_id);
        safeSendMessage(chatId, msgData.text, msgData.options);
      } else if (canRequest.reason === 'vip_limit_reached') {
        const msgData = messages.vipLimitReached(chatId, msg.message_id, canRequest.limit, canRequest.used);
        safeSendMessage(chatId, msgData.text, msgData.options);
      }
      return;
    }

    const stats = queueSystem.getStats();
    if (stats.total >= MAX_QUEUE_SIZE) {
      const msgData = messages.queueFull(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const keyboard = getRegionsKeyboard(userId, uid);
    if (!keyboard || keyboard.length === 0) {
      safeSendMessage(chatId, `<b><u>❌ | ERRO AO CARREGAR REGIÕES!</u></b>`, {
        parse_mode: 'HTML',
        reply_to_message_id: msg.message_id
      });
      return;
    }

    const regionMessage = `<b><u>🙀 | Selecione abaixo a região da sua conta!</u></b>`;

    safeSendMessage(chatId, regionMessage, {
      parse_mode: 'HTML',
      reply_to_message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/addvip/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    registerUser(userId, username);

    const match = msg.text.match(/\/addvip (.+)/);
    if (!match) {
      const msgData = messages.addvipUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const targetUserId = match[1].trim();

    if (!targetUserId) {
      const msgData = messages.addvipInvalid(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (!usersCache[targetUserId]) {
      registerUser(targetUserId, '');
    }

    const plans = paymentSystem.getAllPlans();
    const keyboard = buildAdminPlansKeyboard(userId, targetUserId, plans);
    
    const messageText = `<b><u>🎫 | SELECIONE UM PLANO PARA ${targetUserId}</u></b>\n\n` +
      `<blockquote><b>→ Planos disponíveis:</b>\n` +
      `• Cada plano tem um limite diário específico\n` +
      `• Os dias são somados ao VIP atual\n` +
      `• O usuário receberá notificação</blockquote>\n\n` +
      `<b><u>👇 | Clique no plano desejado abaixo.</u></b>`;

    safeSendMessage(chatId, messageText, {
      parse_mode: 'HTML',
      reply_to_message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/delvip/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    registerUser(userId, username);

    const match = msg.text.match(/\/delvip (.+)/);
    if (!match) {
      const msgData = messages.delvipUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const targetUserId = match[1].trim();

    if (!targetUserId) {
      const msgData = messages.delvipInvalid(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (usersCache[targetUserId]) {
      usersCache[targetUserId].vip = false;
      usersCache[targetUserId].vipExpires = 0;
      usersCache[targetUserId].vipLimit = null;
      usersCache[targetUserId].vipUsed = 0;
      usersCache[targetUserId].lastVipReset = null;
      usersCache[targetUserId].lastAdminAction = {
        adminId: userId,
        action: 'delvip',
        timestamp: Date.now()
      };

      saveUsers();
      logAdminAction(userId, 'delvip', targetUserId);

      const msgData = messages.vipRemoved(chatId, msg.message_id, targetUserId);
      safeSendMessage(chatId, msgData.text, msgData.options);
    } else {
      const msgData = messages.userNotFound(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
    }
  });

  bot.onText(/\/checkvip/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const match = msg.text.match(/\/checkvip (.+)/);
    if (!match) {
      const msgData = messages.invalidUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const targetUserId = match[1].trim();
    const user = usersCache[targetUserId];

    if (!user) {
      const msgData = messages.userNotFound(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const isUserVip = user.vip && user.vipExpires > Date.now();
    const vipDaysLeft = isUserVip ? Math.ceil((user.vipExpires - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
    const vipExpiration = isUserVip ? new Date(user.vipExpires).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'N/A';
    const vipLimit = user.vipLimit ? `${user.vipLimit} por dia` : 'Ilimitado';
    const vipUsedToday = user.vipUsed || 0;
    const addedBy = user.addedByAdmin || 'Nenhum admin registrado';

    let message = `<b>🔍 | INFORMAÇÕES DO USUÁRIO</b>\n\n` +
      `• ID: <code>${targetUserId}</code>\n`;

    if (user.username) message += `• Username: @${user.username}\n`;

    message += `• Status VIP: <b>${isUserVip ? 'ATIVO ✅' : 'INATIVO ❌'}</b>\n` +
      `• Dias VIP restantes: <b>${vipDaysLeft} dias</b>\n` +
      `• Limite diário: <b>${vipLimit}</b>\n` +
      `• Usado hoje: <b>${vipUsedToday}</b>\n` +
      `• Expiração: <b>${vipExpiration}</b>\n` +
      `• Adicionado por: <code>${addedBy}</code>\n` +
      `• Total de pedidos: <b>${user.totalRequests || 0}</b>\n` +
      `• Likes enviados: <b>${user.totalLikesSent || 0}</b>\n` +
      `• Vezes VIP: <b>${user.vipTimes || 0}</b>\n`;

    if (user.lastAdminAction) {
      const actionDate = new Date(user.lastAdminAction.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      message += `• Última ação: <b>${user.lastAdminAction.action}</b> em ${actionDate}\n`;
    }

    safeSendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_to_message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[
          { text: BUTTON_TEXT, url: BUTTON_URL }
        ]]
      }
    });
  });

  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    let totalUsers = Object.keys(usersCache).length;
    let vipUsers = 0;
    let activeUsersToday = 0;
    let totalLikesSent = 0;
    let totalRequests = 0;
    let blockedUsers = Object.keys(blockedUsersCache).length;

    const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    for (const id in usersCache) {
      const user = usersCache[id];
      if (user.vip && user.vipExpires > Date.now()) vipUsers++;
      if (user.lastRequestDate === today) activeUsersToday++;
      totalLikesSent += user.totalLikesSent || 0;
      totalRequests += user.totalRequests || 0;
    }

    const queueStats = queueSystem.getStats();

    const message = `<b>📊 | ESTATÍSTICAS DO BOT</b>\n\n` +
      `• Usuários totais: <b>${totalUsers}</b>\n` +
      `• Usuários VIP ativos: <b>${vipUsers}</b>\n` +
      `• Usuários ativos hoje: <b>${activeUsersToday}</b>\n` +
      `• Usuários bloqueados: <b>${blockedUsers}</b>\n` +
      `• Total de pedidos: <b>${totalRequests}</b>\n` +
      `• Total de likes enviados: <b>${totalLikesSent}</b>\n` +
      `• Jogadores únicos: <b>${Object.keys(playersCache).length}</b>\n` +
      `• Fila atual: <b>${queueStats.waiting} esperando</b>\n` +
      `• Processando: <b>${queueStats.processing} pedidos</b>\n` +
      `• Capacidade: <b>${queueStats.processing}/${queueStats.maxConcurrent} slots</b>\n\n` +
      `<i>Estatísticas atualizadas em tempo real</i>`;

    safeSendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_to_message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[
          { text: BUTTON_TEXT, url: BUTTON_URL }
        ]]
      }
    });
  });

  bot.onText(/\/not/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    registerUser(userId, username);

    const match = msg.text.match(/\/not (.+)/s);
    if (!match) {
      const msgData = messages.divUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const messageText = match[1].trim();
    if (!messageText || messageText.length < 3) {
      const msgData = messages.divUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    broadcastsPending[userId] = messageText;
    const msgData = messages.divPreview(chatId, msg.message_id, messageText, userId);
    safeSendMessage(chatId, msgData.text, msgData.options);
  });

  bot.onText(/\/block/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    registerUser(userId, username);

    const match = msg.text.match(/\/block (.+) (.+)/s);
    if (!match) {
      const msgData = messages.blockUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const targetUserId = match[1].trim();
    const reason = match[2].trim();

    if (!targetUserId) {
      const msgData = messages.blockInvalid(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (isAdmin(targetUserId)) {
      const msgData = messages.cannotBlockAdmin(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (isBlocked(targetUserId)) {
      const msgData = messages.alreadyBlocked(chatId, msg.message_id, targetUserId);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (blockUser(targetUserId, userId, reason)) {
      const msgData = messages.blockSuccess(chatId, msg.message_id, targetUserId, reason);
      safeSendMessage(chatId, msgData.text, msgData.options);
    }
  });

  bot.onText(/\/desblock/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    if (!await checkAndUpdateBotPresence(chatId)) {
      return;
    }

    if (!isAdmin(userId)) {
      const msgData = messages.ownerOnly(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    registerUser(userId, username);

    const match = msg.text.match(/\/desblock (.+)/);
    if (!match) {
      const msgData = messages.unblockUsage(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    const targetUserId = match[1].trim();
    if (!targetUserId) {
      const msgData = messages.unblockInvalid(chatId, msg.message_id);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (!isBlocked(targetUserId)) {
      const msgData = messages.notBlocked(chatId, msg.message_id, targetUserId);
      safeSendMessage(chatId, msgData.text, msgData.options);
      return;
    }

    if (unblockUser(targetUserId, userId, '')) {
      const msgData = messages.unblockSuccess(chatId, msg.message_id, targetUserId);
      safeSendMessage(chatId, msgData.text, msgData.options);
    }
  });

  bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
  });
  
  bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error);
  });
  
  bot.on('error', (error) => {
    console.error('Bot error:', error);
  });
}

(async function init() {
  loadAllData();

  const botInstance = new TelegramBot(token, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 }
    }
  });

  setupMainEventHandlers(botInstance);

  checkExpiredVips();
  cleanupOldRequests();
  processQueue();

  console.log(`[INFO] Bot principal inicializado com sucesso!`);

  cron.schedule('*/2 * * * * *', () => {
    processQueue();
  });

  cron.schedule('0 0 * * *', async () => {
    checkExpiredVips();
    cleanupOldRequests();
    queueSystem.cleanup();
    saveQueueToStorage();
  });

})();