const socket = io();
let currentUser = null;
let peerUser = null;
let messages = [];
let profiles = {};
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCaller = false;
let callType = null; // 'voice' or 'video'

// Login
function login(user) {
  currentUser = user;
  peerUser = user === 'mango1' ? 'mango2' : 'mango1';
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('peer-name').textContent = peerUser;
  socket.emit('join', user);
}

// Load data from server
socket.on('load_messages', (loadedMessages) => {
  messages = loadedMessages;
  renderMessages();
});

socket.on('load_profiles', (loadedProfiles) => {
  profiles = loadedProfiles;
  updateProfilePic(currentUser, profiles[currentUser]?.pic);
  updatePeerPic();
});

socket.on('new_message', (msg) => {
  messages.push(msg);
  renderMessages();
});

socket.on('message_deleted', (msgId) => {
  const msgIndex = messages.findIndex(m => m.id === msgId);
  if (msgIndex !== -1) messages[msgIndex].deleted = true;
  renderMessages();
});

socket.on('profile_updated', (data) => {
  profiles[data.user] = { ...profiles[data.user], pic: data.pic };
  if (data.user === currentUser) updateProfilePic(currentUser, data.pic);
  else updatePeerPic();
});

socket.on('user_online', (user) => {
  document.getElementById('peer-name').textContent = `${user} (Online)`;
});

// Send message
function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('send_message', { text });
  input.value = '';
}

// Render messages
function renderMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  messages.forEach(msg => {
    if (msg.deleted) return; // Skip deleted
    const div = document.createElement('div');
    div.className = `message ${msg.from === currentUser ? 'sent' : 'received'}`;
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <p>${msg.text}</p>
      <span class="timestamp">${time}</span>
      ${msg.from === currentUser ? `<button class="delete-btn" onclick="deleteMessage(${msg.id})">×</button>` : ''}
    `;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function deleteMessage(msgId) {
  socket.emit('delete_message', msgId);
}

// Profile upload
function uploadProfile() {
  const file = document.getElementById('profile-upload').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const pic = e.target.result; // Base64
    socket.emit('upload_profile', { pic });
  };
  reader.readAsDataURL(file);
}

function updateProfilePic(user, pic) {
  // For simplicity, set in header if needed; peer pic updates below
}

function updatePeerPic() {
  const img = document.getElementById('peer-pic');
  img.src = profiles[peerUser]?.pic || 'https://via.placeholder.com/40?text=?'; // Default placeholder
}

// WebRTC Calls
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; // Free STUN

function startCall(type) {
  callType = type;
  isCaller = true;
  document.getElementById('call-overlay').classList.remove('hidden');
  document.getElementById('call-status').textContent = 'Ringing...';
  initLocalStream(type);
}

socket.on('incoming_call', async ({ from, offer }) => {
  peerUser = from;
  isCaller = false;
  callType = 'video'; // Assume video for incoming; adjust if needed
  document.getElementById('call-overlay').classList.remove('hidden');
  document.getElementById('call-status').textContent = 'Incoming call...';
  initLocalStream(callType);
  await handleOffer(offer);
});

async function initLocalStream(type) {
  try {
    const constraints = type === 'video' ? { video: true, audio: true } : { audio: true };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    document.getElementById('local-video').srcObject = localStream;
    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice_candidate', e.candidate);
    };

    peerConnection.ontrack = (e) => {
      remoteStream = e.streams[0];
      document.getElementById('remote-video').srcObject = remoteStream;
    };

    if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('call_offer', offer);
    }
  } catch (err) {
    console.error('Media error:', err);
  }
}

async function handleOffer(offer) {
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('call_answer', answer);
}

socket.on('call_answered', async (answer) => {
  await peerConnection.setRemoteDescription(answer);
  document.getElementById('call-status').textContent = 'Connected!';
});

socket.on('new_ice_candidate', (candidate) => {
  peerConnection.addIceCandidate(candidate);
});

function endCall() {
  socket.emit('end_call');
  closeCall();
}

socket.on('call_ended', () => {
  closeCall();
});

function closeCall() {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (peerConnection) peerConnection.close();
  document.getElementById('local-video').srcObject = null;
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('call-overlay').classList.add('hidden');
  callType = null;
  isCaller = false;
}

// For voice-only: Hide video elements in CSS if callType === 'voice'
if (callType === 'voice') {
  document.getElementById('local-video').style.display = 'none';
  document.getElementById('remote-video').style.display = 'none';
}