const Queue = require('bull');
const dotenv = require('dotenv');
dotenv.config();

const sdrCallQueue = new Queue('sdr-calls', {
  redis: {
    port: 6379,
    host: '127.0.0.1',
  }
});

async function checkQueue() {
  try {
    const jobs = await sdrCallQueue.getJobs(['completed', 'failed', 'waiting', 'active']);
    console.log(`Found ${jobs.length} jobs in sdr-calls queue`);
    
    // Check the last 5 jobs
    const lastJobs = jobs.slice(-5);
    lastJobs.forEach((job, i) => {
      console.log(`Job ${job.id}: voiceId=${job.data.voiceId}, contactId=${job.data.contactId}`);
    });

  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}

checkQueue();
