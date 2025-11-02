/* ================== GLOBALS ================== */
const socket = io();                 // will auto-connect to the same origin
let currentUser = null;
let peerUser    = null;
let messages    = [];
let profiles    = {};

let localStream = null;
let peerConnection = null;
let isCaller = false;
let pendingOffer = null;   // for incoming call

/* ================== LOGIN ================== */
function login(user) {
  currentUser = user;
  peerUser    = user === 'mango1' ? 'mango2' : 'mango1';

  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  document.getElementById('peer-name').textContent = peerUser;
  socket.emit('join', user);
}

/* ================== SOCKET LISTENERS ================== */
socket.on('load_messages', msgs => { messages = msgs; renderMessages(); });
socket.on('load_profiles', p => { profiles = p; updatePeerPic(); });

socket.on('new_message', msg => { messages.push(msg); renderMessages(); });
socket.on('message_deleted', id => {
  const idx = messages.findIndex(m => m.id === id);
  if (idx > -1) messages[idx].deleted = true;
  renderMessages();
});

socket.on('profile_updated', ({user, pic}) => {
  profiles[user] = {pic};
  if (user !== currentUser) updatePeerPic();
});

socket.on('user_online', u => {
  document.getElementById('online-status').textContent = '(Online)';
});
socket.on('user_offline', () => {
  document.getElementById('online-status').textContent = '';
});

/* ================== MESSAGING ================== */
function sendMessage() {
  const inp = document.getElementById('message-input');
  const txt = inp.value.trim();
  if (!txt) return;
  socket.emit('send_message', {text: txt});
  inp.value = '';
}
function deleteMessage(id) { socket.emit('delete_message', id); }

function renderMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  messages.forEach(m => {
    if (m.deleted) return;
    const div = document.createElement('div');
    div.className = `message ${m.from===currentUser?'sent':'received'}`;
    const time = new Date(m.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    div.innerHTML = `
      <p>${escapeHtml(m.text)}</p>
      <span class="timestamp">${time}</span>
      ${m.from===currentUser ? `<button class="delete-btn" onclick="deleteMessage(${m.id})">×</button>` : ''}
    `;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);}

/* ================== PROFILE PIC (clickable) ================== */
function updatePeerPic() {
  const img = document.getElementById('peer-pic');
  img.src = profiles[peerUser]?.pic || 'https://via.placeholder.com/40?text=?';
}
function uploadProfile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => socket.emit('upload_profile', {pic: e.target.result});
  reader.readAsDataURL(file);
}

/* ================== CALL LOGIC ================== */
const rtcConfig = {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};

function startCall(type) {
  isCaller = true;
  pendingOffer = null;
  showCallOverlay(`${type === 'video' ? 'Video' : 'Voice'} Calling…`);
  initLocalStream(type).then(() => createOffer());
}

async function initLocalStream(type) {
  const constraints = type === 'video' ? {video:true,audio:true} : {audio:true};
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  document.getElementById('local-video').srcObject = localStream;
  // hide video element for voice-only
  document.getElementById('local-video').style.display = type==='video' ? 'block' : 'none';
  document.getElementById('remote-video').style.display = type==='video' ? 'block' : 'none';
}

/* ---- Outgoing ---- */
async function createOffer() {
  peerConnection = new RTCPeerConnection(rtcConfig);
  addTracksAndListeners();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('call_offer', {offer, type: callType});
}

/* ---- Incoming ---- */
socket.on('incoming_call', async ({from, offer, type}) => {
  peerUser = from;
  callType = type;
  isCaller = false;
  pendingOffer = offer;
  showCallOverlay(`Incoming ${type === 'video' ? 'Video' : 'Voice'} Call from ${from}`);
  document.getElementById('incoming-controls').classList.remove('hidden');
  document.getElementById('end-call').classList.add('hidden');
});

/* Accept button */
document.getElementById('accept-call').onclick = async () => {
  document.getElementById('incoming-controls').classList.add('hidden');
  document.getElementById('end-call').classList.remove('hidden');
  await initLocalStream(callType);
  await handleIncomingOffer(pendingOffer);
};

/* Decline button */
document.getElementById('decline-call').onclick = () => endCall(true);

/* ---- Answer ---- */
async function handleIncomingOffer(offer) {
  peerConnection = new RTCPeerConnection(rtcConfig);
  addTracksAndListeners();
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('call_answer', answer);
}

/* ---- Answer received (caller side) ---- */
socket.on('call_answered', async answer => {
  await peerConnection.setRemoteDescription(answer);
  document.getElementById('call-info').textContent = 'Connected!';
  document.getElementById('end-call').classList.remove('hidden');
});

/* ---- ICE ---- */
socket.on('new_ice_candidate', cand => peerConnection?.addIceCandidate(cand));

/* ---- End call ---- */
socket.on('call_ended', () => endCall());
document.getElementById('end-call').onclick = () => endCall(true);

/* Helper: add tracks + listeners */
function addTracksAndListeners() {
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.onicecandidate = e => e.candidate && socket.emit('ice_candidate', e.candidate);
  peerConnection.ontrack = e => {
    document.getElementById('remote-video').srcObject = e.streams[0];
  };
}

/* Show / hide overlay */
let callType = null;
function showCallOverlay(msg) {
  document.getElementById('call-info').textContent = msg;
  document.getElementById('call-overlay').classList.remove('hidden');
}
function endCall(send = false) {
  if (send) socket.emit('end_call');
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (peerConnection) peerConnection.close();
  localStream = peerConnection = null;
  document.getElementById('call-overlay').classList.add('hidden');
  document.getElementById('incoming-controls').classList.add('hidden');
  document.getElementById('end-call').classList.add('hidden');
}

/* ================== BUTTON WIRING ================== */
document.getElementById('voice-call').onclick = () => startCall('voice');
document.getElementById('video-call').onclick = () => startCall('video');
