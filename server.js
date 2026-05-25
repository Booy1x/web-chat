const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'chat.db');
const SAVE_INTERVAL = 5000; // save to disk every 5s

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let db;
let insertStmt;

async function initDb() {
  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Periodically save to disk
  setInterval(() => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }, SAVE_INTERVAL);
}

function getRecentMessages() {
  const results = db.exec('SELECT id, user, content, created_at FROM messages ORDER BY id DESC LIMIT 100');
  if (!results.length) return [];
  return results[0].values.map((row) => ({
    id: row[0],
    user: row[1],
    content: row[2],
    created_at: row[3]
  })).reverse();
}

function insertMessage(user, content) {
  db.run('INSERT INTO messages (user, content) VALUES (?, ?)', [user, content]);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/messages', (req, res) => {
  res.json(getRecentMessages());
});

io.on('connection', (socket) => {
  socket.on('chat message', (data) => {
    insertMessage(data.user, data.content);
    io.emit('chat message', {
      user: data.user,
      content: data.content,
      created_at: new Date().toISOString()
    });
  });
});

const PORT = process.env.PORT || 3000;

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
