const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3004';

async function testCouponBreakdown() {
  try {
    console.log('🧪 Testing Coupon Breakdown Endpoint\n');
    console.log(`🔗 API Base URL: ${API_BASE_URL}\n`);

    // First, get list of campaigns to find one with coupons
    console.log('📋 Fetching campaigns...');
    const campaignsResponse = await axios.get(`${API_BASE_URL}/api/v1/campaigns`, {
      params: { limit: 10 },
      timeout: 5000
    });

    const campaigns = campaignsResponse.data.data;
    
    if (!campaigns || campaigns.length === 0) {
      console.log('❌ No campaigns found. Please create a campaign first.');
      return;
    }

    console.log(`✅ Found ${campaigns.length} campaigns\n`);

    // Find a campaign with coupons sent
    const campaignWithCoupons = campaigns.find(c => c.couponsSent > 0);
    
    if (!campaignWithCoupons) {
      console.log('⚠️  No campaigns with coupons sent found.');
      console.log('Testing with first campaign anyway...\n');
      
      const testCampaign = campaigns[0];
      console.log(`📊 Testing campaign: ${testCampaign.name} (${testCampaign.id})`);
      console.log(`   Coupons sent: ${testCampaign.couponsSent}`);
      
      const breakdownResponse = await axios.get(
        `${API_BASE_URL}/api/v1/campaigns/${testCampaign.id}/coupon-breakdown`
      );

      console.log('\n✅ Endpoint response:');
      console.log(JSON.stringify(breakdownResponse.data, null, 2));
      return;
    }

    // Test with campaign that has coupons
    console.log(`📊 Testing campaign: ${campaignWithCoupons.name}`);
    console.log(`   ID: ${campaignWithCoupons.id}`);
    console.log(`   Coupons sent: ${campaignWithCoupons.couponsSent}`);
    console.log(`   Coupons visited: ${campaignWithCoupons.couponsVisited}`);
    console.log(`   Coupons converted: ${campaignWithCoupons.couponsConverted}\n`);

    // Call the breakdown endpoint
    console.log('🔍 Fetching coupon breakdown...');
    const breakdownResponse = await axios.get(
      `${API_BASE_URL}/api/v1/campaigns/${campaignWithCoupons.id}/coupon-breakdown`
    );

    const breakdown = breakdownResponse.data.data;

    console.log('\n✅ Coupon Breakdown Results:');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log(`Campaign: ${breakdown.campaignName}`);
    console.log(`Campaign ID: ${breakdown.campaignId}`);
    console.log(`Generated at: ${breakdown.generatedAt}\n`);

    if (breakdown.breakdown.length === 0) {
      console.log('⚠️  No coupon data found for this campaign.');
    } else {
      console.log('📈 Breakdown by Coupon Type:\n');
      
      breakdown.breakdown.forEach((item, index) => {
        console.log(`${index + 1}. ${item.name} (${item.couponType})`);
        if (item.description) {
          console.log(`   Description: ${item.description}`);
        }
        if (item.offer) {
          console.log(`   Offer: ${item.offer}`);
        }
        console.log(`   Metrics:`);
        console.log(`     • Sent: ${item.metrics.sent}`);
        console.log(`     • Visited: ${item.metrics.visited} (${item.metrics.visitRate}%)`);
        console.log(`     • Converted: ${item.metrics.converted} (${item.metrics.conversionRate}%)`);
        console.log(`     • Total Visits: ${item.metrics.totalVisits}`);
        console.log('');
      });

      console.log('📊 Totals:');
      console.log(`   • Total Sent: ${breakdown.totals.sent}`);
      console.log(`   • Total Visited: ${breakdown.totals.visited} (${breakdown.totals.visitRate}%)`);
      console.log(`   • Total Converted: ${breakdown.totals.converted} (${breakdown.totals.conversionRate}%)`);
      console.log(`   • Total Visits: ${breakdown.totals.totalVisits}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:');
    if (error.code === 'ECONNREFUSED') {
      console.error(`   ⚠️  Cannot connect to API server at ${API_BASE_URL}`);
      console.error(`   Make sure the server is running with: npm start`);
      console.error(`   Expected port: ${API_BASE_URL.split(':').pop()}`);
    } else if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`   ${error.message}`);
      if (error.code) {
        console.error(`   Error code: ${error.code}`);
      }
    }
    process.exit(1);
  }
}

testCouponBreakdown();
