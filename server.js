const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Redis = require('ioredis');

const MAX_CONNECTIONS = 10;
const ACCESS_CODE = process.env.ACCESS_CODE || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => console.error('Redis error:', err.message));

// In-memory room cache: Map<string, { name, password, messages[], onlineCount }>
let rooms = new Map();

async function loadRooms() {
  const data = await redis.hgetall('rooms');
  for (const [name, json] of Object.entries(data)) {
    const room = JSON.parse(json);
    room.onlineCount = 0;
    rooms.set(name, room);
  }
  console.log(`Loaded ${rooms.size} rooms from Redis`);
}

async function saveRoom(name) {
  const room = rooms.get(name);
  if (!room) return;
  const { onlineCount, ...data } = room;
  await redis.hset('rooms', name, JSON.stringify(data));
}

async function init() {
  await loadRooms();
  // Default room
  if (!rooms.has('general')) {
    rooms.set('general', { name: 'general', password: '', messages: [], onlineCount: 0 });
    await saveRoom('general');
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/verify', (req, res) => {
  if (!ACCESS_CODE) return res.json({ ok: true });
  if (req.body.code === ACCESS_CODE) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const [name, room] of rooms) {
    list.push({
      name,
      hasPassword: !!room.password,
      onlineCount: room.onlineCount,
      messageCount: room.messages.length
    });
  }
  res.json(list);
});

// Socket.IO
io.on('connection', (socket) => {
  let currentRoom = null;

  if (io.engine.clientsCount > MAX_CONNECTIONS) {
    socket.emit('error_msg', 'server is full');
    socket.disconnect(true);
    return;
  }

  socket.on('create room', async ({ name, password }) => {
    name = (name || '').trim();
    if (!name) return socket.emit('room error', 'room name required');
    if (name.length > 30) return socket.emit('room error', 'name too long (max 30)');
    if (rooms.has(name)) return socket.emit('room error', 'room already exists');

    rooms.set(name, { name, password: password || '', messages: [], onlineCount: 0 });
    await saveRoom(name);
    io.emit('room list', getRoomList());
  });

  socket.on('join room', async ({ name, password }) => {
    const room = rooms.get(name);
    if (!room) return socket.emit('room error', 'room not found');
    if (room.password && room.password !== password) {
      return socket.emit('room error', 'wrong password');
    }

    // Leave previous room
    if (currentRoom) {
      socket.leave(currentRoom);
      const prev = rooms.get(currentRoom);
      if (prev) {
        prev.onlineCount = Math.max(0, prev.onlineCount - 1);
        io.to(currentRoom).emit('online', prev.onlineCount);
      }
    }

    currentRoom = name;
    socket.join(name);
    room.onlineCount++;

    socket.emit('room joined', {
      name,
      messages: room.messages.slice(-100),
      onlineCount: room.onlineCount
    });
    io.to(name).emit('online', room.onlineCount);
    io.emit('room list', getRoomList());
  });

  socket.on('leave room', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.onlineCount = Math.max(0, room.onlineCount - 1);
      io.to(currentRoom).emit('online', room.onlineCount);
    }
    socket.leave(currentRoom);
    currentRoom = null;
    io.emit('room list', getRoomList());
  });

  socket.on('chat message', async (data) => {
    if (!currentRoom) return socket.emit('error_msg', 'join a room first');
    const user = (data.user || '').trim();
    const content = (data.content || '').trim();
    if (!user || !content) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    const msg = { user, content, created_at: new Date().toISOString() };
    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);

    io.to(currentRoom).emit('chat message', msg);
    await saveRoom(currentRoom);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.onlineCount = Math.max(0, room.onlineCount - 1);
        io.to(currentRoom).emit('online', room.onlineCount);
      }
    }
  });
});

function getRoomList() {
  const list = [];
  for (const [name, room] of rooms) {
    list.push({
      name,
      hasPassword: !!room.password,
      onlineCount: room.onlineCount,
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
