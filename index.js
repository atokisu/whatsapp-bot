global.crypto = require('crypto');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const { Boom } = require('@hapi/boom');
const crypto = require('crypto'); // ✅ FIX: This line is added

const app = express();
const port = process.env.PORT || 3000;
const API_SECRET_KEY = process.env.API_SECRET_KEY || "YourSecretKey"; 

app.use(express.json());

let sock;
let qrCode = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCode = qr;
            console.log('QR code received. Scan it to connect.');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            qrCode = null;
            console.log('WhatsApp connection opened');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${API_SECRET_KEY}`) {
        return res.status(403).json({ success: false, message: 'Forbidden: Invalid API Key' });
    }
    next();
};

app.get('/', (req, res) => {
    if (qrCode) {
        res.send(`<p>Scan this QR code with your WhatsApp app (Linked Devices):</p><br><img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}">`);
    } else if (sock && sock.user) {
         res.send(`<p>WhatsApp Bot is connected successfully!</p><p>Connected as: ${sock.user.name || 'Unknown'}</p>`);
    } else {
        res.send('<p>Connecting to WhatsApp... Please refresh in a moment.</p>');
    }
});

app.post('/send-message', authMiddleware, async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ success: false, message: 'Number and message are required.' });
    }
    
    if (!sock || !sock.user) {
        return res.status(500).json({ success: false, message: 'WhatsApp is not connected yet.' });
    }

    try {
        const formattedNumber = number.startsWith('88') ? number : `88${number}`;
        const whatsappId = `${formattedNumber}@s.whatsapp.net`;

        const [result] = await sock.onWhatsApp(whatsappId);

        if (result && result.exists) {
            await sock.sendMessage(whatsappId, { text: message });
            res.status(200).json({ success: true, message: 'Message sent successfully.' });
        } else {
            res.status(200).json({ success: false, message: 'User does not have WhatsApp.' });
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
});


connectToWhatsApp().then(() => {
    app.listen(port, () => {
        console.log(`WhatsApp bot server is listening on port ${port}`);
    });
});