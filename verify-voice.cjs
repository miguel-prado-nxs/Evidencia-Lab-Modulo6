require('dotenv').config();
const axios = require('axios');
async function getVoices() {
  try {
    const res = await axios.get('https://api.elevenlabs.io/v1/voices', {headers:{'xi-api-key': process.env.ELEVENLABS_API_KEY}});
    const voices = res.data.voices;
    const v1 = voices.find(v => v.voice_id === 'M5mO7w4UKHD72o28ofQY');
    console.log('Voice M5mO7w4UKHD72o28ofQY found:', v1 ? v1.name : 'NO');
    const v2 = voices.find(v => v.voice_id === 'dWuRxmMbMNqQv2k7lBO2');
    console.log('Voice dWuRxmMbMNqQv2k7lBO2 found:', v2 ? v2.name : 'NO');
    if (!v1 || !v2) {
      console.log('Printing all voice IDs available:');
      console.log(voices.map(v => v.voice_id + ' : ' + v.name));
    }
  } catch(e) {
    console.error(e.message);
  }
}
getVoices();
