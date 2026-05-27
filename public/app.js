let socket;
let myName = '';
let currentRoom = '';
let roomPassword = '';
let kicked = false;

// ── Terminal Dialog ──
function termAlert(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('termDialog');
    const msgEl = document.getElementById('termDialogMsg');
    const input = document.getElementById('termDialogInput');
    const okBtn = document.getElementById('termDialogOk');
    const cancelBtn = document.getElementById('termDialogCancel');

    msgEl.textContent = msg;
    input.style.display = 'none';
    cancelBtn.style.display = 'none';
    overlay.style.display = 'flex';

    const cleanup = () => {
      overlay.style.display = 'none';
      okBtn.onclick = null;
      document.onkeydown = null;
      resolve();
    };

    okBtn.onclick = cleanup;
    document.onkeydown = (e) => { if (e.key === 'Enter') cleanup(); };
    okBtn.focus();
  });
}

function termConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('termDialog');
    const msgEl = document.getElementById('termDialogMsg');
    const input = document.getElementById('termDialogInput');
    const okBtn = document.getElementById('termDialogOk');
    const cancelBtn = document.getElementById('termDialogCancel');

    msgEl.textContent = msg;
    input.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    overlay.style.display = 'flex';

    const cleanup = (result) => {
      overlay.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      document.onkeydown = null;
      resolve(result);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    document.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(true);
      if (e.key === 'Escape') cleanup(false);
    };
    okBtn.focus();
  });
}

function termPrompt(msg, placeholder, isPassword) {
  return new Promise(resolve => {
    const overlay = document.getElementById('termDialog');
    const msgEl = document.getElementById('termDialogMsg');
    const input = document.getElementById('termDialogInput');
    const okBtn = document.getElementById('termDialogOk');
    const cancelBtn = document.getElementById('termDialogCancel');

    msgEl.textContent = msg;
    input.style.display = 'block';
    input.type = isPassword ? 'password' : 'text';
    input.placeholder = placeholder || '';
    input.value = '';
    cancelBtn.style.display = 'inline-block';
    overlay.style.display = 'flex';

    const cleanup = (result) => {
      overlay.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
      resolve(result);
    };

    okBtn.onclick = () => cleanup(input.value);
    cancelBtn.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(input.value);
      if (e.key === 'Escape') cleanup(null);
    };
    input.focus();
  });
}

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
  kicked = false;

  // Connect socket for global online tracking
  socket = io({ auth: { code } });
  socket.emit('set username', myName);
  socket.on('global user list', (users) => {
    renderGlobalUserList(users);
  });
  socket.on('kicked', async () => {
    kicked = true;
    await termAlert('Your account was logged in from another location');
    logout();
  });
  socket.on('connect_error', async (err) => {
    if (err.message === 'access denied') {
      await termAlert('Access denied');
      logout();
    }
  });

  showRoomList();
}

function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  myName = '';
  currentRoom = '';
  roomPassword = '';
  localStorage.removeItem('chatRoom');
  document.getElementById('roomList').style.display = 'none';
  document.getElementById('chat').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('globalSidebar').style.display = 'none';
  document.getElementById('nameInput').value = '';
  document.getElementById('codeInput').value = '';
  document.getElementById('nameInput').focus();
}

// ── Room List ──
async function showRoomList() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('chat').style.display = 'none';
  document.getElementById('roomList').style.display = 'flex';
  document.getElementById('globalSidebar').style.display = 'flex';
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
    const canDelete = r.name !== 'general';
    return `<div class="room-item" data-name="${escapeAttr(r.name)}">
      <span class="room-name">${escapeHtml(r.name)}${lock}</span>
      <span class="room-info">${info}</span>
      ${canDelete ? `<span class="room-actions">
        <button class="btn-clear" title="clear messages">clear</button>
        <button class="btn-delete" title="delete room">delete</button>
      </span>` : ''}
    </div>`;
  }).join('');
}

async function clearMessages(roomName) {
  if (!await termConfirm(`Clear all messages in #${roomName}?`)) return;
  socket.emit('clear messages', roomName);
  // Optimistic: if currently in this room, clear messages immediately
  if (currentRoom === roomName) {
    document.getElementById('messages').innerHTML = '';
    appendSystemMsg('messages cleared');
  }
}

async function deleteRoom(roomName) {
  if (!await termConfirm(`Delete room #${roomName}? This cannot be undone.`)) return;
  socket.emit('delete room', roomName);
  // Optimistic: remove from list immediately
  const item = document.querySelector(`.room-item[data-name="${CSS.escape(roomName)}"]`);
  if (item) item.remove();
  // If currently in this room, leave
  if (currentRoom === roomName) {
    leaveRoom();
  }
}

async function joinRoom(name) {
  const room = await findRoom(name);
  let password = '';

  if (room && room.hasPassword) {
    password = await termPrompt(`password for "${name}":`, 'enter password', true);
    if (password === null) return;
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

  // Remove previous listeners to avoid leak
  socket.off('room list');
  socket.off('room error');

  socket.emit('create room', { name, password });

  socket.once('room list', (rooms) => {
    socket.off('room error');
    renderRoomList(rooms);
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomPass').value = '';
    errEl.textContent = '';
  });

  socket.once('room error', (msg) => {
    socket.off('room list');
    errEl.textContent = '> error: ' + msg;
  });
}

function connectAndJoin(name, password) {
  currentRoom = name;
  roomPassword = password;
  localStorage.setItem('chatRoom', name);

  // Remove previous room listeners to avoid duplicates
  socket.off('room joined');
  socket.off('room error');
  socket.off('chat message');
  socket.off('online');
  socket.off('user list');
  socket.off('error_msg');
  socket.off('disconnect');
  socket.off('reconnect');

  socket.emit('join room', { name, password, user: myName });

  socket.on('room joined', (data) => {
    document.getElementById('roomList').style.display = 'none';
    document.getElementById('chat').style.display = 'flex';
    document.getElementById('globalSidebar').style.display = 'flex';
    document.getElementById('currentUser').textContent = myName + '@chat';
    document.getElementById('chatRoomName').textContent = data.name;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('msgInput').focus();

    data.messages.forEach(m => appendMsg(m.user, m.content, m.created_at));
    scrollToBottom();

    if (data.users) renderUserList(data.users);
  });

  socket.on('room error', async (msg) => {
    await termAlert(msg);
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

  socket.on('user list', (users) => {
    renderUserList(users);
  });

  socket.on('error_msg', (msg) => {
    appendSystemMsg(msg);
  });

  socket.on('disconnect', () => {
    if (!kicked) appendSystemMsg('disconnected. reconnecting...');
  });

  socket.on('reconnect', () => {
    if (!kicked) socket.emit('join room', { name: currentRoom, password: roomPassword, user: myName });
  });

  socket.on('room deleted', async () => {
    await termAlert('This room has been deleted');
    leaveRoom();
  });

  socket.on('messages cleared', () => {
    document.getElementById('messages').innerHTML = '';
    appendSystemMsg('messages cleared');
  });
}

// ── User List ──
function renderUserList(users) {
  const container = document.getElementById('roomUserList');
  container.innerHTML = users.map(u =>
    `<div class="user-item${u.name === myName ? ' me' : ''}">
      <span class="user-dot"></span>
      <span class="user-name">${escapeHtml(u.name)}</span>
    </div>`
  ).join('');
}

function renderGlobalUserList(users) {
  const container = document.getElementById('globalUserList');
  container.innerHTML = users.map(u =>
    `<div class="user-item${u.name === myName ? ' me' : ''}">
      <span class="user-dot"></span>
      <span class="user-name">${escapeHtml(u.name)}</span>
    </div>`
  ).join('');
  document.getElementById('globalOnlineCount').textContent = users.length + ' online';
}

function leaveRoom() {
  document.getElementById('roomUserList').classList.remove('open');
  if (socket) {
    socket.emit('leave room');
    socket.off('room joined');
    socket.off('room error');
    socket.off('chat message');
    socket.off('online');
    socket.off('user list');
    socket.off('error_msg');
    socket.off('disconnect');
    socket.off('reconnect');
    socket.off('room deleted');
    socket.off('messages cleared');
  }
  currentRoom = '';
  roomPassword = '';
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
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scrollToBottom() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}

// ── Event Delegation ──
document.getElementById('roomItems').addEventListener('click', (e) => {
  const clearBtn = e.target.closest('.btn-clear');
  const deleteBtn = e.target.closest('.btn-delete');

  if (clearBtn) {
    e.stopPropagation();
    clearMessages(clearBtn.closest('.room-item').dataset.name);
  } else if (deleteBtn) {
    e.stopPropagation();
    deleteRoom(deleteBtn.closest('.room-item').dataset.name);
  } else {
    const item = e.target.closest('.room-item');
    if (item) joinRoom(item.dataset.name);
  }
});

// ── Online Dropdown ──
document.getElementById('onlineCount').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('roomUserList');
  const isOpen = menu.classList.toggle('open');
  if (isOpen) {
    const rect = e.target.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
  }
});

document.addEventListener('click', () => {
  document.getElementById('roomUserList').classList.remove('open');
});

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
