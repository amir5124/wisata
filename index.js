const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const twilio = require("twilio");
const { initializeApp } = require("firebase/app");
const {
    getDatabase, ref, query, orderByChild, equalTo, get, update, set, runTransaction
} = require("firebase/database");

// ============================================================
// 🔥 FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyD8P9au26mC8xx8UcjNsm-NMW5JUgTHUBU",
    authDomain: "linku-3ca65.firebaseapp.com",
    databaseURL: "https://linku-3ca65-default-rtdb.firebaseio.com",
    projectId: "linku-3ca65",
    storageBucket: "linku-3ca65.appspot.com",
    messagingSenderId: "759194220603",
    appId: "1:759194220603:web:33e2327dfa94af2552841e"
};

const FIREBASE = initializeApp(firebaseConfig);
const databaseFire = getDatabase(FIREBASE);

// ============================================================
// ⚙️ EXPRESS SETUP
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());
require('dotenv').config();

// ============================================================
// 📱 TWILIO SETUP
// ============================================================
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// ============================================================
// 🔐 LINKQU CREDENTIALS
// ============================================================
const clientId = "testing";
const clientSecret = "123";
const username = "LI307GXIN";
const pin = "2K2NPCBBNNTovgB";
const serverKey = "LinkQu@2020";

// ============================================================
// 📱 NOMOR WHATSAPP ADMIN
// ============================================================
const ADMIN_WHATSAPP = "+6281347423599";
const TWILIO_WA_FROM = "whatsapp:+62882005447472";
const TWILIO_CONTENT_SID = "HXebc8155c0e6bdcfd92f6513e304cfc4e";

// ============================================================
// 📝 LOGGER
// ============================================================
function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] ${message}\n`;

    fs.appendFile(logPath, fullMessage, (err) => {
        if (err) console.error("❌ Gagal menulis log:", err);
    });
}

// ============================================================
// 🛡️ SANITASI INPUT
// ============================================================
function sanitizeName(name) {
    if (!name || typeof name !== 'string') return "Pelanggan";
    const trimmed = name.trim();
    // Buang placeholder {username} / {nama} / dll
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return "Pelanggan";
    if (trimmed === "" || trimmed.toLowerCase() === "username") return "Pelanggan";
    return trimmed;
}

function sanitizePhone(phone) {
    if (!phone || typeof phone !== 'string') return null;
    const trimmed = phone.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return null;
    return trimmed;
}

// ============================================================
// 🔄 TIMESTAMP HELPERS
// ============================================================
function getExpiredTimestamp(minutesFromNow = 15) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}

const getFormatNow = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

// ============================================================
// 🔐 SIGNATURE GENERATORS
// ============================================================
function generateSignaturePOST({
    amount, expired, bank_code, partner_reff,
    customer_id, customer_name, customer_email,
    clientId, serverKey
}) {
    const path = '/transaction/create/va';
    const method = 'POST';
    const rawValue = amount + expired + bank_code + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

function generateSignatureQRIS({
    amount, expired, partner_reff,
    customer_id, customer_name, customer_email,
    clientId, serverKey
}) {
    const path = '/transaction/create/qris';
    const method = 'POST';
    const rawValue = amount + expired + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// ============================================================
// 🧾 PARTNER REFF GENERATOR
// ============================================================
function generatePartnerReff() {
    const prefix = 'INV-782372373627';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${randomStr}`;
}

// ============================================================
// ✅ ENDPOINT: CREATE VA
// ============================================================
app.post('/create-va', async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://wisata.siappgo.id/callback";

        // ✅ Ambil customer_name & phone dari frontend (dengan sanitasi)
        const customerName = sanitizeName(body.customer_name || body.name);
        const customerPhone = sanitizePhone(body.customer_phone || body.phone);
        const customerEmail = body.customer_email || "bocahangon64@gmail.com";
        const customerId = body.customer_id || `CUST-${Date.now()}`;

        const signature = generateSignaturePOST({
            amount: body.amount,
            expired,
            bank_code: body.bank_code,
            partner_reff,
            customer_id: customerId,
            customer_name: customerName,
            customer_email: customerEmail,
            clientId,
            serverKey
        });

        const payload = {
            ...body,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            url_callback,
            customer_id: customerId,
            customer_name: customerName,
            customer_email: customerEmail
        };

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        const url = 'https://gateway-dev.linkqu.id/linkqu-partner/transaction/create/va';
        const response = await axios.post(url, payload, { headers });
        const result = response.data;

        const insertData = {
            partner_reff,
            customer_id: customerId,
            customer_name: customerName,
            amount: body.amount,
            bank_code: result?.bank_name || null,
            expired,
            customer_phone: customerPhone,
            customer_email: customerEmail,
            va_number: result?.virtual_account || null,
            response_raw: result,
            created_at: new Date().toISOString(),
            status: "PENDING",
            date: body.date || "2025-08-11",
            name: body.name || "OPEN TRIP IKN",
            note: body.note || "",
            pax: body.pax || "1"
        };

        await set(ref(databaseFire, `inquiry_va/${partner_reff}`), insertData);
        res.json(result);
    } catch (err) {
        console.error('❌ Gagal membuat VA:', err.message);
        res.status(500).json({
            error: "Gagal membuat VA",
            detail: err.response?.data || err.message
        });
    }
});

// ============================================================
// ✅ ENDPOINT: CREATE QRIS
// ============================================================
app.post('/create-qris', async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://wisata.siappgo.id/callback";

        // ✅ Ambil customer_name & phone dari frontend
        const customerName = sanitizeName(body.customer_name || body.name);
        const customerPhone = sanitizePhone(body.customer_phone || body.phone);
        const customerEmail = body.customer_email || "bocahangon64@gmail.com";
        const customerId = body.customer_id || `CUST-${Date.now()}`;

        const signature = generateSignatureQRIS({
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: customerId,
            customer_name: customerName,
            customer_email: customerEmail,
            clientId,
            serverKey
        });

        const payload = {
            ...body,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            url_callback,
            customer_id: customerId,
            customer_name: customerName,
            customer_email: customerEmail
        };

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        const url = 'https://gateway-dev.linkqu.id/linkqu-partner/transaction/create/qris';
        const response = await axios.post(url, payload, { headers });

        const result = response.data;

        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer' });
                qrisImageBuffer = Buffer.from(imgResp.data).toString('base64');
            } catch (err) {
                console.error("⚠️ Failed to download QRIS image:", err.message);
            }
        }

        const insertData = {
            partner_reff,
            customer_id: customerId,
            customer_name: customerName,
            amount: body.amount,
            expired,
            customer_phone: customerPhone,
            customer_email: customerEmail,
            qris_url: result?.imageqris || null,
            qris_image_base64: qrisImageBuffer || null,
            response_raw: result,
            created_at: new Date().toISOString(),
            status: "PENDING",
            date: body.date || "2025-08-11",
            name: body.name || "OPEN TRIP IKN",
            note: body.note || "",
            pax: body.pax || "1"
        };

        await set(ref(databaseFire, `inquiry_qris/${partner_reff}`), insertData);
        res.json(result);

    } catch (err) {
        console.error(`❌ Gagal membuat QRIS: ${err.message}`);
        res.status(500).json({
            error: "Gagal membuat QRIS",
            detail: err.response?.data || err.message
        });
    }
});

// ============================================================
// ✅ ENDPOINT: DOWNLOAD QRIS
// ============================================================
app.get('/download-qr/:partner_reff', async (req, res) => {
    const partner_reff = req.params.partner_reff;

    try {
        const dbRef = ref(databaseFire, `inquiry_qris/${partner_reff}`);
        const snapshot = await get(dbRef);

        if (!snapshot.exists()) {
            return res.status(404).send('QRIS tidak ditemukan di database.');
        }

        const data = snapshot.val();

        if (data.qris_image_base64) {
            console.log(`✅ QR ditemukan di Firebase (base64): ${partner_reff}`);
            const imgBuffer = Buffer.from(data.qris_image_base64, 'base64');
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(imgBuffer);
        }

        if (data.qris_url) {
            console.log(`🔗 Download QR dari URL: ${data.qris_url}`);
            const response = await axios.get(data.qris_url.trim(), { responseType: 'arraybuffer' });
            const imgBuffer = Buffer.from(response.data);

            const base64Str = imgBuffer.toString('base64');
            await set(ref(databaseFire, `inquiry_qris/${partner_reff}/qris_image_base64`), base64Str);

            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(imgBuffer);
        }

        return res.status(404).send('QRIS tidak memiliki data gambar.');

    } catch (err) {
        console.error(`❌ Error download QR: ${err.message}`);
        res.status(500).send('Terjadi kesalahan server.');
    }
});

// ============================================================
// 📱 FORMAT NOMOR WHATSAPP
// ============================================================
function formatToWhatsAppNumber(localNumber) {
    if (typeof localNumber !== 'string') return null;

    const cleanNumber = localNumber.replace(/\D/g, '');
    if (cleanNumber.startsWith('0')) return `+62${cleanNumber.slice(1)}`;
    if (cleanNumber.startsWith('62')) return `+${cleanNumber}`;
    if (cleanNumber.startsWith('+62')) return cleanNumber;
    return null;
}

// ============================================================
// 📤 KIRIM WHATSAPP
// ============================================================
async function sendWhatsAppMessage(to, variables) {
    try {
        const response = await client.messages.create({
            from: TWILIO_WA_FROM,
            to: `whatsapp:${to}`,
            contentSid: TWILIO_CONTENT_SID,
            contentVariables: JSON.stringify(variables),
        });
        console.log(`✅ Pesan WhatsApp terkirim ke ${to}:`, response.sid);
        return { status: true, message: "Pesan berhasil dikirim." };
    } catch (error) {
        console.error(`❌ Gagal mengirim pesan WhatsApp ke ${to}:`, error.message);
        return { status: false, message: error.message };
    }
}

// ============================================================
// ✅ ADD BALANCE — HANYA KIRIM WA (TANPA UPDATE SALDO LINKU)
// ============================================================
async function addBalance(partner_reff, va_code, serialnumber) {
    try {
        const dbPath = va_code === "QRIS"
            ? `inquiry_qris/${partner_reff}`
            : `inquiry_va/${partner_reff}`;
        const snap = await get(ref(databaseFire, dbPath));

        if (!snap.exists()) throw new Error(`Data ${partner_reff} tidak ditemukan.`);
        const data = snap.val();
        const originalAmount = parseInt(data.amount);

        // ✅ Siapkan variabel untuk template WA
        const variables = {
            "1": String(sanitizeName(data.customer_name)),
            "2": String(data.partner_reff || partner_reff),
            "3": `Rp${originalAmount.toLocaleString("id-ID")}`,
            "4": String(va_code),
            "5": String(serialnumber),
            "6": String(data.date || "-"),
            "7": String(data.name || "OPEN TRIP IKN"),
            "8": String(data.note || "-"),
            "9": String(data.pax || "1"),
        };

        // 1️⃣ Kirim WA ke CUSTOMER (background)
        const recipientWhatsApp = formatToWhatsAppNumber(data.customer_phone);
        if (recipientWhatsApp) {
            sendWhatsAppMessage(recipientWhatsApp, variables).catch(err =>
                console.error("⚠️ Background WA Customer Error:", err.message)
            );
        } else {
            console.warn(`⚠️ Nomor customer tidak valid: ${data.customer_phone}`);
        }

        // 2️⃣ Kirim WA ke ADMIN (background)
        sendWhatsAppMessage(ADMIN_WHATSAPP, variables).catch(err =>
            console.error("⚠️ Background WA Admin Error:", err.message)
        );

        console.log("✅ Notifikasi WhatsApp selesai diproses.");
        return { status: true };

    } catch (error) {
        console.error("❌ Gagal di addBalance:", error.message);
        throw error;
    }
}

// ============================================================
// ✅ CALLBACK — WAJIB SUKSES, addBalance di BACKGROUND
// ============================================================
app.post("/callback", async (req, res) => {
    const { partner_reff, va_code, serialnumber } = req.body;

    try {
        const dbPath = (va_code === "QRIS")
            ? `inquiry_qris/${partner_reff}`
            : `inquiry_va/${partner_reff}`;
        const statusRef = ref(databaseFire, dbPath);

        // 🔒 TRANSACTION untuk locking (hindari race condition)
        const result = await runTransaction(statusRef, (currentData) => {
            if (currentData) {
                if (currentData.status === "SUKSES") {
                    return; // sudah sukses → batalkan
                }
                currentData.status = "SUKSES";
                return currentData;
            }
            return currentData;
        });

        // ✅ Kalau sudah pernah diproses → tetap response 200
        if (!result.committed) {
            console.log(`ℹ️ Transaksi ${partner_reff} sudah diproses sebelumnya.`);
            return res.status(200).json({ status: "SUCCESS", message: "Sudah diproses" });
        }

        console.log(`✅ Transaksi ${partner_reff} berhasil ditandai SUKSES.`);

        // 🔥 FIRE-AND-FORGET: addBalance di background (TIDAK di-await)
        // Callback langsung sukses walau WA lambat
        addBalance(partner_reff, va_code, serialnumber).catch(err =>
            console.error("⚠️ Background addBalance Error:", err.message)
        );

        // ✅ RESPONSE WAJIB 200 ke Linku
        return res.status(200).json({
            status: "SUCCESS",
            message: "Pembayaran berhasil dicatat"
        });

    } catch (err) {
        console.error(`❌ Callback Error: ${err.message}`);

        // ⚠️ Tetap balas 200 agar Linku tidak retry berkali-kali
        return res.status(200).json({
            status: "SUCCESS",
            message: "Callback diterima"
        });
    }
});

// ============================================================
// ✅ CHECK STATUS
// ============================================================
app.get('/check-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;
    try {
        const response = await axios.get(
            `https://gateway-dev.linkqu.id/linkqu-partner/transaction/payment/checkstatus`,
            {
                params: { username, partnerreff: partner_reff },
                headers: { 'client-id': clientId, 'client-secret': clientSecret }
            }
        );
        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ✅ CEK STATUS DARI FIREBASE (bukan LinkQu)
// ============================================================
app.get('/check-local-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;

    try {
        // Coba cek di inquiry_va dulu
        let snap = await get(ref(databaseFire, `inquiry_va/${partner_reff}`));
        let source = 'va';

        // Kalau tidak ada, cek di inquiry_qris
        if (!snap.exists()) {
            snap = await get(ref(databaseFire, `inquiry_qris/${partner_reff}`));
            source = 'qris';
        }

        if (!snap.exists()) {
            return res.status(404).json({
                success: false,
                message: "Transaksi tidak ditemukan di database"
            });
        }

        const data = snap.val();

        return res.status(200).json({
            success: true,
            source,
            partner_reff,
            status: data.status,          // "PENDING" | "SUKSES"
            customer_name: data.customer_name,
            amount: data.amount,
            va_number: data.va_number || null,
            qris_url: data.qris_url || null,
            created_at: data.created_at,
            is_paid: data.status === "SUKSES"
        });

    } catch (err) {
        console.error(`❌ Error check-local-status: ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// ✅ HELPER STATUS INQUIRY
// ============================================================
async function getCurrentStatusVa(partnerReff) {
    try {
        const snap = await get(ref(databaseFire, `inquiry_va/${partnerReff}/status`));
        return snap.exists() ? snap.val() : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_va: ${error.message}`);
        throw error;
    }
}

async function updateInquiryStatus(partnerReff) {
    try {
        await update(ref(databaseFire, `inquiry_va/${partnerReff}`), { status: "SUKSES" });
        console.log(`✅ Status inquiry_va untuk ${partnerReff} berhasil diubah menjadi SUKSES`);
    } catch (error) {
        console.error(`❌ Gagal update status inquiry_va: ${error.message}`);
        throw error;
    }
}

async function getCurrentStatusQris(partnerReff) {
    try {
        const snap = await get(ref(databaseFire, `inquiry_qris/${partnerReff}/status`));
        return snap.exists() ? snap.val() : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_qris: ${error.message}`);
        throw error;
    }
}

async function updateInquiryStatusQris(partnerReff) {
    try {
        await update(ref(databaseFire, `inquiry_qris/${partnerReff}`), { status: "SUKSES" });
        console.log(`✅ Status inquiry_qris untuk ${partnerReff} berhasil diubah menjadi SUKSES`);
    } catch (error) {
        console.error(`❌ Gagal update status inquiry_qris: ${error.message}`);
        throw error;
    }
}

// ============================================================
// ✅ LIST VA (dari Firebase)
// ============================================================
app.get('/va-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        const snap = await get(ref(databaseFire, 'inquiry_va'));
        if (!snap.exists()) return res.json([]);

        const all = snap.val();
        const now = Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        const results = [];

        for (const key of Object.keys(all)) {
            const row = all[key];
            // Hapus PENDING yang expired > 15 menit
            if (row.status === 'PENDING' && row.created_at) {
                const age = now - new Date(row.created_at).getTime();
                if (age > fifteenMinutes) {
                    await set(ref(databaseFire, `inquiry_va/${key}`), null);
                    continue;
                }
            }
            if (row.customer_name === username) {
                results.push({
                    bank_code: row.bank_code,
                    va_number: row.va_number,
                    amount: row.amount,
                    status: row.status,
                    customer_name: row.customer_name,
                    expired: row.expired,
                    created_at: row.created_at
                });
            }
        }

        results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json(results.slice(0, 5));
    } catch (err) {
        console.error("DB error (va-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data VA" });
    }
});

// ============================================================
// ✅ LIST QRIS (dari Firebase)
// ============================================================
app.get('/qr-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        const snap = await get(ref(databaseFire, 'inquiry_qris'));
        if (!snap.exists()) return res.json([]);

        const all = snap.val();
        const now = Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        const results = [];

        for (const key of Object.keys(all)) {
            const row = all[key];
            if (row.status === 'PENDING' && row.created_at) {
                const age = now - new Date(row.created_at).getTime();
                if (age > fifteenMinutes) {
                    await set(ref(databaseFire, `inquiry_qris/${key}`), null);
                    continue;
                }
            }
            if (row.customer_name === username) {
                results.push({
                    partner_reff: row.partner_reff,
                    amount: row.amount,
                    status: row.status,
                    customer_name: row.customer_name,
                    qris_url: row.qris_url,
                    expired: row.expired,
                    created_at: row.created_at
                });
            }
        }

        results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json(results.slice(0, 5));
    } catch (err) {
        console.error("DB error (qr-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data QR" });
    }
});

// ============================================================
// 🚀 START SERVER
// ============================================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`📱 Notifikasi WhatsApp customer + admin (${ADMIN_WHATSAPP})`);
    console.log(`✅ Callback mode: FIRE-AND-FORGET (anti timeout)`);
});