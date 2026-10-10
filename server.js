const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const chatMemory = new Map();

// रामेश्वर स्वतः बोलला तर बॉट तात्पुरता थांबवण्यासाठी
const pausedChats = new Map();
const PAUSE_DURATION = 30 * 60 * 1000; // ३० मिनिटे

async function getAIReply(senderJid, userMessage) {
    try {
        if (!chatMemory.has(senderJid)) {
            chatMemory.set(senderJid, []);
        }
        const history = chatMemory.get(senderJid);

        const promptMessages = [
            {
                role: "system",
                content: "You are Rameshwar's polite, intelligent personal AI assistant on WhatsApp. Language: Casual, natural Marathi in English letters (Marathlish). Keep replies strictly to 1-2 short sentences. If asked GK or definitions like OTP, explain directly. If someone asks for Rameshwar or asks what he is doing, say he is busy with study/projects. If urgent, tell them to call him directly. Never send empty replies."
            },
            ...history.slice(-4),
            {
                role: "user",
                content: userMessage
            }
        ];

        const completion = await groq.chat.completions.create({
            messages: promptMessages,
            model: "openai/gpt-oss-20b",
            temperature: 0.7,
            max_tokens: 100
        });

        let reply = completion.choices[0]?.message?.content?.trim();
        if (!reply) {
            reply = "Haa bola, Rameshwar sathi kahi message ahe ka?";
        }

        history.push({ role: "user", content: userMessage });
        history.push({ role: "assistant", content: reply });
        if (history.length > 8) history.splice(0, 2);

        return reply;
    } catch (err) {
        console.error("GROQ API ERROR:", err.message || err);
        return "Rameshwar ata busy ahe, message asel tar sanga mi sangto tyala.";
    }
}

async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsAppBot();
        } else if (connection === 'open') {
            console.log("\n==========================================");
            console.log("RAMESHWAR'S SMART BOT IS ACTIVE & RUNNING!");
            console.log("==========================================\n");
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg || !msg.message) return;

        const senderJid = msg.key.remoteJid;

        // Group chats आणि Status इग्नोर करा
        if (senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return;

        // तू स्वतः त्या चॅटमध्ये मेसेज केलास, तर बॉट ३० मिनिटे पॉज होईल
        if (msg.key.fromMe) {
            pausedChats.set(senderJid, Date.now() + PAUSE_DURATION);
            console.log(`Rameshwar active in ${senderJid}. Bot paused for 30m.`);
            return;
        }

        // जर चॅट आधीच पॉज असेल तर बॉट बोलणार नाही
        const pauseUntil = pausedChats.get(senderJid) || 0;
        if (Date.now() < pauseUntil) return;

        // बिझनेस बॉट्स ब्लॉक
        const fullSender = senderJid.toLowerCase();
        if (fullSender.includes('amazon') || fullSender.includes('meta')) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        if (!text) return;

        console.log(`Received: ${text}`);

        let reply = "";
        const cleanText = text.toLowerCase();

        if (['hi', 'hello', 'hey', 'hii', 'hiii', 'namaskar', '👋'].includes(cleanText)) {
            reply = "Hi, mi Rameshwar cha personal AI assistant ahe. Bola.";
        } else {
            reply = await getAIReply(senderJid, text);
        }

        await sock.sendMessage(senderJid, { text: reply });
        console.log(`Sent Reply: ${reply}`);
    });
}

startWhatsAppBot();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
