const { RateLimiter } = require('limiter');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');
const tokenkey = "d8ce40604d359eeb9f2bff31beca4b4b";

const server = http.createServer();
const wss = new WebSocket.Server({ noServer: true });

const globalChatPlayers = new Map();
const chatHistory = [];
const maxMessages = 4;
const maxMessageLength = 100;
const allowedOrigins = [
  "https://uploads.ungrounded.net", "https://slcount.netlify.app", "https://s-r.netlify.app", 
  "https://serve.gamejolt.net", "null", "tw-editor://.", "http://serve.gamejolt.net", 
  "https://www.newgrounds.com/portal/view/5561763", "https://prod-dpgames.crazygames.com", 
  "https://crazygames.com/game/skilled-royale", "https://html-classic.itch.zone", "https://turbowarp.org"
];

const connectionRate = 1, connectionBurst = 1, connectionInterval = 2000, messageRate = 1, messageBurst = 1;
const tokenBucket = new RateLimiter({ tokensPerInterval: connectionRate, interval: connectionInterval, maxBurst: connectionBurst });
const messageTokenBucket = new RateLimiter({ tokensPerInterval: messageRate, interval: 'second', maxBurst: messageBurst });

const joinGlobalChat = (ws, token) => {
  try {
    const { username: playerId } = jwt.verify(token, tokenkey);
    if (!playerId || globalChatPlayers.has(playerId)) return ws.close(4003, 'Duplicate player ID');
    
    globalChatPlayers.set(playerId, { ws });
    ws.send(JSON.stringify({ type: 'chat', msg: chatHistory, ccu: globalChatPlayers.size }));
    const timestamp = new Date().toLocaleTimeString();
    chatHistory.push({ id: chatHistory.length + 1, t: timestamp, p: 'system', m: `${playerId} has joined the chat.` });

    if (chatHistory.length > maxMessages) chatHistory.splice(0, chatHistory.length - maxMessages);
    for (const player of globalChatPlayers.values()) player.ws.send(JSON.stringify({ type: 'chat', msg: chatHistory, ccu: globalChatPlayers.size }));
    
    return playerId;
  } catch (error) {
    ws.close(4000, 'Token verification error');
  }
};

const broadcastGlobal = (playerId, message) => {
  const messageString = message.trim();
  if (messageString.length === 0 || messageString.length > maxMessageLength || !messageTokenBucket.tryRemoveTokens(1)) return;

  const filteredMessage = messageString.includes('badword') ? 'Filtered message' : messageString;
  const timestamp = new Date().toLocaleTimeString();
  chatHistory.push({ id: chatHistory.length + 1, t: timestamp, p: playerId, m: filteredMessage });

  if (chatHistory.length > maxMessages) chatHistory.splice(0, chatHistory.length - maxMessages);
  for (const player of globalChatPlayers.values()) player.ws.send(JSON.stringify({ type: 'chat', msg: chatHistory, ccu: globalChatPlayers.size }));
};

wss.on('connection', (ws, req) => {
  const token = req.url.slice(1), ip = req.headers['true-client-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (!allowedOrigins.includes(req.headers.origin)) return ws.close(4004, 'Unauthorized origin');

  if (tokenBucket.tryRemoveTokens(1)) {
    joinGlobalChat(ws, token)?.then((playerId) => {
      if (!playerId) return;
      ws.on('message', (message) => {
        try { const data = JSON.parse(message); if (data.type === 'chat') broadcastGlobal(playerId, data.message); } 
        catch (error) { console.error('Error handling message:', error); }
      });
      ws.on('close', () => { globalChatPlayers.delete(playerId); });
    });
  } else {
    ws.close(4002, 'Connection rate-limited. Too many connections in a short period.');
  }
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

server.listen(process.env.PORT || 3000, () => console.log(`Server is listening on port ${process.env.PORT || 3000}`));
