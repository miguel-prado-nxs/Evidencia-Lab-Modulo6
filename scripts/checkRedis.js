const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6381';
const r = new Redis(redisUrl);

r.ping()
  .then(p => {
    console.log('Redis:', p);
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
