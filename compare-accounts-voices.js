const axios = require('axios');

async function main() {
  const keyA = 'sk_cb4db678eb835667cb0c9d7204da5433204639fd6301bf46';
  const keyB = 'sk_316aec8539012fd4242b6c8c67e39933af7ff29711851407';
  
  try {
    const resA = await axios.get('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': keyA } });
    const resB = await axios.get('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': keyB } });
    
    const idsA = resA.data.voices.map(v => v.voice_id);
    const idsB = resB.data.voices.map(v => v.voice_id);
    
    const onlyB = resB.data.voices.filter(v => !idsA.includes(v.voice_id));
    
    console.log('Voices in A:', idsA.length);
    console.log('Voices in B:', idsB.length);
    console.log('Voices only in B:', onlyB.length);
    
    onlyB.forEach(v => {
        console.log(`ONLY B: ${v.name} (${v.voice_id})`);
    });

  } catch (e) {
    console.log('Error:', e.message);
  }
}

main();
