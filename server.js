const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const selfsigned = require('selfsigned');
const QRCode = require('qrcode');

const app = express();
const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

app.use(express.static(path.join(__dirname, 'public')));

// Network info API
app.get('/api/info', async (req, res) => {
  const ips = getLocalIpAddresses();
  const primaryIp = ips[0] || 'localhost';
  const httpUrl = `http://${primaryIp}:${HTTP_PORT}`;
  const httpsUrl = `https://${primaryIp}:${HTTPS_PORT}`;
  
  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(httpsUrl, { margin: 1, width: 220 });
  } catch (err) {
    console.error('QR code generation error:', err);
  }

  res.json({
    primaryIp,
    ips,
    httpPort: HTTP_PORT,
    httpsPort: HTTPS_PORT,
    httpUrl,
    httpsUrl,
    qrCodeDataUrl
  });
});

// TLS Certificate Setup
async function initTlsCertificates() {
  const certPath = path.join(__dirname, '.cert');
  if (!fs.existsSync(certPath)) {
    fs.mkdirSync(certPath, { recursive: true });
  }

  const certFile = path.join(certPath, 'cert.pem');
  const keyFile = path.join(certPath, 'key.pem');

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return {
      cert: fs.readFileSync(certFile, 'utf8'),
      key: fs.readFileSync(keyFile, 'utf8')
    };
  }

  const attrs = [{ name: 'commonName', value: 'WalkieFriends-App' }];
  const pems = await selfsigned.generate(attrs, { days: 365, keySize: 2048 });
  fs.writeFileSync(certFile, pems.cert, 'utf8');
  fs.writeFileSync(keyFile, pems.private, 'utf8');

  return {
    cert: pems.cert,
    key: pems.private
  };
}

const wss = new WebSocketServer({ noServer: true });

/**
 * Connected clients map:
 * ws -> { id, name, channel, pin, avatarColor, isTalking }
 */
const clients = new Map();

const AVATAR_COLORS = [
  '#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#9b59b6', '#00d2d3', '#e056fd', '#ff6b81'
];

function getRandomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

function normalizeChannel(ch) {
  const num = parseInt(ch, 10);
  if (isNaN(num) || num < 1) return '101';
  const clamped = Math.max(1, Math.min(999, num));
  return String(clamped).padStart(3, '0');
}

function getChannelFriends(channel, pin) {
  const list = [];
  for (const client of clients.values()) {
    if (client.channel === channel && (client.pin || '') === (pin || '')) {
      list.push({
        id: client.id,
        name: client.name,
        avatarColor: client.avatarColor,
        isTalking: client.isTalking
      });
    }
  }
  return list;
}

function broadcastChannelUsers(channel, pin) {
  const friends = getChannelFriends(channel, pin);
  const msg = JSON.stringify({
    type: 'channel_friends',
    channel,
    friends
  });

  for (const [ws, client] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN && client.channel === channel && (client.pin || '') === (pin || '')) {
      ws.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  const clientId = 'USER-' + Math.random().toString(36).substring(2, 7).toUpperCase();
  
  clients.set(ws, {
    id: clientId,
    name: 'Friend ' + Math.floor(10 + Math.random() * 90),
    channel: '101',
    pin: '',
    avatarColor: getRandomColor(),
    isTalking: false
  });

  ws.send(JSON.stringify({
    type: 'welcome',
    id: clientId,
    defaultName: clients.get(ws).name,
    avatarColor: clients.get(ws).avatarColor
  }));

  ws.on('message', (message, isBinary) => {
    try {
      const client = clients.get(ws);
      if (!client) return;

      const text = message.toString();
      const data = JSON.parse(text);

      switch (data.type) {
        case 'join_channel': {
          const oldChannel = client.channel;
          const oldPin = client.pin;

          client.channel = normalizeChannel(data.channel);
          client.pin = String(data.pin || '').trim();
          if (data.name) {
            client.name = String(data.name).trim().substring(0, 20) || client.name;
          }
          if (data.avatarColor) {
            client.avatarColor = data.avatarColor;
          }

          // Update users list in old channel and new channel
          if (oldChannel !== client.channel || oldPin !== client.pin) {
            broadcastChannelUsers(oldChannel, oldPin);
          }
          broadcastChannelUsers(client.channel, client.pin);
          break;
        }

        case 'talk_start': {
          client.isTalking = true;
          // Notify channel friends that this user is currently talking
          broadcastToChannel(client, {
            type: 'friend_talking',
            id: client.id,
            name: client.name,
            avatarColor: client.avatarColor,
            isTalking: true
          }, ws);
          break;
        }

        case 'talk_end': {
          client.isTalking = false;
          broadcastToChannel(client, {
            type: 'friend_talking',
            id: client.id,
            name: client.name,
            avatarColor: client.avatarColor,
            isTalking: false,
            rogerBeep: data.rogerBeep !== false
          }, ws);
          break;
        }

        case 'voice_packet': {
          // Zero-knowledge forwarding of audio chunk to friends on the same channel & PIN
          broadcastToChannel(client, {
            type: 'voice_packet',
            senderId: client.id,
            name: client.name,
            iv: data.iv,
            ciphertext: data.ciphertext,
            isEncrypted: !!data.isEncrypted,
            seq: data.seq
          }, ws);
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong', time: data.time }));
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      const { channel, pin } = client;
      clients.delete(ws);
      broadcastChannelUsers(channel, pin);
    }
  });
});

function broadcastToChannel(sender, payload, excludeWs = null) {
  const msg = JSON.stringify(payload);
  for (const [ws, client] of clients.entries()) {
    if (ws === excludeWs) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;

    // Strict channel and PIN match
    if (client.channel === sender.channel && (client.pin || '') === (sender.pin || '')) {
      ws.send(msg);
    }
  }
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

async function start() {
  const httpServer = http.createServer(app);

  let httpsServer = null;
  if (!IS_PRODUCTION) {
    try {
      const certs = await initTlsCertificates();
      httpsServer = https.createServer({ key: certs.key, cert: certs.cert }, app);
    } catch (err) {
      console.warn('Could not initialize local HTTPS server:', err.message);
    }
  }

  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  if (httpsServer) {
    httpsServer.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
  }

  httpServer.listen(HTTP_PORT, () => {
    console.log(`\n======================================================`);
    console.log(`💬  WALKIE FRIENDS APP RUNNING`);
    console.log(`======================================================`);
    console.log(`> Local Web:   http://localhost:${HTTP_PORT}`);
    const ips = getLocalIpAddresses();
    ips.forEach(ip => {
      console.log(`> Network Web: http://${ip}:${HTTP_PORT}`);
    });

    if (httpsServer) {
      httpsServer.listen(HTTPS_PORT, () => {
        console.log(`\n🔒 SECURE HTTPS (Phone camera & Wi-Fi support):`);
        console.log(`> Local HTTPS:   https://localhost:${HTTPS_PORT}`);
        ips.forEach(ip => {
          console.log(`> Network HTTPS: https://${ip}:${HTTPS_PORT}`);
        });
        console.log(`======================================================\n`);
      });
    } else {
      console.log(`======================================================\n`);
    }
  });
}

start();
