# Coupon Breakdown Analytics API

## Overview

The Coupon Breakdown Analytics endpoint provides detailed metrics on coupon distribution by type for a specific campaign. This is part of Phase 3 of the hybrid multi-coupon implementation.

## Endpoint

```
GET /api/v1/campaigns/:id/coupon-breakdown
```

## Authentication

Requires JWT authentication (currently commented out in routes).

## Parameters

| Parameter | Type   | Location | Required | Description        |
|-----------|--------|----------|----------|--------------------|
| `id`      | string | path     | Yes      | Campaign UUID      |

## Response Format

```json
{
  "success": true,
  "data": {
    "campaignId": "campaign-uuid",
    "campaignName": "Adquisición Q1 2026",
    "breakdown": [
      {
        "couponType": "TRIAL14",
        "name": "14 días gratis",
        "description": "Prueba gratuita de 14 días",
        "offer": "14 días trial",
        "metrics": {
          "sent": 45,
          "visited": 12,
          "converted": 5,
          "visitRate": "26.67",
          "conversionRate": "11.11",
          "totalVisits": 18
        }
      },
      {
        "couponType": "50OFF",
        "name": "50% de descuento",
        "description": "50% de descuento en primer mes",
        "offer": "50%",
        "metrics": {
          "sent": 23,
          "visited": 8,
          "converted": 3,
          "visitRate": "34.78",
          "conversionRate": "13.04",
          "totalVisits": 11
        }
      }
    ],
    "totals": {
      "sent": 68,
      "visited": 20,
      "converted": 8,
      "visitRate": "29.41",
      "conversionRate": "11.76",
      "totalVisits": 29
    },
    "generatedAt": "2026-03-30T18:16:00.000Z"
  }
}
```

## Response Fields

### Breakdown Object

| Field         | Type   | Description                                    |
|---------------|--------|------------------------------------------------|
| `couponType`  | string | Coupon type identifier (e.g., "TRIAL14")      |
| `name`        | string | Human-readable coupon name                     |
| `description` | string | Detailed description from template             |
| `offer`       | string | Formatted offer string (e.g., "50% 3 meses")  |

### Metrics Object

| Field            | Type   | Description                                      |
|------------------|--------|--------------------------------------------------|
| `sent`           | number | Total coupons of this type sent                  |
| `visited`        | number | Coupons visited (status = VISITED)               |
| `converted`      | number | Coupons converted (status = CONVERTED)           |
| `visitRate`      | string | Percentage of sent coupons that were visited     |
| `conversionRate` | string | Percentage of sent coupons that were converted   |
| `totalVisits`    | number | Sum of all visit counts (includes repeat visits) |

### Totals Object

Aggregated metrics across all coupon types with the same structure as individual metrics.

## Use Cases

### 1. Campaign Performance Analysis

Compare effectiveness of different coupon types within the same campaign:

```javascript
const response = await fetch(`/api/v1/campaigns/${campaignId}/coupon-breakdown`);
const { breakdown } = response.data;

// Find best performing coupon by conversion rate
const bestCoupon = breakdown.reduce((best, current) => 
  parseFloat(current.metrics.conversionRate) > parseFloat(best.metrics.conversionRate) 
    ? current 
    : best
);

console.log(`Best performing: ${bestCoupon.name} with ${bestCoupon.metrics.conversionRate}% conversion`);
```

### 2. Dashboard Visualization

Display a pie chart or bar graph showing coupon distribution:

```javascript
const chartData = breakdown.map(item => ({
  label: item.name,
  value: item.metrics.sent,
  conversionRate: parseFloat(item.metrics.conversionRate)
}));
```

### 3. A/B Testing Analysis

Determine which coupon types resonate better with prospects:

```javascript
breakdown.forEach(item => {
  console.log(`${item.couponType}:`);
  console.log(`  Visit Rate: ${item.metrics.visitRate}%`);
  console.log(`  Conversion Rate: ${item.metrics.conversionRate}%`);
});
```

## Implementation Details

### Database Queries

The endpoint performs the following Prisma queries:

1. **Sent coupons by type** - Groups all `CampaignCoupon` records by `couponType`
2. **Visited coupons** - Groups coupons with `status = 'VISITED'`
3. **Converted coupons** - Groups coupons with `status = 'CONVERTED'`
4. **Template details** - Fetches `CouponTemplate` data for enrichment

### Performance Considerations

- Uses Prisma's `groupBy` for efficient aggregation
- Single campaign query with multiple parallel groupBy operations
- Results sorted by sent count (descending)
- No pagination needed (typically < 10 coupon types per campaign)

## Testing

Run the test script:

```bash
node test-coupon-breakdown.js
```

The script will:
1. Fetch available campaigns
2. Find a campaign with coupons sent
3. Call the breakdown endpoint
4. Display formatted results

## Error Handling

| Status | Scenario                    | Response                              |
|--------|----------------------------|---------------------------------------|
| 404    | Campaign not found          | `{ success: false, error: "..." }`   |
| 200    | No coupons sent yet         | `{ breakdown: [], totals: {...} }`   |
| 500    | Database or server error    | `{ success: false, error: "..." }`   |

## Related Files

- **Controller**: `src/controllers/campaignsController.js` (line 476)
- **Service**: `src/services/campaignsService.js` (line 1216)
- **Route**: `src/routes/campaigns.js` (line 97)
- **Test**: `test-coupon-breakdown.js`

## Future Enhancements

1. **Scenario Breakdown**: Group by both `couponType` AND `scenario` to see which scenarios trigger which coupons
2. **Time Series**: Add date range filters to track coupon performance over time
3. **Export**: Add CSV/Excel export functionality for reporting
4. **Comparison**: Compare breakdown across multiple campaigns

## Integration with Frontend

Example React component usage:

```typescript
import { useQuery } from '@tanstack/react-query';

function CouponBreakdownChart({ campaignId }: { campaignId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['coupon-breakdown', campaignId],
    queryFn: () => 
      fetch(`/api/v1/campaigns/${campaignId}/coupon-breakdown`)
        .then(res => res.json())
  });

  if (isLoading) return <Spinner />;

  return (
    <div>
      <h3>Coupon Distribution</h3>
      {data.data.breakdown.map(item => (
        <div key={item.couponType}>
          <h4>{item.name}</h4>
          <p>Sent: {item.metrics.sent}</p>
          <p>Conversion: {item.metrics.conversionRate}%</p>
        </div>
      ))}
    </div>
  );
}
```
