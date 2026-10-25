/**
 * Walkie Friends - App Logic
 * Easy, instant push-to-talk communication with friends over custom channels and private PINs.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const btnPtt = document.getElementById('btnPtt');
  const pulseRing = document.getElementById('pulseRing');
  const pttContainer = document.querySelector('.ptt-container');
  const pttMainLabel = document.getElementById('pttMainLabel');
  const btnLockMic = document.getElementById('btnLockMic');
  const lockLed = document.getElementById('lockLed');
  const lockMicText = document.getElementById('lockMicText');
  const btnBeepToggle = document.getElementById('btnBeepToggle');
  const beepToggleText = document.getElementById('beepToggleText');
  const talkBanner = document.getElementById('talkBanner');
  const talkBannerText = document.getElementById('talkBannerText');

  // Channel elements
  const currentChannelName = document.getElementById('currentChannelName');
  const btnPrevChannel = document.getElementById('btnPrevChannel');
  const btnNextChannel = document.getElementById('btnNextChannel');
  const btnChannelPicker = document.getElementById('btnChannelPicker');
  const btnTogglePin = document.getElementById('btnTogglePin');
  const lockIcon = document.getElementById('lockIcon');
  const lockText = document.getElementById('lockText');
  const securityBadge = document.getElementById('securityBadge');
  const quickChips = document.querySelectorAll('.quick-channels .chip[data-ch]');
  const btnCustomChannel = document.getElementById('btnCustomChannel');

  // Friends & Profile
  const friendsList = document.getElementById('friendsList');
  const friendCount = document.getElementById('friendCount');
  const myAvatarMini = document.getElementById('myAvatarMini');
  const myNameMini = document.getElementById('myNameMini');
  const btnProfile = document.getElementById('btnProfile');
  const btnShare = document.getElementById('btnShare');
  const btnSettings = document.getElementById('btnSettings');
  const netStatus = document.getElementById('netStatus');

  // Modals
  const modalPin = document.getElementById('modalPin');
  const modalChannelPicker = document.getElementById('modalChannelPicker');
  const modalShare = document.getElementById('modalShare');
  const modalSettings = document.getElementById('modalSettings');

  const btnClosePinModal = document.getElementById('btnClosePinModal');
  const btnCloseChannelModal = document.getElementById('btnCloseChannelModal');
  const btnCloseShareModal = document.getElementById('btnCloseShareModal');
  const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');

  // Modal inputs
  const inputChannelPin = document.getElementById('inputChannelPin');
  const btnSavePin = document.getElementById('btnSavePin');
  const btnRemovePin = document.getElementById('btnRemovePin');
  const inputCustomChannel = document.getElementById('inputCustomChannel');
  const btnApplyChannel = document.getElementById('btnApplyChannel');
  const inputShareLink = document.getElementById('inputShareLink');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const shareQrCode = document.getElementById('shareQrCode');
  const inputUserName = document.getElementById('inputUserName');
  const btnSaveName = document.getElementById('btnSaveName');
  const avatarColorPicker = document.getElementById('avatarColorPicker');
  const chkSoundFx = document.getElementById('chkSoundFx');
  const btnTestMic = document.getElementById('btnTestMic');

  // Helper to format channel as strictly 3-digit number (001 - 999)
  function formatChannel(ch) {
    const num = parseInt(ch, 10);
    if (isNaN(num) || num < 1) return '101';
    const clamped = Math.max(1, Math.min(999, num));
    return String(clamped).padStart(3, '0');
  }

  // State Variables
  const urlParams = new URLSearchParams(window.location.search);
  const rawCh = urlParams.get('ch') || urlParams.get('channel') || localStorage.getItem('wf_channel') || '101';
  let activeChannel = formatChannel(rawCh);
  let activePin = urlParams.get('pin') || localStorage.getItem('wf_pin') || '';
  let userName = localStorage.getItem('wf_name') || 'Friend ' + Math.floor(10 + Math.random() * 90);
  let userAvatarColor = localStorage.getItem('wf_avatar_color') || '#10b981';

  let myId = null;
  let isTalking = false;
  let isHandsFree = false;
  let isConnected = false;
  let friendsInRoom = [];
  let currentSpeaker = null;
  let ws = null;
  let seqCounter = 0;

  // Colors available for avatar
  const AVATAR_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  // ==========================================
  // INITIALIZATION
  // ==========================================

  // Populate avatar colors
  AVATAR_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (c === userAvatarColor ? ' active' : '');
    dot.style.backgroundColor = c;
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      userAvatarColor = c;
      localStorage.setItem('wf_avatar_color', c);
      updateProfileUI();
      sendJoinChannel();
    });
    avatarColorPicker.appendChild(dot);
  });

  updateProfileUI();
  updateChannelUI();
  setupCrypto();

  // Audio Chunk Transmitter
  window.simpleAudio.onChunk = async (pcmInt16) => {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;

    // Encrypt audio chunk if private PIN is set
    const enc = await window.simpleCrypto.encrypt(pcmInt16);
    seqCounter++;

    ws.send(JSON.stringify({
      type: 'voice_packet',
      iv: enc.iv,
      ciphertext: enc.ciphertext,
      isEncrypted: enc.isEncrypted,
      seq: seqCounter
    }));
  };

  // Connect to server
  connectNetwork();

  // Load Network / QR Code
  fetchQrInfo();

  // ==========================================
  // WEBSOCKET NETWORK
  // ==========================================

  function connectNetwork() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnected = true;
      netStatus.innerHTML = '<span class="status-dot"></span> Online';
      sendJoinChannel();
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        console.error('Error handling WS message:', err);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      netStatus.innerHTML = '<span class="status-dot" style="background:#888;box-shadow:none"></span> Reconnecting...';
      setTimeout(connectNetwork, 2000);
    };
  }

  async function handleMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        myId = msg.id;
        break;
      }

      case 'channel_friends': {
        friendsInRoom = msg.friends || [];
        renderFriendsList();
        break;
      }

      case 'friend_talking': {
        if (msg.isTalking) {
          currentSpeaker = msg.name;
          setReceivingUI(true, msg.name, msg.id);
        } else {
          currentSpeaker = null;
          setReceivingUI(false);
          if (msg.rogerBeep) {
            window.simpleAudio.playFriendStoppedTalking();
          }
        }
        break;
      }

      case 'voice_packet': {
        // Decrypt voice chunk with channel PIN
        const pcmData = await window.simpleCrypto.decrypt(msg.iv, msg.ciphertext, msg.isEncrypted);
        if (pcmData) {
          window.simpleAudio.playIncomingVoice(pcmData);
        }
        break;
      }
    }
  }

  function sendJoinChannel() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'join_channel',
      channel: activeChannel,
      pin: activePin,
      name: userName,
      avatarColor: userAvatarColor
    }));
  }

  // ==========================================
  // PUSH-TO-TALK (PTT)
  // ==========================================

  async function startTalk() {
    if (isTalking) return;
    isTalking = true;

    btnPtt.classList.add('active');
    pttContainer.classList.add('active');
    pttMainLabel.textContent = 'TRANSMITTING...';
    talkBanner.className = 'talk-status-banner transmitting';
    talkBannerText.textContent = '🔴 You are talking...';

    const ok = await window.simpleAudio.startTalking();
    if (!ok) {
      endTalk();
      alert('Microphone access is required to talk. Please allow microphone in your browser settings.');
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'talk_start' }));
    }
  }

  function endTalk() {
    if (!isTalking) return;
    if (isHandsFree) return; // Keep active if locked

    isTalking = false;
    btnPtt.classList.remove('active');
    pttContainer.classList.remove('active');
    pttMainLabel.textContent = 'HOLD TO TALK';
    talkBanner.className = 'talk-status-banner';
    talkBannerText.textContent = 'Ready to talk';

    window.simpleAudio.stopTalking();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'talk_end',
        rogerBeep: window.simpleAudio.soundEffects
      }));
    }
  }

  // Mouse Hold
  btnPtt.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startTalk();
  });

  window.addEventListener('mouseup', () => {
    if (isTalking && !isHandsFree) {
      endTalk();
    }
  });

  // Mobile Touch Hold
  btnPtt.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startTalk();
  }, { passive: false });

  btnPtt.addEventListener('touchend', (e) => {
    e.preventDefault();
    endTalk();
  }, { passive: false });

  btnPtt.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    endTalk();
  }, { passive: false });

  // Spacebar Desktop Shortcut
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      startTalk();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      endTalk();
    }
  });

  // Hands-Free Lock Toggle
  btnLockMic.addEventListener('click', () => {
    isHandsFree = !isHandsFree;
    btnLockMic.classList.toggle('active', isHandsFree);
    lockMicText.textContent = isHandsFree ? 'Hands-Free: ON' : 'Hands-Free: OFF';

    if (isHandsFree) {
      startTalk();
    } else {
      endTalk();
    }
  });

  // Walkie-Talkie Sound FX Toggle
  btnBeepToggle.addEventListener('click', () => {
    window.simpleAudio.soundEffects = !window.simpleAudio.soundEffects;
    chkSoundFx.checked = window.simpleAudio.soundEffects;
    beepToggleText.textContent = window.simpleAudio.soundEffects ? 'Beeps: ON' : 'Beeps: OFF';
    if (window.simpleAudio.soundEffects) {
      window.simpleAudio.playChirp();
    }
  });

  // Receiving state UI
  function setReceivingUI(isReceiving, speakerName = '', speakerId = '') {
    if (isTalking) return; // Prioritize local transmit

    btnPtt.classList.toggle('receiving', isReceiving);
    pttContainer.classList.toggle('active', isReceiving);

    if (isReceiving) {
      talkBanner.className = 'talk-status-banner receiving';
      talkBannerText.textContent = `🟢 ${speakerName} is talking...`;
      pttMainLabel.textContent = 'LISTENING...';
    } else {
      talkBanner.className = 'talk-status-banner';
      talkBannerText.textContent = 'Ready to talk';
      pttMainLabel.textContent = 'HOLD TO TALK';
    }

    // Update friend card talking highlight
    document.querySelectorAll('.friend-card').forEach(card => {
      const id = card.dataset.id;
      const isCardSpeaker = isReceiving && (id === speakerId);
      card.classList.toggle('talking', isCardSpeaker);
      const avatar = card.querySelector('.friend-avatar');
      if (avatar) avatar.classList.toggle('talking', isCardSpeaker);
    });
  }

  // ==========================================
  // CHANNEL & PRIVACY PIN
  // ==========================================

  async function setupCrypto() {
    await window.simpleCrypto.setPin(activeChannel, activePin);
  }

  function updateChannelUI() {
    currentChannelName.textContent = `Channel ${activeChannel}`;
    localStorage.setItem('wf_channel', activeChannel);
    localStorage.setItem('wf_pin', activePin);

    // Update PIN lock status
    const isLocked = activePin.length > 0;
    btnTogglePin.classList.toggle('locked', isLocked);
    lockIcon.textContent = isLocked ? '🔒' : '🔓';
    lockText.textContent = isLocked ? `Private PIN: ${activePin}` : 'Public Channel (Tap to Lock with PIN)';
    securityBadge.textContent = isLocked ? '🔒 Private' : '🌐 Open';
    securityBadge.style.color = isLocked ? '#f59e0b' : '#10b981';

    // Highlight chip if matching 3-digit number
    quickChips.forEach(chip => {
      chip.classList.toggle('active', chip.dataset.ch === activeChannel);
    });

    // Update share link
    updateShareLink();
  }

  function switchChannel(newChannel) {
    if (!newChannel) return;
    activeChannel = formatChannel(newChannel);
    updateChannelUI();
    setupCrypto();
    sendJoinChannel();
  }

  // Quick Chips
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      switchChannel(chip.dataset.ch);
    });
  });

  // Next / Prev Channel buttons (Cycle 3-digit channels 001 - 999)
  btnPrevChannel.addEventListener('click', () => {
    let num = parseInt(activeChannel, 10);
    num = num <= 1 ? 999 : num - 1;
    switchChannel(num);
  });

  btnNextChannel.addEventListener('click', () => {
    let num = parseInt(activeChannel, 10);
    num = num >= 999 ? 1 : num + 1;
    switchChannel(num);
  });

  // Custom Channel Modal
  btnChannelPicker.addEventListener('click', () => openModal(modalChannelPicker));
  btnCustomChannel.addEventListener('click', () => openModal(modalChannelPicker));

  document.querySelectorAll('.suggested-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      switchChannel(chip.dataset.choose);
      closeAllModals();
    });
  });

  btnApplyChannel.addEventListener('click', () => {
    const val = inputCustomChannel.value.trim();
    if (val) {
      switchChannel(val);
      inputCustomChannel.value = '';
      closeAllModals();
    }
  });

  // PIN Modal
  btnTogglePin.addEventListener('click', () => {
    inputChannelPin.value = activePin;
    openModal(modalPin);
  });

  btnSavePin.addEventListener('click', async () => {
    activePin = inputChannelPin.value.trim();
    updateChannelUI();
    await setupCrypto();
    sendJoinChannel();
    closeAllModals();
  });

  btnRemovePin.addEventListener('click', async () => {
    activePin = '';
    inputChannelPin.value = '';
    updateChannelUI();
    await setupCrypto();
    sendJoinChannel();
    closeAllModals();
  });

  // ==========================================
  // FRIENDS LIST
  // ==========================================

  function renderFriendsList() {
    friendCount.textContent = friendsInRoom.length;
    friendsList.innerHTML = '';

    if (friendsInRoom.length === 0) {
      friendsList.innerHTML = `
        <div class="empty-friends">
          No friends here yet.<br>Click <strong>Invite</strong> above to send a link!
        </div>
      `;
      return;
    }

    friendsInRoom.forEach(f => {
      const isMe = f.id === myId;
      const card = document.createElement('div');
      card.className = 'friend-card' + (f.isTalking ? ' talking' : '');
      card.dataset.id = f.id;

      card.innerHTML = `
        <div class="friend-left">
          <div class="friend-avatar ${f.isTalking ? 'talking' : ''}" style="background-color: ${f.avatarColor || '#10b981'}">
            ${(f.name || 'F')[0].toUpperCase()}
          </div>
          <div>
            <span class="friend-name">${f.name}</span>
            ${isMe ? '<span class="friend-you">(You)</span>' : ''}
          </div>
        </div>
        <span class="friend-talking-badge">Speaking 🎙️</span>
      `;

      friendsList.appendChild(card);
    });
  }

  // ==========================================
  // SHARE & INVITE
  // ==========================================

  function updateShareLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete('channel');
    url.searchParams.set('ch', activeChannel);
    if (activePin) {
      url.searchParams.set('pin', activePin);
    } else {
      url.searchParams.delete('pin');
    }
    inputShareLink.value = url.toString();
  }

  btnShare.addEventListener('click', () => {
    updateShareLink();
    openModal(modalShare);
  });

  btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(inputShareLink.value);
    btnCopyLink.textContent = 'COPIED!';
    setTimeout(() => { btnCopyLink.textContent = 'COPY LINK'; }, 1500);
  });

  async function fetchQrInfo() {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      if (data.qrCodeDataUrl) {
        shareQrCode.src = data.qrCodeDataUrl;
      }
    } catch (e) {
      console.warn('Could not load QR code:', e);
    }
  }

  // ==========================================
  // SETTINGS & PROFILE
  // ==========================================

  function updateProfileUI() {
    myNameMini.textContent = userName;
    myAvatarMini.textContent = (userName || 'A')[0].toUpperCase();
    myAvatarMini.style.backgroundColor = userAvatarColor;
    inputUserName.value = userName;
    localStorage.setItem('wf_name', userName);
  }

  btnProfile.addEventListener('click', () => openModal(modalSettings));
  btnSettings.addEventListener('click', () => openModal(modalSettings));

  btnSaveName.addEventListener('click', () => {
    const val = inputUserName.value.trim();
    if (val) {
      userName = val;
      updateProfileUI();
      sendJoinChannel();
      closeAllModals();
    }
  });

  chkSoundFx.addEventListener('change', () => {
    window.simpleAudio.soundEffects = chkSoundFx.checked;
    beepToggleText.textContent = chkSoundFx.checked ? 'Beeps: ON' : 'Beeps: OFF';
  });

  btnTestMic.addEventListener('click', async () => {
    btnTestMic.textContent = 'Testing... Speak into Mic';
    const ok = await window.simpleAudio.initMic();
    if (ok) {
      window.simpleAudio.playChirp();
      setTimeout(() => {
        btnTestMic.textContent = '✅ Mic Working!';
        setTimeout(() => { btnTestMic.textContent = '🎤 Test My Microphone'; }, 2000);
      }, 1500);
    } else {
      btnTestMic.textContent = '❌ Mic Access Denied';
    }
  });

  // ==========================================
  // MODAL HELPERS
  // ==========================================

  function openModal(modal) {
    closeAllModals();
    modal.classList.add('show');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('show'));
  }

  btnClosePinModal.addEventListener('click', closeAllModals);
  btnCloseChannelModal.addEventListener('click', closeAllModals);
  btnCloseShareModal.addEventListener('click', closeAllModals);
  btnCloseSettingsModal.addEventListener('click', closeAllModals);

  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) closeAllModals();
    });
  });

});
