const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const MAX_CONNECTIONS = 10;
const ACCESS_CODE = process.env.ACCESS_CODE || ''; // set in Render env vars

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let messages = [];
let onlineCount = 0;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/messages', (req, res) => {
  res.json(messages.slice(-100));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Verify access code
app.post('/api/verify', (req, res) => {
  if (!ACCESS_CODE) return res.json({ ok: true }); // no code set = open access
  if (req.body.code === ACCESS_CODE) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

io.on('connection', (socket) => {
  // Reject if at capacity
  if (onlineCount >= MAX_CONNECTIONS) {
    socket.emit('error_msg', '聊天室已满，请稍后再试');
    socket.disconnect(true);
    return;
  }

  onlineCount++;
  io.emit('online', onlineCount);

  socket.on('chat message', (data) => {
    const msg = {
      user: data.user,
      content: data.content,
      created_at: new Date().toISOString()
    };
    messages.push(msg);
    if (messages.length > 500) messages = messages.slice(-500);
    io.emit('chat message', msg);
  });

  socket.on('disconnect', () => {
    onlineCount--;
    io.emit('online', onlineCount);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
