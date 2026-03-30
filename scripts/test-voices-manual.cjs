const axios = require('axios');
require('dotenv').config({ path: 'C:/Nexgen/easyorder-partners-api/.env' });

async function testVoiceOverride(voiceId, label) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = "agent_8001kjdzt8xsf428pdwr6dasb3x6"; // SDR Agent
  const phoneNumberId = "phnum_2701kjg06e71fqv9bmt1fq3sddr6"; // SDR Phone
  const toNumber = "+528112443469"; // My test number

  console.log(`\n--- Testing Voice: ${label} (${voiceId}) ---`);

  const payload = {
    agent_id: agentId,
    agent_phone_number_id: phoneNumberId,
    to_number: toNumber,
    conversation_initiation_client_data: {
      conversation_config_override: {
        tts: {
          voice_id: voiceId
        }
      }
    }
  };

  try {
    const response = await axios.post(
      'https://api.elevenlabs.io/v1/convai/twilio/outbound-call',
      payload,
      {
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        validateStatus: () => true
      }
    );

    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

async function runTests() {
  await testVoiceOverride("M5mO7w4UKHD72o28ofQY", "Carlos Guerrero");
  await testVoiceOverride("dWuRxmMbMNqQv2k7lBO2", "Esteban");
  process.exit(0);
}

runTests();
