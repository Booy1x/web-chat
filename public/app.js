let socket;
let myName = '';

// Login
async function join() {
  const name = document.getElementById('nameInput').value.trim();
  const code = document.getElementById('codeInput').value.trim();
  const errEl = document.getElementById('loginError');

  if (!name) { errEl.textContent = '请输入昵称'; return; }

  // Verify access code
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = '密码错误'; return; }
  } catch (e) {
    errEl.textContent = '连接失败'; return;
  }

  errEl.textContent = '';
  myName = name;
  document.getElementById('currentUser').textContent = name;
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
    document.getElementById('onlineCount').textContent = '在线: ' + count;
  });

  socket.on('error_msg', (msg) => {
    alert(msg);
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

  const nameDiv = document.createElement('div');
  nameDiv.className = 'name';
  nameDiv.textContent = user;

  const contentDiv = document.createElement('div');
  contentDiv.textContent = content;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'time';
  timeDiv.textContent = new Date(time).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  div.appendChild(nameDiv);
  div.appendChild(contentDiv);
  div.appendChild(timeDiv);
  document.getElementById('messages').appendChild(div);
}

function scrollToBottom() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}
