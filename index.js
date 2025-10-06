const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require('express');
const http = require('http');

// Express অ্যাপ শুরু করুন
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const API_SECRET_KEY = process.env.API_SECRET_KEY || "your-secret-key"; // একটি শক্তিশালী কী ব্যবহার করুন

// JSON বডি পার্স করার জন্য মিডলওয়্যার
app.use(express.json());

// Logger সেটআপ
const logger = pino({
    level: "info",
    transport: {
        target: "pino-pretty"
    }
});

let sock; // sock ভ্যারিয়েবলটি গ্লোবালি ডিক্লেয়ার করুন

/**
 * নম্বর ফরম্যাট করার ফাংশন
 * @param {string} number
 * @returns {string}
 */
const formatPhoneNumber = (number) => {
    let formatted = number.replace(/\D/g, ''); // শুধু সংখ্যা রাখুন
    if (formatted.startsWith('880') && formatted.length === 13) {
        return `${formatted}@s.whatsapp.net`;
    }
    if (formatted.startsWith('0') && formatted.length === 11) {
        return `88${formatted}@s.whatsapp.net`;
    }
    return `${formatted}@s.whatsapp.net`; // ডিফল্ট ফরম্যাট
};


/**
 * WhatsApp বট শুরু করার ফাংশন
 */
async function startBot() {
    try {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState("auth_info");
        const {
            version,
            isLatest
        } = await fetchLatestBaileysVersion();
        logger.info(`Using Baileys v${version.join(".")}, Latest: ${isLatest}`);

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: true,
            logger: pino({
                level: 'silent'
            }),
            browser: ["Laravel-Bot", "Chrome", "120.0"],
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: true,
        });

        // কানেকশন স্ট্যাটাস হ্যান্ডেল করুন
        sock.ev.on("connection.update", (update) => {
            const {
                connection,
                lastDisconnect,
                qr
            } = update || {};

            if (qr) {
                logger.info("QR code generated. Please scan.");
                // আপনি চাইলে QR কোড একটি ফাইলে সেভ করতে পারেন বা অন্য কোথাও দেখাতে পারেন
            }

            if (connection === "close") {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401; // 401 হলে QR আবার স্ক্যান করতে হবে
                logger.error(`Connection closed. Reconnecting: ${shouldReconnect}`);
                if (shouldReconnect) {
                    startBot();
                }
            } else if (connection === "open") {
                logger.info("✅ WhatsApp bot connected successfully!");
            }
        });

        // ক্রেডেনশিয়াল সেভ করুন
        sock.ev.on("creds.update", saveCreds);

    } catch (error) {
        logger.error("❌ Failed to start bot:", error);
    }
}


// API Security Middleware
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === API_SECRET_KEY) {
        next();
    } else {
        res.status(401).json({
            status: 'error',
            message: 'Unauthorized: Invalid API Key'
        });
    }
};


// API Endpoints
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'WhatsApp API server is running.'
    });
});

app.post('/send-message', checkApiKey, async (req, res) => {
    const {
        number,
        message
    } = req.body;

    if (!number || !message) {
        return res.status(400).json({
            status: 'error',
            message: 'Number and message are required.'
        });
    }

    if (!sock || sock.ws.readyState !== 1) {
         return res.status(503).json({
            status: 'error',
            message: 'Bot is not connected. Please wait or check logs.'
        });
    }

    const formattedNumber = formatPhoneNumber(number);

    try {
        // এই নম্বরে হোয়াটসঅ্যাপ আছে কিনা চেক করুন
        const [result] = await sock.onWhatsApp(formattedNumber);

        if (result && result.exists) {
            await sock.sendMessage(formattedNumber, {
                text: message
            });
            logger.info(`Message sent to ${formattedNumber}`);
            res.status(200).json({
                status: 'success',
                message: `Message sent to ${number}`
            });
        } else {
            // হোয়াটসঅ্যাপ না থাকলে কোনো মেসেজ না পাঠিয়ে শুধু লগ করুন
            logger.warn(`Number ${number} does not have WhatsApp. Skipping.`);
            res.status(202).json({
                status: 'skipped',
                message: `Number ${number} does not have an active WhatsApp account.`
            });
        }
    } catch (error) {
        logger.error(`Failed to send message to ${number}:`, error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to send message.'
        });
    }
});


// সার্ভার চালু করুন
server.listen(PORT, () => {
    logger.info(`Server is listening on port ${PORT}`);
    startBot(); // বট কানেকশন শুরু করুন
});
