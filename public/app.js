let socket;
let myName = '';

// Login
async function join() {
  const name = document.getElementById('nameInput').value.trim();
  const code = document.getElementById('codeInput').value.trim();
  const errEl = document.getElementById('loginError');

  if (!name) { errEl.textContent = '> error: username required'; return; }

  // Verify access code
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
  document.getElementById('currentUser').textContent = name + '@chat';
  document.getElementById('login').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';

  // Connect socket after auth
  socket = io();
  setupSocket();
  loadHistory();
  document.getElementById('msgInput').focus();
}

function setupSocket() {
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
}

document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('codeInput').focus();
});
document.getElementById('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

// Load history
async function loadHistory() {
  appendSystemMsg('connected. type messages below.');
  const res = await fetch('/api/messages');
  const messages = await res.json();
  messages.forEach((m) => appendMsg(m.user, m.content, m.created_at));
  scrollToBottom();
}

// Send
function send() {
  const input = document.getElementById('msgInput');
  const content = input.value.trim();
  if (!content || !socket) return;
  socket.emit('chat message', { user: myName, content });
  input.value = '';
  input.focus();
}

document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

// Append message
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

function scrollToBottom() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}
