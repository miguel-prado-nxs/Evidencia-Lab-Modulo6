# Test de Endpoints de Cupones
# Este script prueba los nuevos endpoints del sistema de cupones

$baseUrl = "http://localhost:3004/api/v1"
$apiKey = "test-api-key-12345"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TEST DE ENDPOINTS DE CUPONES" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Login para obtener token JWT
Write-Host "1. Login..." -ForegroundColor Yellow
$loginResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"email": "test-campaigns@easyorder.mx", "password": "Test1234!"}'

$token = $loginResponse.data.token
Write-Host "[OK] Token obtenido" -ForegroundColor Green
Write-Host ""

# 1.5. Crear campana de prueba
Write-Host "1.5. Crear campana de prueba..." -ForegroundColor Yellow
try {
    $campaignBody = @{
        name = "Campana Test Cupones"
        description = "Campana para probar generacion de cupones"
        type = "ACQUISITION"
        couponPrefix = "PLUS30"
    } | ConvertTo-Json

    $campaignResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{"Authorization"="Bearer $token"} `
        -Body $campaignBody
    
    $campaignId = $campaignResponse.data.id
    Write-Host "[OK] Campana creada: $campaignId" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Error creando campana: $_" -ForegroundColor Red
    $campaignId = $null
}
Write-Host ""

# 2. Listar templates de cupones
Write-Host "2. Listar templates de cupones..." -ForegroundColor Yellow
try {
    $templatesResponse = Invoke-RestMethod -Uri "$baseUrl/coupon-templates" `
        -Method Get `
        -Headers @{"Authorization"="Bearer $token"}
    
    Write-Host "[OK] Templates encontrados: $($templatesResponse.data.Count)" -ForegroundColor Green
    Write-Host "Templates disponibles:" -ForegroundColor Cyan
    foreach ($template in $templatesResponse.data) {
        Write-Host "  - $($template.couponType): $($template.name)" -ForegroundColor White
    }
} catch {
    Write-Host "[ERROR] Error listando templates: $_" -ForegroundColor Red
}
Write-Host ""

# 3. Obtener template especifico
Write-Host "3. Obtener template PLUS30..." -ForegroundColor Yellow
try {
    $templateResponse = Invoke-RestMethod -Uri "$baseUrl/coupon-templates/PLUS30" `
        -Method Get `
        -Headers @{"Authorization"="Bearer $token"}
    
    Write-Host "[OK] Template PLUS30 obtenido" -ForegroundColor Green
    Write-Host "  Nombre: $($templateResponse.data.name)" -ForegroundColor White
    Write-Host "  Descuento: $($templateResponse.data.percentOff)%" -ForegroundColor White
    Write-Host "  Duracion: $($templateResponse.data.durationMonths) mes(es)" -ForegroundColor White
} catch {
    Write-Host "[ERROR] Error obteniendo template: $_" -ForegroundColor Red
}
Write-Host ""

# 4. Verificar elegibilidad
Write-Host "4. Verificar elegibilidad de usuario..." -ForegroundColor Yellow
try {
    $eligibilityResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/check-eligibility" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{"X-API-Key"=$apiKey} `
        -Body '{"phone": "5215512345678", "couponType": "PLUS30"}'
    
    if ($eligibilityResponse.data.eligible) {
        Write-Host "[OK] Usuario elegible para cupon PLUS30" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Usuario NO elegible: $($eligibilityResponse.data.reason)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[ERROR] Error verificando elegibilidad: $_" -ForegroundColor Red
}
Write-Host ""

# 5. Generar cupon AD-HOC (sin campaignId)
Write-Host "5. Generar cupon AD-HOC (sin campana)..." -ForegroundColor Yellow
try {
    $generateBody = @{
        phone = "5215512345678"
        prospectName = "Carlos Rodriguez"
        businessName = "La Taqueria del Centro"
        scenario = "bant_high"
        bantScores = @{
            budget = 8
            authority = 9
            need = 10
            timing = 7
        }
        agentId = "agent-test-123"
        callId = "call-test-456"
    } | ConvertTo-Json

    $generateResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/generate-for-call" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{"X-API-Key"=$apiKey} `
        -Body $generateBody
    
    $couponCodeAdHoc = $generateResponse.data.coupon.code
    Write-Host "[OK] Cupon AD-HOC generado: $couponCodeAdHoc" -ForegroundColor Green
    Write-Host "  Oferta: $($generateResponse.data.coupon.offer)" -ForegroundColor White
    Write-Host "  Expira: $($generateResponse.data.coupon.expiresAt)" -ForegroundColor White
    Write-Host "  campaign_id: NULL (ad-hoc)" -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Error generando cupon: $_" -ForegroundColor Red
    $couponCodeAdHoc = $null
}
Write-Host ""

# 6. Generar cupon CON campaignId
if ($campaignId) {
    Write-Host "6. Generar cupon de CAMPANA (con campaignId)..." -ForegroundColor Yellow
    try {
        $generateCampaignBody = @{
            phone = "5215598765432"
            prospectName = "Maria Lopez"
            businessName = "Restaurante El Buen Sabor"
            scenario = "bant_high"
            agentId = "agent-test-456"
            callId = "call-test-789"
            campaignId = $campaignId
        } | ConvertTo-Json

        $generateCampaignResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/generate-for-call" `
            -Method Post `
            -ContentType "application/json" `
            -Headers @{"X-API-Key"=$apiKey} `
            -Body $generateCampaignBody
        
        $couponCodeCampaign = $generateCampaignResponse.data.coupon.code
        Write-Host "[OK] Cupon de CAMPANA generado: $couponCodeCampaign" -ForegroundColor Green
        Write-Host "  Oferta: $($generateCampaignResponse.data.coupon.offer)" -ForegroundColor White
        Write-Host "  campaign_id: $campaignId" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Error generando cupon de campana: $_" -ForegroundColor Red
        $couponCodeCampaign = $null
    }
    Write-Host ""
}

# 7. Marcar cupon como visitado
if ($couponCodeAdHoc) {
    Write-Host "7. Marcar cupon como visitado..." -ForegroundColor Yellow
    try {
        $visitResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/$couponCodeAdHoc/visit" `
            -Method Post `
            -ContentType "application/json" `
            -Headers @{"X-API-Key"=$apiKey} `
            -Body '{}'
        
        Write-Host "[OK] Cupon marcado como visitado" -ForegroundColor Green
        Write-Host "  Visitas: $($visitResponse.data.visitCount)" -ForegroundColor White
    } catch {
        Write-Host "[ERROR] Error marcando visita: $_" -ForegroundColor Red
    }
    Write-Host ""

    # 8. Redimir cupon
    Write-Host "8. Redimir cupon..." -ForegroundColor Yellow
    try {
        $redeemBody = @{
            userData = @{
                userId = "user-test-789"
                email = "carlos@taqueria.com"
            }
        } | ConvertTo-Json

        $redeemResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/$couponCodeAdHoc/redeem" `
            -Method Post `
            -ContentType "application/json" `
            -Headers @{"X-API-Key"=$apiKey} `
            -Body $redeemBody
        
        Write-Host "[OK] Cupon redimido exitosamente" -ForegroundColor Green
        Write-Host "  Estado: $($redeemResponse.data.coupon.status)" -ForegroundColor White
        Write-Host ""
        Write-Host "Configuracion Stripe:" -ForegroundColor Cyan
        Write-Host "  Descuento: $($redeemResponse.data.stripeConfig.percentOff)%" -ForegroundColor White
        Write-Host "  Duracion: $($redeemResponse.data.stripeConfig.durationMonths) mes(es)" -ForegroundColor White
    } catch {
        Write-Host "[ERROR] Error redimiendo cupon: $_" -ForegroundColor Red
    }
    Write-Host ""

    # 9. Intentar redimir de nuevo (debe fallar)
    Write-Host "9. Intentar redimir cupon ya usado (debe fallar)..." -ForegroundColor Yellow
    try {
        $redeemAgainResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/$couponCodeAdHoc/redeem" `
            -Method Post `
            -ContentType "application/json" `
            -Headers @{"X-API-Key"=$apiKey} `
            -Body '{}'
        
        Write-Host "[ERROR] ERROR: Cupon se redimio dos veces!" -ForegroundColor Red
    } catch {
        Write-Host "[OK] Correcto: Cupon ya redimido no se puede usar de nuevo" -ForegroundColor Green
    }
    Write-Host ""
}

# 10. Verificar elegibilidad despues de recibir cupon
Write-Host "10. Verificar elegibilidad despues de recibir cupon..." -ForegroundColor Yellow
try {
    $eligibility2Response = Invoke-RestMethod -Uri "$baseUrl/coupons/check-eligibility" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{"X-API-Key"=$apiKey} `
        -Body '{"phone": "5215512345678", "couponType": "PLUS30"}'
    
    if ($eligibility2Response.data.eligible) {
        Write-Host "[WARN] Usuario aun elegible (puede ser correcto si maxPerUser > 1)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Usuario ya no elegible: $($eligibility2Response.data.reason)" -ForegroundColor Green
    }
} catch {
    Write-Host "[ERROR] Error verificando elegibilidad: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TESTS COMPLETADOS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
