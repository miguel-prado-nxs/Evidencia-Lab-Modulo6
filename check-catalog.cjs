const axios = require('axios');
require('dotenv').config({ path: 'C:/Nexgen/easyorder-partners-api/.env' });

async function checkCatalog() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log("No API Key found");
    return;
  }

  try {
    const voicesRes = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
    
    const target1 = "M5mO7w4UKHD72o28ofQY";
    const target2 = "dWuRxmMbMNqQv2k7lBO2";
    
    const v1 = voicesRes.data.voices.find(v => v.voice_id === target1);
    const v2 = voicesRes.data.voices.find(v => v.voice_id === target2);
    
    console.log(`Voice ${target1}: ${v1 ? v1.name : "NOT FOUND"}`);
    console.log(`Voice ${target2}: ${v2 ? v2.name : "NOT FOUND"}`);

  } catch (error) {
    console.error("Error fetching catalog:", error.message);
  }
}

checkCatalog();
