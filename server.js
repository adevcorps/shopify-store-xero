require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios');

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_APP_SERVER = process.env.SHOPIFY_APP_SERVER;

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const XERO_REDIRECT_URI = `${SHOPIFY_APP_SERVER}/xero/callback`;

const app = express();
const PORT = process.env.PORT || 3000;

let inventoryLogs = [];

app.use('/webhook/inventory', bodyParser.raw({ type: 'application/json' }));

// === Route: Homepage with "Connect to Xero" and inventory logs ===
app.get('/', (req, res) => {
  let html = `
    <h1>🔗 Connect to Xero</h1>
    <a href="/xero/redirect"><button>Connect to Xero</button></a>
    <hr/>
    <h1>📦 Shopify Inventory Updates</h1>
  `;

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

// === Function: Verify Shopify HMAC ===
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

// === Route: Shopify Webhook Receiver ===
app.post('/webhook/inventory', (req, res) => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const isVerified = verifyHmac(req.body, hmacHeader, SHOPIFY_API_SECRET);

  if (!isVerified) {
    return res.status(401).send('Unauthorized');
  }

  const payload = JSON.parse(req.body.toString('utf8'));

  inventoryLogs.unshift({
    inventory_item_id: payload.inventory_item_id,
    available: payload.available,
    updated_at: new Date().toISOString()
  });

  if (inventoryLogs.length > 20) inventoryLogs.pop();

  res.status(200).send('Received');
});

// === Function: Register Webhook with Shopify ===
async function ensureWebhookRegistered() {
  const storeDomain = SHOPIFY_STORE_DOMAIN;
  const accessToken = SHOPIFY_ACCESS_TOKEN;
  const topic = "inventory_levels/update";
  const address = `${SHOPIFY_APP_SERVER}/webhook/inventory`;

  console.log(accessToken);
  console.log(topic);
  console.log(address);
  
  try {
    const existing = await axios.get(`https://${storeDomain}/admin/api/2024-04/webhooks.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    });

    const alreadyExists = existing.data.webhooks.some(
      (w) => w.address === address && w.topic === topic
    );

    if (alreadyExists) {
      console.log("✅ Webhook already registered.");
      return;
    }

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
}

// === Route: Xero Redirect to OAuth ===
app.get('/xero/redirect', (req, res) => {
  const state = crypto.randomBytes(8).toString('hex');
  const authUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${XERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(XERO_REDIRECT_URI)}&scope=openid profile email accounting.settings accounting.contacts offline_access&state=${state}`;
  res.redirect(authUrl);
});

// === Route: Xero Callback ===
app.get('/xero/callback', async (req, res) => {
  const { code } = req.query;

  try {
    const tokenRes = await axios.post('https://identity.xero.com/connect/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: XERO_REDIRECT_URI,
        client_id: XERO_CLIENT_ID,
        client_secret: XERO_CLIENT_SECRET
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const tokens = tokenRes.data;

    const connectionRes = await axios.get('https://api.xero.com/connections', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      }
    });

    const tenantId = connectionRes.data?.[0]?.tenantId;

    res.send(`
      <h1>✅ Connected to Xero</h1>
      <p><strong>Access Token:</strong> ${tokens.access_token}</p>
      <p><strong>Refresh Token:</strong> ${tokens.refresh_token}</p>
      <p><strong>Tenant ID:</strong> ${tenantId}</p>
      <p style="color:red;"><strong>⚠️ Copy and save this info. It won’t be saved by the system.</strong></p>
      <a href="/">⬅️ Back to Home</a>
    `);
  } catch (err) {
    console.error("❌ Xero OAuth Error:", err.response?.data || err.message);
    res.send('<p>Something went wrong connecting to Xero.</p><a href="/">⬅️ Back</a>');
  }
});

// === Start Server ===
app.listen(PORT, async () => {
  console.log(`🚀 App running on port ${PORT}`);
  await ensureWebhookRegistered();
});