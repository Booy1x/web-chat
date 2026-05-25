const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'messages.json');
const SAVE_INTERVAL = 5000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Load messages from file
let messages = [];
if (fs.existsSync(DB_PATH)) {
  try {
    messages = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    messages = [];
  }
}

// Auto-save
setInterval(() => {
  fs.writeFileSync(DB_PATH, JSON.stringify(messages));
}, SAVE_INTERVAL);

app.use(express.static(path.join(__dirname, 'public')));

// API: get history (last 100)
app.get('/api/messages', (req, res) => {
  res.json(messages.slice(-100));
});

// Health check
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
    // Keep max 500 messages in memory
    if (messages.length > 500) messages = messages.slice(-500);
    io.emit('chat message', msg);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
