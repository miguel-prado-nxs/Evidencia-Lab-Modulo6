const { PrismaClient } = require('@prisma/client');
const campaignsService = require('../src/services/campaignsService');
const couponService = require('../src/services/couponService');

const prisma = new PrismaClient();

describe('Campaigns Service Tests', () => {
  let testCampaign;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (testCampaign) {
      await prisma.campaignContact.deleteMany({
        where: { campaignId: testCampaign.id },
      });
      await prisma.campaignCoupon.deleteMany({
        where: { campaignId: testCampaign.id },
      });
      await prisma.campaign.delete({
        where: { id: testCampaign.id },
      });
    }
    await prisma.$disconnect();
  });

  describe('createCampaign', () => {
    test('should create a campaign with valid data', async () => {
      const campaignData = {
        name: 'Test Campaign',
        description: 'Test campaign description',
        centerLat: 19.4326,
        centerLng: -99.1332,
        radiusMeters: 5000,
        createdBy: 'test-user-id',
      };

      testCampaign = await campaignsService.createCampaign(campaignData);

      expect(testCampaign).toBeDefined();
      expect(testCampaign.name).toBe(campaignData.name);
      expect(testCampaign.status).toBe('DRAFT');
      expect(testCampaign.centerLat).toBe(campaignData.centerLat);
      expect(testCampaign.radiusMeters).toBe(campaignData.radiusMeters);
    });

    test('should fail without campaign name', async () => {
      await expect(
        campaignsService.createCampaign({
          description: 'No name campaign',
        })
      ).rejects.toThrow('Campaign name is required');
    });

    test('should fail with invalid radiusMeters', async () => {
      await expect(
        campaignsService.createCampaign({
          name: 'Invalid Radius Campaign',
          centerLat: 19.4326,
          centerLng: -99.1332,
          radiusMeters: -100,
        })
      ).rejects.toThrow('radiusMeters must be a positive number');
    });

    test('should fail when coords provided without radius', async () => {
      await expect(
        campaignsService.createCampaign({
          name: 'No Radius Campaign',
          centerLat: 19.4326,
          centerLng: -99.1332,
        })
      ).rejects.toThrow('radiusMeters is required when centerLat and centerLng are provided');
    });
  });

  describe('updateCampaign', () => {
    test('should update campaign status', async () => {
      const updated = await campaignsService.updateCampaign(testCampaign.id, {
        status: 'ACTIVE',
      });

      expect(updated.status).toBe('ACTIVE');
    });

    test('should fail to update non-existent campaign', async () => {
      await expect(
        campaignsService.updateCampaign('non-existent-id', {
          name: 'Updated Name',
        })
      ).rejects.toThrow('Campaign not found');
    });
  });

  describe('assignContactsToCampaign', () => {
    test('should assign contacts to campaign', async () => {
      const establishmentIds = ['est-1', 'est-2', 'est-3'];
      const contacts = await campaignsService.assignContactsToCampaign(
        testCampaign.id,
        establishmentIds
      );

      expect(contacts).toHaveLength(3);
      expect(contacts[0].status).toBe('PENDING');
    });

    test('should fail with empty establishmentIds array', async () => {
      await expect(
        campaignsService.assignContactsToCampaign(testCampaign.id, [])
      ).rejects.toThrow('establishmentIds must be a non-empty array');
    });
  });

  describe('getCampaignStats', () => {
    test('should return campaign statistics', async () => {
      const stats = await campaignsService.getCampaignStats(testCampaign.id);

      expect(stats).toBeDefined();
      expect(stats.campaign.id).toBe(testCampaign.id);
      expect(stats.metrics).toBeDefined();
      expect(stats.metrics.totalContacts).toBeGreaterThanOrEqual(0);
      expect(stats.statusBreakdown).toBeDefined();
    });
  });
});

describe('Coupon Service Tests', () => {
  let testCampaign;
  let testCoupon;

  beforeAll(async () => {
    await prisma.$connect();
    testCampaign = await prisma.campaign.create({
      data: {
        name: 'Coupon Test Campaign',
        description: 'Campaign for coupon testing',
        status: 'DRAFT',
        createdBy: 'test-user-id',
      },
    });
  });

  afterAll(async () => {
    if (testCoupon) {
      await prisma.campaignCoupon.delete({
        where: { id: testCoupon.id },
      });
    }
    if (testCampaign) {
      await prisma.campaign.delete({
        where: { id: testCampaign.id },
      });
    }
    await prisma.$disconnect();
  });

  describe('createCoupon', () => {
    test('should create a coupon with valid data', async () => {
      testCoupon = await couponService.createCoupon({
        campaignId: testCampaign.id,
        code: 'TEST-COUPON-001',
        offer: '+2 meses gratis',
      });

      expect(testCoupon).toBeDefined();
      expect(testCoupon.code).toBe('TEST-COUPON-001');
      expect(testCoupon.offer).toBe('+2 meses gratis');
      expect(testCoupon.status).toBe('GENERATED');
    });

    test('should fail without campaignId', async () => {
      await expect(
        couponService.createCoupon({
          code: 'NO-CAMPAIGN',
          offer: 'Test offer',
        })
      ).rejects.toThrow('campaignId and offer are required');
    });

    test('should fail with duplicate code', async () => {
      await expect(
        couponService.createCoupon({
          campaignId: testCampaign.id,
          code: 'TEST-COUPON-001',
          offer: 'Duplicate offer',
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('generateBulkCoupons', () => {
    test('should generate multiple coupons', async () => {
      const coupons = await couponService.generateBulkCoupons(
        testCampaign.id,
        5,
        '+3 meses gratis'
      );

      expect(coupons).toHaveLength(5);
      expect(coupons[0].offer).toBe('+3 meses gratis');

      await prisma.campaignCoupon.deleteMany({
        where: {
          id: { in: coupons.map((c) => c.id) },
        },
      });
    });

    test('should fail with count > 1000', async () => {
      await expect(
        couponService.generateBulkCoupons(testCampaign.id, 1001, 'Too many')
      ).rejects.toThrow('count must be between 1 and 1000');
    });
  });

  describe('trackCouponVisit', () => {
    test('should track coupon visit', async () => {
      const updated = await couponService.trackCouponVisit('TEST-COUPON-001');

      expect(updated.visitCount).toBeGreaterThan(0);
      expect(updated.status).toBe('VISITED');
      expect(updated.visitedAt).toBeDefined();
    });
  });

  describe('markCouponAsConverted', () => {
    test('should mark coupon as converted', async () => {
      const converted = await couponService.markCouponAsConverted('TEST-COUPON-001', {
        dealId: 'test-deal-123',
        amount: 5000,
      });

      expect(converted.status).toBe('CONVERTED');
      expect(converted.convertedAt).toBeDefined();
      expect(converted.conversionData).toBeDefined();
    });
  });
});
