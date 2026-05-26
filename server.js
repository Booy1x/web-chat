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

// In-memory room cache
// Each room: { name, password, messages[], users: Map<username, connectionCount> }
let rooms = new Map();

async function loadRooms() {
  const data = await redis.hgetall('rooms');
  for (const [name, json] of Object.entries(data)) {
    const room = JSON.parse(json);
    room.users = new Map();
    rooms.set(name, room);
  }
  console.log(`Loaded ${rooms.size} rooms from Redis`);
}

async function saveRoom(name) {
  const room = rooms.get(name);
  if (!room) return;
  const { users, ...data } = room;
  await redis.hset('rooms', name, JSON.stringify(data));
}

async function init() {
  await loadRooms();
  if (!rooms.has('general')) {
    rooms.set('general', { name: 'general', password: '', messages: [], users: new Map() });
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
      onlineCount: room.users.size,
      messageCount: room.messages.length
    });
  }
  res.json(list);
});

// Socket.IO
io.on('connection', (socket) => {
  let currentRoom = null;
  let userName = null;

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

    rooms.set(name, { name, password: password || '', messages: [], users: new Map() });
    await saveRoom(name);
    io.emit('room list', getRoomList());
  });

  socket.on('join room', async ({ name, password, user }) => {
    const room = rooms.get(name);
    if (!room) return socket.emit('room error', 'room not found');
    if (room.password && room.password !== password) {
      return socket.emit('room error', 'wrong password');
    }

    // Leave previous room
    if (currentRoom) {
      leaveCurrentRoom();
    }

    userName = (user || '').trim();
    currentRoom = name;
    socket.join(name);

    // Track user in room
    const count = room.users.get(userName) || 0;
    room.users.set(userName, count + 1);

    socket.emit('room joined', {
      name,
      messages: room.messages.slice(-100),
      onlineCount: room.users.size,
      users: getUserList(room)
    });
    io.to(name).emit('online', room.users.size);
    io.to(name).emit('user list', getUserList(room));
    io.emit('room list', getRoomList());
  });

  socket.on('leave room', () => {
    if (!currentRoom) return;
    leaveCurrentRoom();
    currentRoom = null;
    userName = null;
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
      leaveCurrentRoom();
    }
  });

  function leaveCurrentRoom() {
    const room = rooms.get(currentRoom);
    if (!room || !userName) return;

    const count = room.users.get(userName) || 0;
    if (count <= 1) {
      room.users.delete(userName);
    } else {
      room.users.set(userName, count - 1);
    }

    socket.leave(currentRoom);
    io.to(currentRoom).emit('online', room.users.size);
    io.to(currentRoom).emit('user list', getUserList(room));
    io.emit('room list', getRoomList());
  }
});

function getUserList(room) {
  return Array.from(room.users.keys()).sort().map(name => ({ name }));
}

function getRoomList() {
  const list = [];
  for (const [name, room] of rooms) {
    list.push({
      name,
      hasPassword: !!room.password,
      onlineCount: room.users.size,
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
