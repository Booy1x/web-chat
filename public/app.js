let socket;
let myName = '';
let currentRoom = '';

// ── Login ──
async function login() {
  const name = document.getElementById('nameInput').value.trim();
  const code = document.getElementById('codeInput').value.trim();
  const errEl = document.getElementById('loginError');

  if (!name) { errEl.textContent = '> error: username required'; return; }

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = '> error: access denied'; return; }
  } catch (e) {
    errEl.textContent = '> error: connection failed'; return;
  }

  errEl.textContent = '';
  myName = name;
  showRoomList();
}

function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  myName = '';
  currentRoom = '';
  localStorage.removeItem('chatRoom');
  document.getElementById('roomList').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('nameInput').value = '';
  document.getElementById('codeInput').value = '';
  document.getElementById('nameInput').focus();
}

// ── Room List ──
async function showRoomList() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('chat').style.display = 'none';
  document.getElementById('roomList').style.display = 'flex';
  document.getElementById('roomUser').textContent = myName + '@chat';

  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    renderRoomList(rooms);
  } catch (e) {
    document.getElementById('roomItems').innerHTML = '<div class="room-empty">> failed to load rooms</div>';
  }
}

function renderRoomList(rooms) {
  const container = document.getElementById('roomItems');
  if (!rooms.length) {
    container.innerHTML = '<div class="room-empty">> no rooms available</div>';
    return;
  }

  container.innerHTML = rooms.map(r => {
    const lock = r.hasPassword ? ' [locked]' : '';
    const info = `${r.onlineCount} online, ${r.messageCount} msgs`;
    return `<div class="room-item" onclick="joinRoom('${escapeAttr(r.name)}')">
      <span class="room-name">${escapeHtml(r.name)}${lock}</span>
      <span class="room-info">${info}</span>
    </div>`;
  }).join('');
}

async function joinRoom(name) {
  const room = await findRoom(name);
  let password = '';

  if (room && room.hasPassword) {
    password = prompt(`password for "${name}":`);
    if (password === null) return; // cancelled
  }

  connectAndJoin(name, password);
}

async function findRoom(name) {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    return rooms.find(r => r.name === name);
  } catch (e) {
    return null;
  }
}

async function createRoom() {
  const name = document.getElementById('newRoomName').value.trim();
  const password = document.getElementById('newRoomPass').value.trim();
  const errEl = document.getElementById('roomError');

  if (!name) { errEl.textContent = '> error: room name required'; return; }

  // Need a temporary socket to create the room
  const tmpSocket = io();
  tmpSocket.emit('create room', { name, password });

  tmpSocket.on('room list', (rooms) => {
    renderRoomList(rooms);
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomPass').value = '';
    errEl.textContent = '';
    tmpSocket.disconnect();
  });

  tmpSocket.on('room error', (msg) => {
    errEl.textContent = '> error: ' + msg;
    tmpSocket.disconnect();
  });
}

function connectAndJoin(name, password) {
  if (socket) { socket.disconnect(); }

  socket = io();
  currentRoom = name;
  localStorage.setItem('chatRoom', name);

  socket.on('connect', () => {
    socket.emit('join room', { name, password });
  });

  socket.on('room joined', (data) => {
    document.getElementById('roomList').style.display = 'none';
    document.getElementById('chat').style.display = 'flex';
    document.getElementById('currentUser').textContent = myName + '@chat';
    document.getElementById('chatRoomName').textContent = data.name;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('msgInput').focus();

    data.messages.forEach(m => appendMsg(m.user, m.content, m.created_at));
    scrollToBottom();
  });

  socket.on('room error', (msg) => {
    alert(msg);
    socket.disconnect();
    socket = null;
    currentRoom = '';
    localStorage.removeItem('chatRoom');
    showRoomList();
  });

  socket.on('chat message', (data) => {
    appendMsg(data.user, data.content, data.created_at);
    scrollToBottom();
  });

  socket.on('online', (count) => {
    document.getElementById('onlineCount').textContent = 'online: ' + count;
  });

  socket.on('error_msg', (msg) => {
    appendSystemMsg(msg);
  });

  socket.on('disconnect', () => {
    appendSystemMsg('disconnected. reconnecting...');
  });

  socket.on('reconnect', () => {
    socket.emit('join room', { name: currentRoom, password: '' });
  });
}

function leaveRoom() {
  if (socket) {
    socket.emit('leave room');
    socket.disconnect();
    socket = null;
  }
  currentRoom = '';
  localStorage.removeItem('chatRoom');
  document.getElementById('chat').style.display = 'none';
  document.getElementById('messages').innerHTML = '';
  showRoomList();
}

// ── Messaging ──
function send() {
  const input = document.getElementById('msgInput');
  const content = input.value.trim();
  if (!content || !socket) return;
  socket.emit('chat message', { user: myName, content });
  input.value = '';
  input.focus();
}

function appendMsg(user, content, time) {
  const div = document.createElement('div');
  div.className = 'msg ' + (user === myName ? 'mine' : 'other');

  const timeStr = new Date(time).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  div.innerHTML =
    '<span class="time">[' + timeStr + ']</span> ' +
    '<span class="name">' + escapeHtml(user) + '</span>' +
    '<span class="prompt"> $ </span>' +
    '<span class="content">' + escapeHtml(content) + '</span>';

  document.getElementById('messages').appendChild(div);
}

function appendSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = '> ' + text;
  document.getElementById('messages').appendChild(div);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function scrollToBottom() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}

// ── Keyboard ──
document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('codeInput').focus();
});
document.getElementById('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});
document.getElementById('newRoomName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('newRoomPass').focus();
});
document.getElementById('newRoomPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createRoom();
});
