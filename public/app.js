const socket = io();
let myName = '';

// Login
function join() {
  const input = document.getElementById('nameInput');
  const name = input.value.trim();
  if (!name) return;
  myName = name;
  document.getElementById('currentUser').textContent = name;
  document.getElementById('login').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';
  loadHistory();
  document.getElementById('msgInput').focus();
}

document.getElementById('nameInput').addEventListener('keydown', (e) => {
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
  if (!content) return;
  socket.emit('chat message', { user: myName, content });
  input.value = '';
  input.focus();
}

document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

// Receive
socket.on('chat message', (data) => {
  appendMsg(data.user, data.content, data.created_at);
  scrollToBottom();
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
