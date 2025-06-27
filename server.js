// require('dotenv').config();

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
  const isVerified = verifyHmac(req.body, hmacHeader, process.env.SHOPIFY_API_SECRET);

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
async function registerWebhook() {
  console.log('🔧 Store Domain:', process.env.SHOPIFY_STORE_DOMAIN);
  console.log('🔧 Access Token:', process.env.SHOPIFY_ACCESS_TOKEN);

  const endpoint = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks.json`;

  try {
    const response = await axios.post(
      endpoint,
      {
        webhook: {
          topic: 'inventory_levels/update',
          address: `${process.env.SHOPIFY_APP_SERVER}/webhook/inventory`,
          format: 'json'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Webhook registered:', response.data);
  } catch (error) {
    console.error('❌ Error registering webhook:', error.response?.data || error.message);
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 App running on port ${PORT}`);
  await registerWebhook();
});
