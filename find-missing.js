const axios = require('axios');

async function main() {
  const key = 'sk_cb4db678eb835667cb0c9d7204da5433204639fd6301bf46';
  try {
    const res = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': key }
    });
    console.log('Total voices in ElevenLabs:', res.data.voices.length);
    res.data.voices.slice(0, 10).forEach(v => {
        console.log(`- ${v.name} (${v.voice_id})`);
    });
    // Print some voices that are likely "missing"
    const dbVoiceIds = [
        'pNInz6obpgDQGcFmaJgB', 'Xb7hH8MSUJpSbSDYk0k2', 'XtQBugM2Fo3MVfTjamTz',
        'hpp4J3VqNfWAUOO0d1Us', 'pqHfZKP75CvOlQylNhV4', 'nPczCjzI2devNBz1zQrb',
        'N2lVS1w4EtoT3dr4eOWO', 'gsPeK1qQrfiqjkbnquQ7', 'M5mO7w4UKHD72o28ofQY',
        'KIaGEdP18b1n3J4J16D9', 'IKne3meq5aSn9XLyUdCD', 'iP95p4xoKVk53GoZ742B',
        'onwK4e9ZLuTAKqWW03F9', 'cjVigY5qzO86Huf0OWal', 'J6ozLk7jRgXAL6M3Sczp',
        'dWuRxmMbMNqQv2k7lBO2', 'JBFqnCBsd6RMkjVDRZzb', 'leK1TEBpggWE8znofhWY',
        'SOYHLrjzK2X1ezoPC6cr', 'cgSgspJ2msm6clMCkdW9', 'Nmq9rzTULj5tCftrsoGv',
        'FGY2WhTYpPnrIDTdsKH5', 'BrdXeso1UtycxR7Yy07k', 'TX3LPaxmHKxFdv7VOQHJ',
        'pFZP5JQG7iQjIQuC4Bku', 'Gn8G7b5xJW19WnY3tKw4', 'XrExE9yKIg1WjnnlVkGX',
        'SAz9YHcvj6GT2YYXdXww', 'CwhRBWXzGAHq8TQ4Fs17', 'EXAVITQu4vr4xnSDxMaL',
        'bIHbv24MWmeRgasZH58o'
    ];
    
    const missing = res.data.voices.filter(v => !dbVoiceIds.includes(v.voice_id));
    console.log('Missing voices count:', missing.length);
    missing.forEach(m => {
        console.log(`MISSING: ${m.name} (${m.voice_id})`);
    });
    
  } catch (e) {
    console.log('Error:', e.message);
  }
}

main();
