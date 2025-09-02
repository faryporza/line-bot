const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const cron = require("node-cron");
const fs = require('fs');

// =========================
// 1. ตั้งค่า LINE API
// =========================
const config = {
  channelAccessToken: "XHmSW9xLrqdozbQ9wkjo/9xzIET7dmVhKt5GUBLUMWySy/0+FIZ57yBuKgPGKEDha6VvAK0aKDN76jw7tmZE2LtIs8EnL/DGaVmzqopXgjbcv7+OgpToxdRJocsemjDJqiEe5weZWzeCLIsQp16ovwdB04t89/1O/w1cDnyilFU=",
  channelSecret: "e283f6e8b393cf6204b64148ce38ccd6"
};

const client = new line.Client(config);
const app = express();

// =========================
// 2. ฟังก์ชันเช็คคนที่ยังไม่จ่าย ผ่าน PHP API
// =========================
async function notifyUnpaid(groupId) {
  try {
    const res = await axios.get("https://faryopor.online/unpaid.php");
    const data = res.data;

    if (!data.success) {
      console.error("❌ API Error:", data.error);
      return;
    }

    if (data.count === 0) {
      console.log("✅ ทุกคนจ่ายครบแล้ววันนี้ ไม่ส่งแจ้งเตือน");
      return;
    }

    // รวมชื่อทั้งหมด
    const unpaidList = data.data.map(u => `- ${u.name} (${u.profilename})`).join("\n");

    const message = {
      type: "text",
      text: `📢 ประกาศจากหนูรั:\n${unpaidList}`
    };

    await client.pushMessage(groupId, message);
    console.log("📨 ส่งแจ้งเตือนเรียบร้อย");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}


app.use(express.json()); // 👈 ต้องมี
app.use(express.static('public')); // เสิร์ฟไฟล์ static จากโฟลเดอร์ public

// =========================
// 4. Webhook (ปิด signature validation ชั่วคราว)
// =========================
app.post("/webhook", express.json(), (req, res) => {
  console.log("📩 Raw Webhook event:", JSON.stringify(req.body, null, 2));
  
  const events = req.body.events;
  
  if (!events || events.length === 0) {
    console.log("📭 No events in webhook payload");
    return res.sendStatus(200);
  }

  events.forEach(event => {
    console.log("🔍 Event type:", event.type);
    console.log("🔍 Source type:", event.source?.type);
    
    if (event.source && event.source.type === "group") {
      const groupId = event.source.groupId;
      console.log("📌 NEW Group ID found:", groupId);
      console.log("🎯 Updating config.json with new Group ID...");
      
      // บันทึก Group ID ใหม่
      const configData = { GROUP_ID: groupId };
      fs.writeFileSync('./config.json', JSON.stringify(configData, null, 2));
      console.log("💾 Group ID saved to config.json");
      global.CURRENT_GROUP_ID = groupId;
    }
    
    if (event.source && event.source.type === "user") {
      console.log("👤 User ID:", event.source.userId);
    }
  });

  res.sendStatus(200);
});

app.post("/test-webhook", (req, res) => {
  console.log("✅ Test event:", req.body);
  res.sendStatus(200);
});

app.get("/send-test", async (req, res) => {
  try {
    const currentGroupId = global.CURRENT_GROUP_ID || GROUP_ID;
    await notifyUnpaid(currentGroupId);   // ✅ เรียกฟังก์ชันเช็ค DB จริง
    res.send("✅ ตรวจสอบแล้ว และส่งแจ้งเตือนถ้ามีผู้ค้างชำระ");
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).send(err.message);
  }
});

app.post("/send-message", async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).send("❌ กรุณาใส่ข้อความ");
    }

    const currentGroupId = global.CURRENT_GROUP_ID || GROUP_ID;
    
    await client.pushMessage(currentGroupId, {
      type: "text",
      text: message
    });
    
    console.log("📨 ส่งข้อความกำหนดเอง:", message);
    res.send("✅ ส่งข้อความเรียบร้อยแล้ว");
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).send("❌ เกิดข้อผิดพลาด: " + err.message);
  }
});

// =========================
// 5. Cron Job รันทุกวัน 9 โมง
// =========================
// 👉 ลองโหลด Group ID จากไฟล์ก่อน ถ้าไม่มีใช้ default
let GROUP_ID = "C644c0ea820afd742e0145fe80b2c7766";

try {
  if (fs.existsSync('./config.json')) {
    const configFile = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    GROUP_ID = configFile.GROUP_ID || GROUP_ID;
    console.log("📂 Loaded Group ID from config:", GROUP_ID);
  } else {
    console.log("📂 No config.json found, using default GROUP_ID:", GROUP_ID);
  }
} catch (err) {
  console.log("⚠️ Could not load config.json, using default GROUP_ID:", GROUP_ID);
  console.log("Error:", err.message);
}

cron.schedule("0 9 * * *", () => {
  console.log("⏰ ตรวจสอบการชำระเงินประจำวัน...");
  const currentGroupId = global.CURRENT_GROUP_ID || GROUP_ID;
  console.log("🎯 Using Group ID:", currentGroupId);
  
  if (currentGroupId !== "C644c0ea820afd742e0145fe80b2c7766") {
    notifyUnpaid(currentGroupId);
  } else {
    console.log("⚠️ ยังไม่ได้ตั้งค่า GROUP_ID");
  }
});

// =========================
// 6. Run server
// =========================
app.listen(3001, () => {
  console.log("🚀 Server running on port 3001");
  console.log("📋 Current GROUP_ID:", GROUP_ID);
  console.log("📝 Web interface: http://localhost:3001");
  console.log("📝 Test API: http://localhost:3001/send-test");
});
