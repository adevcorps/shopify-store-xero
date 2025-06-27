// require('dotenv').config();
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_APP_SERVER = process.env.SHOPIFY_APP_SERVER;

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

let inventoryLogs = [];
app.use('/webhook/inventory', bodyParser.raw({ type: 'application/json' }));

app.get('/', (req, res) => {
  let html = `<h1>📦 Shopify Inventory Updates</h1>`;
  if (inventoryLogs.length === 0) {
    html += `<p>No updates yet.</p>`;
  } else {
    html += `<ul>`;
    inventoryLogs.forEach((log, index) => {
      html += `<li><strong>${index + 1}:</strong> Inventory Item ID: ${log.inventory_item_id}, Available: ${log.available}, Updated At: ${log.updated_at}</li>`;
    });
    html += `</ul>`;
  }
  res.send(html);
});


function verifyHmac(rawBody, hmacHeader, secret) {
  const generatedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(generatedHmac),
    Buffer.from(hmacHeader)
  );
}

// 📬 Webhook receiver
app.post('/webhook/inventory', (req, res) => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const isVerified = verifyHmac(req.body, hmacHeader, SHOPIFY_API_SECRET);

  if (!isVerified) {
    return res.status(401).send('Unauthorized');
  }

  const payload = JSON.parse(req.body.toString('utf8'));

  // 🧠 Save to memory log (limit to last 20 items)
  inventoryLogs.unshift({
    inventory_item_id: payload.inventory_item_id,
    available: payload.available,
    updated_at: new Date().toISOString()
  });

  if (inventoryLogs.length > 20) inventoryLogs.pop(); // Keep log small

  res.status(200).send('Received');
});

// 📡 Register webhook with Shopify

async function ensureWebhookRegistered() {
  const storeDomain = SHOPIFY_STORE_DOMAIN;
  const accessToken = SHOPIFY_ACCESS_TOKEN;
  const topic = "inventory_levels/update";
  const address = `${SHOPIFY_APP_SERVER}/webhook/inventory`;

  try {
    // 1. Get existing webhooks
    const existing = await axios.get(`https://${storeDomain}/admin/api/2024-04/webhooks.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    });

    // 2. Check if our webhook already exists
    const alreadyExists = existing.data.webhooks.some(
      (w) => w.address === address && w.topic === topic
    );

    if (alreadyExists) {
      console.log("✅ Webhook already registered.");
      return;
    }

    // 3. Register only if not found
    const res = await axios.post(`https://${storeDomain}/admin/api/2024-04/webhooks.json`, {
      webhook: {
        topic,
        address,
        format: "json"
      }
    }, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    });

    console.log("✅ Webhook registered:", res.data);
  } catch (error) {
    console.error("❌ Error ensuring webhook:", error.response?.data || error.message);
  }
};

app.listen(PORT, async () => {
  console.log(`🚀 App running on port ${PORT}`);
  await ensureWebhookRegistered();
});
