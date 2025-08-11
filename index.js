const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
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

// 🔐 Konfigurasi kredensial
const clientId = "685c857c-8edb-4a3c-a800-c27980d23216";
const clientSecret = "ZQ6G4Ry1yYRTLp3M1MEdKRHEa";
const username = "LI504NUNN";
const pin = "Ag7QKv4ZAnOeliF";
const serverKey = "Io5cT4CBgI5GZY3TEI2hgelk";

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
            signature
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
            signature
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

async function addBalance(amount, customer_name, va_code, serialnumber) {
    try {
        const originalAmount = parseInt(amount);

        // Hitung admin dan negativeAmount sesuai metode
        let admin;
        if (va_code === "QRIS") {
            admin = Math.round(originalAmount * 0.008); // 0.8% dibulatkan
        } else {
            admin = 2500;
        }

        const negativeAmount = originalAmount - admin;

        // Ambil nama terakhir dari customer_name
        const username = customer_name.trim().split(" ").pop();

        // Format nominal ke format Indonesia
        const formattedAmount = negativeAmount.toLocaleString('id-ID');
        const formattedAdmin = admin.toLocaleString('id-ID');

        // 📝 Catatan lengkap
        const catatan = `Transaksi berhasil || nominal Rp. ${formattedAmount} || biaya admin Rp. ${formattedAdmin}  || metode ${va_code} || Biller Reff ${serialnumber}`;

        const formdata = new FormData();
        formdata.append("amount", negativeAmount);
        formdata.append("username", username);
        formdata.append("note", catatan);

        const config = {
            method: 'post',
            url: 'https://linku.co.id/qris.php',
            headers: {
                ...formdata.getHeaders()
            },
            data: formdata
        };

        const response = await axios(config);
        console.log("✅ Saldo berhasil ditambahkan:", response.data);

        // Kirim notifikasi ke pengguna
        try {
            const requestBody = {
                type: "username",
                value: username,
                apikey: "FF6dKZ94S3SRB4jp3zc2UulCnH5bhLaMJ7sa3dz8wm1qj8ggqu",
                content: catatan,
            };

            const resMsg = await axios.post("https://api.jagel.id/v1/message/send", requestBody, {
                headers: { "Accept": "application/json" }
            });

            logToFile("📩 Pesan berhasil dikirim:", resMsg.data);
        } catch (notifError) {
            console.error("❌ Gagal mengirim notifikasi:", notifError.message);
            logToFile("❌ Gagal mengirim notifikasi: " + notifError.message);
        }

        return {
            status: true,
            message: "Saldo berhasil ditambahkan",
            data: { username, negativeAmount, catatan },
            balanceResult: response.data,
        };

    } catch (error) {
        console.error("❌ Gagal menambahkan saldo:", error.message);
        throw new Error("Gagal menambahkan saldo: " + error.message);
    }
}

// ✅ Route untuk menerima callback
app.post('/callback', async (req, res) => {
    try {
        const {
            partner_reff,
            amount,
            va_number,
            customer_name,
            va_code,
            serialnumber
        } = req.body;

        const logMsg = `✅ Callback diterima: ${JSON.stringify(req.body)}`;
        console.log(logMsg);
        logToFile(logMsg);

        let currentStatus;
        if (va_code === 'QRIS') {
            currentStatus = await getCurrentStatusQris(partner_reff);
        } else {
            currentStatus = await getCurrentStatusVa(partner_reff);
        }

        if (currentStatus === 'SUKSES') {
            console.log(`ℹ️ Transaksi ${partner_reff} sudah diproses sebelumnya.`);
            return res.json({ message: "Transaksi sudah SUKSES sebelumnya. Tidak diproses ulang." });
        }

        // Jalankan fungsi penambahan saldo
        await addBalance(amount, customer_name, va_code, serialnumber);

        // Update status setelah saldo ditambahkan
        if (va_code === 'QRIS') {
            await updateInquiryStatusQris(partner_reff);
        } else {
            await updateInquiryStatus(partner_reff);
        }

        res.json({ message: "Callback diterima dan saldo ditambahkan" });

    } catch (err) {
        const logMsg = `❌ Gagal memproses callback: ${err.message}`;
        console.error(logMsg);
        logToFile(logMsg);
        res.status(500).json({ error: "Gagal memproses callback", detail: err.message });
    }
});

// ✅ Fungsi ambil status dari inquiry_va
async function getCurrentStatusVa(partnerReff) {
    try {
        const [rows] = await db.execute(
            'SELECT status FROM inquiry_va WHERE partner_reff = ?',
            [partnerReff]
        );
        return rows.length > 0 ? rows[0].status : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_va: ${error.message}`);
        throw error;
    }
}

// ✅ Fungsi ambil status dari inquiry_qris
async function getCurrentStatusQris(partnerReff) {
    try {
        const [rows] = await db.execute(
            'SELECT status FROM inquiry_qris WHERE partner_reff = ?',
            [partnerReff]
        );
        return rows.length > 0 ? rows[0].status : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_qris: ${error.message}`);
        throw error;
    }
}

// ✅ Update status SUKSES untuk inquiry_va
async function updateInquiryStatus(partnerReff) {
    try {
        await db.execute(
            'UPDATE inquiry_va SET status = ? WHERE partner_reff = ?',
            ['SUKSES', partnerReff]
        );
        console.log(`✅ Status inquiry_va untuk ${partnerReff} berhasil diubah menjadi SUKSES`);
    } catch (error) {
        console.error(`❌ Gagal update status inquiry_va: ${error.message}`);
        throw error;
    }
}

// ✅ Update status SUKSES untuk inquiry_qris
async function updateInquiryStatusQris(partnerReff) {
    try {
        await db.execute(
            'UPDATE inquiry_qris SET status = ? WHERE partner_reff = ?',
            ['SUKSES', partnerReff]
        );
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