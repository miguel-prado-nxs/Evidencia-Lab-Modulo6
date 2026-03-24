
const Redis = require('ioredis');
const redis = new Redis('redis://default:PJwVmNDVUeyZjeiBGRjPJTapYDOCQVcs@ballast.proxy.rlwy.net:33971');

async function inspectQueues() {
  try {
    const keys = await redis.keys('bull:sdr-calls:*');
    console.log('Total SDR queue keys:', keys.length);

    // List waiting jobs
    const waitingJobs = await redis.lrange('bull:sdr-calls:wait', 0, 10);
    console.log('\nWaiting Job IDs:', waitingJobs);

    for (const jobId of waitingJobs) {
      const jobData = await redis.hget(`bull:sdr-calls:${jobId}`, 'data');
      if (jobData) {
        const parsed = JSON.parse(jobData);
        console.log(`\n--- Job ${jobId} ---`);
        console.log('contactId:', parsed.contactId);
        console.log('agentName:', parsed.agentName);
      }
    }

    // List active jobs
    const activeJobs = await redis.lrange('bull:sdr-calls:active', 0, 5);
    console.log('\nActive Job IDs:', activeJobs);
    
    // Check if there are many failed jobs that might be retrying
    const failedCount = await redis.zcard('bull:sdr-calls:failed');
    console.log('\nFailed Jobs Count:', failedCount);

  } catch (error) {
    console.error(error);
  } finally {
    await redis.disconnect();
  }
}

inspectQueues();
