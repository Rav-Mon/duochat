const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = 3000;
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const PROFILES_FILE = path.join(__dirname, 'profiles.json');

// Initialize files if they don't exist
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify({}));
if (!fs.existsSync(PROFILES_FILE)) fs.writeFileSync(PROFILES_FILE, JSON.stringify({ mango1: { pic: null }, mango2: { pic: null } }));

// Helper: Load/Save JSON
function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// User peer mapping
const userToPeer = { mango1: 'mango2', mango2: 'mango1' };

// Serve static files
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' })); // For profile pic uploads

// Socket.io connections
io.on('connection', (socket) => {
  let currentUser = null;

  // Login/Join
  socket.on('join', (user) => {
    if (user !== 'mango1' && user !== 'mango2') return socket.disconnect();
    currentUser = user;
    socket.join(user);
    socket.to(userToPeer[user]).emit('user_online', user);

    // Send existing messages
    const messages = loadJson(MESSAGES_FILE);
    const chatKey = [user, userToPeer[user]].sort().join('-');
    socket.emit('load_messages', messages[chatKey] || []);

    // Send profiles
    const profiles = loadJson(PROFILES_FILE);
    socket.emit('load_profiles', profiles);
  });

  // Message send
  socket.on('send_message', (msg) => {
    if (!currentUser) return;
    const timestamp = new Date().toISOString();
    const message = { id: Date.now(), from: currentUser, text: msg.text, timestamp, deleted: false };
    const messages = loadJson(MESSAGES_FILE);
    const chatKey = [currentUser, userToPeer[currentUser]].sort().join('-');
    if (!messages[chatKey]) messages[chatKey] = [];
    messages[chatKey].push(message);
    saveJson(MESSAGES_FILE, messages);

    // Broadcast to peer
    socket.to(userToPeer[currentUser]).emit('new_message', message);
    socket.emit('new_message', message); // Echo to sender
  });

  // Delete message
  socket.on('delete_message', (msgId) => {
    if (!currentUser) return;
    const messages = loadJson(MESSAGES_FILE);
    const chatKey = [currentUser, userToPeer[currentUser]].sort().join('-');
    if (messages[chatKey]) {
      const msg = messages[chatKey].find(m => m.id === msgId);
      if (msg && msg.from === currentUser) { // Only sender can delete
        msg.deleted = true;
        saveJson(MESSAGES_FILE, messages);
        socket.to(userToPeer[currentUser]).emit('message_deleted', msgId);
        socket.emit('message_deleted', msgId);
      }
    }
  });

  // Profile pic upload
  socket.on('upload_profile', (data) => {
    if (!currentUser) return;
    const profiles = loadJson(PROFILES_FILE);
    profiles[currentUser].pic = data.pic; // Base64 or URL
    saveJson(PROFILES_FILE, profiles);
    socket.to(userToPeer[currentUser]).emit('profile_updated', { user: currentUser, pic: data.pic });
    socket.emit('profile_updated', { user: currentUser, pic: data.pic });
  });

  // WebRTC Signaling
  socket.on('call_offer', (offer) => {
    if (!currentUser) return;
    socket.to(userToPeer[currentUser]).emit('incoming_call', { from: currentUser, offer });
  });

  socket.on('call_answer', (answer) => {
    if (!currentUser) return;
    socket.to(userToPeer[currentUser]).emit('call_answered', answer);
  });

  socket.on('ice_candidate', (candidate) => {
    if (!currentUser) return;
    socket.to(userToPeer[currentUser]).emit('new_ice_candidate', candidate);
  });

  socket.on('end_call', () => {
    if (!currentUser) return;
    socket.to(userToPeer[currentUser]).emit('call_ended');
  });

  socket.on('disconnect', () => {
    if (currentUser) socket.to(userToPeer[currentUser]).emit('user_offline', currentUser);
  });
});

// Profile pic endpoint (for saving base64 as file if needed, but we'll use base64 for simplicity)
app.post('/upload', (req, res) => {
  // Handled via socket for real-time, but fallback
  res.json({ success: true });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});