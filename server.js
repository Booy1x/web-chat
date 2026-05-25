const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// In-memory messages (data resets on redeploy, acceptable for this use case)
let messages = [];

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/messages', (req, res) => {
  res.json(messages.slice(-100));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

io.on('connection', (socket) => {
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
