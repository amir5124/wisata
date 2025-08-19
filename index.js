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



const app = express();
app.use(cors());
app.use(express.json());
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);
// 🔐 Konfigurasi kredensial
const clientId = "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = "LI9019VKS";
const pin = "5m6uYAScSxQtCmU";
const serverKey = "QtwGEr997XDcmMb1Pq8S5X1N";

// 📝 Fungsi untuk menulis log ke stderr.log
function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] ${message}\n`;

    fs.appendFile(logPath, fullMessage, (err) => {
        if (err) {
            console.error("❌ Gagal menulis log:", err);
        }
    });
}

// 🔄 Fungsi expired format YYYYMMDDHHmmss
function getExpiredTimestamp(minutesFromNow = 15) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}

const getFormatNow = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

// 🔐 Fungsi membuat signature untuk request POST VA
function generateSignaturePOST({
    amount,
    expired,
    bank_code,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
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
    amount,
    expired,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
}) {
    const path = '/transaction/create/qris';
    const method = 'POST';

    const rawValue = amount + expired + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

    const signToString = path + method + cleaned;

    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// 🧾 Fungsi membuat kode unik partner_reff
function generatePartnerReff() {
    const prefix = 'INV-782372373627';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${randomStr}`;
}

// ✅ Endpoint POST untuk membuat VA
app.post('/create-va', async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://wisata.siappgo.id/callback";

        const signature = generateSignaturePOST({
            amount: body.amount,
            expired,
            bank_code: body.bank_code,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
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
            url_callback
        };

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/va';
        const response = await axios.post(url, payload, { headers });
        const result = response.data;

        // 🔹 Data untuk Firebase
        const insertData = {
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            amount: body.amount,
            bank_code: result?.bank_name || null,
            expired,
            customer_phone: body.customer_phone || null,
            customer_email: body.customer_email,
            va_number: result?.virtual_account || null,
            response_raw: result,
            created_at: new Date().toISOString(),
            status: "PENDING"
        };

        // 💾 Simpan ke Firebase Realtime Database
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


// ✅ Endpoint POST untuk membuat QRIS
app.post('/create-qris', async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://wisata.siappgo.id/callback";

        const signature = generateSignatureQRIS({
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
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
            url_callback
        };

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/qris';
        const response = await axios.post(url, payload, { headers });

        const result = response.data;

        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer' });
                qrisImageBuffer = Buffer.from(imgResp.data).toString('base64'); // simpan base64 ke Firebase
            } catch (err) {
                console.error("⚠️ Failed to download QRIS image:", err.message);
            }
        }

        const insertData = {
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            amount: body.amount,
            expired,
            customer_phone: body.customer_phone || null,
            customer_email: body.customer_email,
            qris_url: result?.imageqris || null,
            qris_image_base64: qrisImageBuffer || null,
            response_raw: result,
            created_at: new Date().toISOString(),
            status: "PENDING"
        };

        // 💾 Simpan ke Firebase Realtime Database
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


app.get('/download-qr/:partner_reff', async (req, res) => {
    const partner_reff = req.params.partner_reff;

    try {
        // 🔹 Ambil data QRIS dari Firebase
        const dbRef = ref(databaseFire, `inquiry_qris/${partner_reff}`);
        const snapshot = await get(dbRef);

        if (!snapshot.exists()) {
            return res.status(404).send('QRIS tidak ditemukan di database.');
        }

        const data = snapshot.val();

        // 1️⃣ Kalau sudah ada gambar base64, kirim langsung
        if (data.qris_image_base64) {
            console.log(`✅ QR ditemukan di Firebase (base64): ${partner_reff}`);
            const imgBuffer = Buffer.from(data.qris_image_base64, 'base64');
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(imgBuffer);
        }

        // 2️⃣ Kalau belum ada base64 tapi ada URL, download dari URL
        if (data.qris_url) {
            console.log(`🔗 Download QR dari URL: ${data.qris_url}`);
            const response = await axios.get(data.qris_url.trim(), { responseType: 'arraybuffer' });
            const imgBuffer = Buffer.from(response.data);

            // Simpan base64-nya ke Firebase supaya nanti tidak perlu download ulang
            const base64Str = imgBuffer.toString('base64');
            await set(ref(databaseFire, `inquiry_qris/${partner_reff}/qris_image_base64`), base64Str);

            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(imgBuffer);
        }

        // Kalau tidak ada keduanya
        return res.status(404).send('QRIS tidak memiliki data gambar.');

    } catch (err) {
        console.error(`❌ Error download QR: ${err.message}`);
        res.status(500).send('Terjadi kesalahan server.');
    }
});

function formatToWhatsAppNumber(localNumber) {
    if (typeof localNumber !== 'string') {
        return null; // Pastikan input berupa string
    }

    const cleanNumber = localNumber.replace(/\D/g, ''); // Hapus karakter non-digit
    if (cleanNumber.startsWith('0')) {
        return `+62${cleanNumber.slice(1)}`;
    }
    if (cleanNumber.startsWith('62')) {
        return `+${cleanNumber}`;
    }
    if (cleanNumber.startsWith('+62')) {
        return `${cleanNumber}`;
    }
    return null; // Nomor tidak valid
}


async function sendWhatsAppMessage(to, variables) {
    try {
        const from = "whatsapp:+62882005447472"; // Nomor WhatsApp bisnis
        const response = await client.messages.create({
            from,
            to: `whatsapp:${to}`,
            contentSid: "HX20213db8cfe7965b307a124f3260fa1e", // Template SID
            contentVariables: JSON.stringify(variables),
        });
        console.log("✅ Pesan WhatsApp terkirim:", response.sid);
        return { status: true, message: "Pesan berhasil dikirim." };
    } catch (error) {
        console.error("❌ Gagal mengirim pesan WhatsApp:", error.message);
        return { status: false, message: error.message };
    }
}


// Fungsi menambahkan saldo dan mengirim WhatsApp
async function addBalance(partner_reff, va_code, serialnumber) {
    try {
        // Tentukan path di Firebase (QRIS atau VA)
        const path = va_code === "QRIS"
            ? `inquiry_qris/${partner_reff}`
            : `inquiry_va/${partner_reff}`;

        // Ambil data dari Firebase
        const snap = await get(ref(databaseFire, path));
        if (!snap.exists()) throw new Error(`Data ${partner_reff} tidak ditemukan di ${path}`);

        const data = snap.val();
        const originalAmount = parseInt(data.amount);

        // Nomor WhatsApp customer
        const recipientWhatsApp = formatToWhatsAppNumber(data.customer_phone);

        // Variabel template pesan WhatsApp
        const variables = {
            "1": String(data.customer_name || "Tidak tersedia"),
            "2": String(data.partner_reff || "Tidak tersedia"),
            "3": `Rp${originalAmount.toLocaleString("id-ID")}`,
            "4": String(va_code),
            "5": String(serialnumber),
        };

        // Kirim WhatsApp ke customer
        await sendWhatsAppMessage(recipientWhatsApp, variables);

        // Catatan transaksi
        const formattedAmount = originalAmount.toLocaleString("id-ID");
        const catatan = `Transaksi ${va_code} sukses || Nominal Rp${formattedAmount} || Biller Reff ${serialnumber}`;
        const username = "WisataByLinkU";

        // Request ke API untuk update saldo
        const formdata = new FormData();
        formdata.append("amount", originalAmount);
        formdata.append("username", username);
        formdata.append("note", catatan);

        const config = {
            method: "post",
            url: "https://linku.co.id/qris.php",
            headers: {
                ...formdata.getHeaders(),
            },
            data: formdata,
        };

        const response = await axios(config);
        console.log("✅ Saldo berhasil ditambahkan:", response.data);

        return {
            status: true,
            message: "Saldo berhasil ditambahkan & WA terkirim",
            data: { ...data, catatan },
            balanceResult: response.data,
        };

    } catch (error) {
        console.error("❌ Gagal menambahkan saldo:", error.message);
        throw new Error("Gagal menambahkan saldo: " + error.message);
    }
}

// Route callback
app.post("/callback", async (req, res) => {
    try {
        const { partner_reff, va_code, serialnumber } = req.body;

        console.log(`✅ Callback diterima: ${JSON.stringify(req.body)}`);

        // Cek status transaksi sebelumnya
        let currentStatus;
        if (va_code === "QRIS") {
            currentStatus = await getCurrentStatusQris(partner_reff);
        } else {
            currentStatus = await getCurrentStatusVa(partner_reff);
        }

        if (currentStatus === "SUKSES") {
            console.log(`ℹ️ Transaksi ${partner_reff} sudah diproses sebelumnya.`);
            return res.json({
                message: "Transaksi sudah SUKSES sebelumnya. Tidak diproses ulang."
            });
        }

        // Tambah saldo
        await addBalance(partner_reff, va_code, serialnumber);

        // Update status transaksi di database
        if (va_code === "QRIS") {
            await updateInquiryStatusQris(partner_reff);
        } else {
            await updateInquiryStatus(partner_reff);
        }

        res.json({ message: "Callback diterima dan saldo ditambahkan" });

    } catch (err) {
        console.error(`❌ Gagal memproses callback: ${err.message}`);
        res.status(500).json({
            error: "Gagal memproses callback",
            detail: err.message
        });
    }
});

// ✅ Ambil status inquiry_va dari Firebase
async function getCurrentStatusVa(partnerReff) {
    try {
        const snap = await get(ref(databaseFire, `inquiry_va/${partnerReff}/status`));
        return snap.exists() ? snap.val() : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_va: ${error.message}`);
        throw error;
    }
}

// ✅ Update status inquiry_va di Firebase
async function updateInquiryStatus(partnerReff) {
    try {
        await update(ref(databaseFire, `inquiry_va/${partnerReff}`), { status: "SUKSES" });
        console.log(`✅ Status inquiry_va untuk ${partnerReff} berhasil diubah menjadi SUKSES`);
    } catch (error) {
        console.error(`❌ Gagal update status inquiry_va: ${error.message}`);
        throw error;
    }
}

// ✅ Ambil status inquiry_qris dari Firebase
async function getCurrentStatusQris(partnerReff) {
    try {
        const snap = await get(ref(databaseFire, `inquiry_qris/${partnerReff}/status`));
        return snap.exists() ? snap.val() : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_qris: ${error.message}`);
        throw error;
    }
}

// ✅ Update status inquiry_qris di Firebase
async function updateInquiryStatusQris(partnerReff) {
    try {
        await update(ref(databaseFire, `inquiry_qris/${partnerReff}`), { status: "SUKSES" });
        console.log(`✅ Status inquiry_qris untuk ${partnerReff} berhasil diubah menjadi SUKSES`);
    } catch (error) {
        console.error(`❌ Gagal update status inquiry_qris: ${error.message}`);
        throw error;
    }
}



app.get('/va-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // Ambil semua data PENDING
        const [pendingBefore] = await db.query(`
            SELECT id, bank_code, va_number, amount, status, customer_name, expired, created_at
            FROM inquiry_va
            WHERE status = 'PENDING'
        `);

        console.log("[VA-LIST] Data PENDING sebelum hapus:", pendingBefore);

        const now = Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > fifteenMinutes)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_va WHERE id IN (?)`, [idsToDelete]);
        }

        console.log(`[VA-LIST] Rows deleted = ${idsToDelete.length}`);

        // Ambil data terbaru
        const [results] = await db.query(`
            SELECT bank_code, va_number, amount, status, customer_name, expired, created_at
            FROM inquiry_va
            WHERE customer_name = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [username]);

        console.log("[VA-LIST] Data PENDING setelah hapus:", results);
        res.json(results);
    } catch (err) {
        console.error("DB error (va-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data VA" });
    }
});


app.get('/qr-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // Ambil semua data PENDING
        const [pendingBefore] = await db.query(`
            SELECT id, partner_reff, amount, status, customer_name, qris_url, expired, created_at
            FROM inquiry_qris
            WHERE status = 'PENDING'
        `);

        console.log("[QR-LIST] Data PENDING sebelum hapus:", pendingBefore);

        const now = Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > fifteenMinutes)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_qris WHERE id IN (?)`, [idsToDelete]);
        }

        console.log(`[QR-LIST] Rows deleted = ${idsToDelete.length}`);

        // Ambil data terbaru
        const [results] = await db.query(`
            SELECT partner_reff, amount, status, customer_name, qris_url, expired, created_at
            FROM inquiry_qris
            WHERE customer_name = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [username]);

        console.log("[QR-LIST] Data PENDING setelah hapus:", results);
        res.json(results);
    } catch (err) {
        console.error("DB error (qr-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data QR" });
    }
});




const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});