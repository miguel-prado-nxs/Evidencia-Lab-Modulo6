const axios = require("axios");

async function testWebhook() {
  const url = "http://localhost:3004/api/v1/webhooks/coupons/generate-for-call";
  const payload = {
    phone: "523891087325",
    prospectName: "Test User",
    businessName: "Test Business",
    scenario: "price_objection",
    agentId: "test-agent",
    callId: "test-call"
  };

  try {
    console.log(`Testing webhook at ${url}...`);
    const response = await axios.post(url, payload);
    console.log("Response status:", response.status);
    console.log("Response data:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("Error calling webhook:", error.response?.data || error.message);
  }
}

testWebhook();
