import express from 'express';
import qrcode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys';

const LOG = pino({ level: 'info' });

const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.SESSION_DIR || './session';
const API_TOKEN = process.env.API_TOKEN || 'changeme';
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '';

let sock = null;
let lastQrDataUrl = null;

function formatToJid(number) {
  const digits = number.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    logger: LOG,
    printQRInTerminal: false,
    auth: state,
    version
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      lastQrDataUrl = await qrcode.toDataURL(qr);
      LOG.info('✅ QR ready — visit /qr to scan');
    }
    if (connection === 'open') {
      LOG.info('✅ WhatsApp Connected');
      lastQrDataUrl = null;
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      if (shouldReconnect) startSock();
    }
  });
}

await startSock();

const app = express();
app.use(express.json());

app.get('/qr', (req, res) => {
  if (!lastQrDataUrl) return res.send('No QR available or already connected');
  res.send(`<img src="${lastQrDataUrl}" />`);
});

app.post('/api/send', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${API_TOKEN}`) return res.status(401).json({ error: 'unauthorized' });

  const { number, message } = req.body;
  if (!number || !message) return res.status(400).json({ error: 'number and message required' });

  const jid = formatToJid(number);
  const [check] = await sock.onWhatsApp(jid);
  if (!check?.exists) {
    return res.json({ sent: false, reason: 'not_on_whatsapp' });
  }

  await sock.sendMessage(jid, { text: message });

  if (ADMIN_NUMBER) {
    const adminJid = formatToJid(ADMIN_NUMBER);
    await sock.sendMessage(adminJid, { text: `✅ Message sent to ${number}` });
  }

  res.json({ sent: true });
});

app.listen(PORT, () => LOG.info(`🚀 Server running on port ${PORT}`));
