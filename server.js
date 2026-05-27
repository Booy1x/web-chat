const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Redis = require('ioredis');

const MAX_CONNECTIONS = 10;
const ACCESS_CODE = process.env.ACCESS_CODE || '';

// Rate limiting for /api/verify
const MAX_FAILS = 5;
const BAN_DURATION = 5 * 60 * 1000; // 5 minutes
const verifyFails = new Map(); // ip -> { count, bannedUntil }

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => console.error('Redis error:', err.message));

// In-memory room cache
// Each room: { name, password, messages[] }
let rooms = new Map();

// Unified presence tracking
// presence: Map<socketId, { username, room }>
// users:    Map<username, Set<socketId>> (reverse index)
let presence = new Map();
let users = new Map();

async function loadRooms() {
  const data = await redis.hgetall('rooms');
  for (const [name, json] of Object.entries(data)) {
    rooms.set(name, JSON.parse(json));
  }
  console.log(`Loaded ${rooms.size} rooms from Redis`);
}

async function saveRoom(name) {
  const room = rooms.get(name);
  if (!room) return;
  await redis.hset('rooms', name, JSON.stringify(room));
}

async function init() {
  await loadRooms();
  if (!rooms.has('general')) {
    rooms.set('general', { name: 'general', password: '', messages: [] });
    await saveRoom('general');
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/verify', (req, res) => {
  if (!ACCESS_CODE) return res.json({ ok: true });

  const ip = req.ip;
  const record = verifyFails.get(ip);

  // Check if banned
  if (record && record.bannedUntil > Date.now()) {
    const remainSec = Math.ceil((record.bannedUntil - Date.now()) / 1000);
    return res.status(429).json({ ok: false, error: `too many attempts, try again in ${remainSec}s` });
  }

  // Check password
  if (req.body.code === ACCESS_CODE) {
    verifyFails.delete(ip);
    return res.json({ ok: true });
  }

  // Record failure
  const fails = (record && record.bannedUntil <= Date.now()) ? 1 : (record ? record.count + 1 : 1);
  verifyFails.set(ip, {
    count: fails,
    bannedUntil: fails >= MAX_FAILS ? Date.now() + BAN_DURATION : 0
  });

  res.status(401).json({ ok: false });
});

app.get('/api/rooms', (req, res) => {
  res.json(getRoomList());
});

// Socket.IO
io.on('connection', (socket) => {
  if (io.engine.clientsCount > MAX_CONNECTIONS) {
    socket.emit('error_msg', 'server is full');
    socket.disconnect(true);
    return;
  }

  // Register user globally, kick duplicate logins
  socket.on('set username', (name) => {
    name = (name || '').trim();
    if (!name) return;

    // Kick old sockets with same username
    if (users.has(name)) {
      for (const oldId of users.get(name)) {
        if (oldId === socket.id) continue;
        const oldSocket = io.sockets.sockets.get(oldId);
        if (oldSocket) {
          oldSocket.emit('kicked');
          oldSocket.disconnect(true);
        }
      }
    }

    // Register in unified presence
    presence.set(socket.id, { username: name, room: null });
    if (!users.has(name)) users.set(name, new Set());
    users.get(name).add(socket.id);

    io.emit('global user list', getGlobalUserList());
  });

  socket.on('create room', async ({ name, password }) => {
    name = (name || '').trim();
    if (!name) return socket.emit('room error', 'room name required');
    if (name.length > 30) return socket.emit('room error', 'name too long (max 30)');
    if (rooms.has(name)) return socket.emit('room error', 'room already exists');

    rooms.set(name, { name, password: password || '', messages: [] });
    await saveRoom(name);
    io.emit('room list', getRoomList());
  });

  socket.on('join room', async ({ name, password, user }) => {
    const room = rooms.get(name);
    if (!room) return socket.emit('room error', 'room not found');
    if (room.password && room.password !== password) {
      return socket.emit('room error', 'wrong password');
    }

    const p = presence.get(socket.id);
    if (!p) return socket.emit('room error', 'not logged in');
    if (!(user || '').trim()) return socket.emit('room error', 'username required');

    // Leave previous room
    if (p.room) {
      const prevRoom = p.room;
      socket.leave(prevRoom);
      p.room = null;
      broadcastRoom(prevRoom);
    }

    p.room = name;
    socket.join(name);

    const userList = getRoomUserList(name);
    socket.emit('room joined', {
      name,
      messages: room.messages.slice(-100),
      onlineCount: userList.length,
      users: userList
    });
    io.to(name).emit('online', userList.length);
    io.to(name).emit('user list', userList);
    io.emit('room list', getRoomList());
  });

  socket.on('leave room', () => {
    const p = presence.get(socket.id);
    if (!p || !p.room) return;
    const prevRoom = p.room;
    socket.leave(prevRoom);
    p.room = null;
    broadcastRoom(prevRoom);
  });

  socket.on('chat message', async (data) => {
    const p = presence.get(socket.id);
    if (!p || !p.room) return socket.emit('error_msg', 'join a room first');
    const user = (data.user || '').trim();
    const content = (data.content || '').trim();
    if (!user || !content) return;

    const room = rooms.get(p.room);
    if (!room) return;

    const msg = { user, content, created_at: new Date().toISOString() };
    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);

    io.to(p.room).emit('chat message', msg);
    await saveRoom(p.room);
  });

  socket.on('clear messages', async (roomName) => {
    const room = rooms.get(roomName);
    if (!room) return;
    room.messages = [];
    await saveRoom(roomName);
    io.to(roomName).emit('messages cleared');
    io.emit('room list', getRoomList());
  });

  socket.on('delete room', async (roomName) => {
    if (roomName === 'general') return socket.emit('room error', 'cannot delete general');
    if (!rooms.has(roomName)) return;
    rooms.delete(roomName);
    await redis.hdel('rooms', roomName);
    io.to(roomName).emit('room deleted');
    io.emit('room list', getRoomList());
  });

  socket.on('disconnect', () => {
    const p = presence.get(socket.id);
    if (!p) return;

    // Clean up presence
    presence.delete(socket.id);
    if (users.has(p.username)) {
      users.get(p.username).delete(socket.id);
      if (users.get(p.username).size === 0) users.delete(p.username);
    }

    // Broadcast room leave if was in a room
    if (p.room) broadcastRoom(p.room);
    io.emit('global user list', getGlobalUserList());
  });
});

// Broadcast updated user list and count to a room
function broadcastRoom(roomName) {
  const list = getRoomUserList(roomName);
  io.to(roomName).emit('online', list.length);
  io.to(roomName).emit('user list', list);
  io.emit('room list', getRoomList());
}

// Get unique sorted usernames in a room
function getRoomUserList(roomName) {
  const seen = new Set();
  const result = [];
  for (const [, p] of presence) {
    if (p.room === roomName && !seen.has(p.username)) {
      seen.add(p.username);
      result.push(p.username);
    }
  }
  return result.sort().map(name => ({ name }));
}

// Get unique sorted usernames globally
function getGlobalUserList() {
  return Array.from(users.keys()).sort().map(name => ({ name }));
}

// Get room list with online counts
function getRoomList() {
  const list = [];
  for (const [name, room] of rooms) {
    list.push({
      name,
      hasPassword: !!room.password,
      onlineCount: getRoomUserList(name).length,
      messageCount: room.messages.length
    });
  }
  return list;
}

// Graceful shutdown
process.on('SIGTERM', async () => { await redis.quit(); process.exit(0); });
process.on('SIGINT', async () => { await redis.quit(); process.exit(0); });

const PORT = process.env.PORT || 3000;
init().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
