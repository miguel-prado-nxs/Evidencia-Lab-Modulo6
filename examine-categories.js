const axios = require('axios');

async function main() {
  const key = 'sk_cb4db678eb835667cb0c9d7204da5433204639fd6301bf46';
  try {
    const res = await axios.get('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    const voices = res.data.voices;
    
    // Group by category
    const categories = {};
    voices.forEach(v => {
        categories[v.category] = (categories[v.category] || 0) + 1;
    });
    console.log('Categories:', categories);
    
    // Check for specific labels like "cloned"
    voices.forEach(v => {
        if (v.category === 'cloned') {
            console.log(`CLONED: ${v.name} (${v.voice_id})`);
        }
    });

  } catch (e) {
    console.log('Error:', e.message);
  }
}

main();
