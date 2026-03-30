# Script de pruebas para endpoints de campanas
# Sin emojis ni caracteres especiales para mejor compatibilidad con PowerShell

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "PRUEBAS COMPLETAS DE ENDPOINTS DE CAMPANAS" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# Variables
$baseUrl = "http://localhost:3004/api/v1"
$email = "test-campaigns@easyorder.mx"
$password = "Test1234!"

# 1. LOGIN
Write-Host "`n(1/14) LOGIN" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

try {
    $loginBody = @{
        email = $email
        password = $password
    } | ConvertTo-Json
    
    Write-Host "Enviando request a: $baseUrl/auth/login" -ForegroundColor Gray
    
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" `
        -Method Post `
        -ContentType "application/json" `
        -Body $loginBody
    
    if ($loginResponse.success -and $loginResponse.data.token) {
        $token = $loginResponse.data.token
        Write-Host "OK: Login exitoso" -ForegroundColor Green
        Write-Host "Token: $($token.Substring(0, 30))..." -ForegroundColor Gray
    } else {
        Write-Host "ERROR: Login fallo - No se recibio token" -ForegroundColor Red
        Write-Host "Response: $($loginResponse | ConvertTo-Json)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "ERROR: Error en login: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Detalles: $_" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$apiKeyHeaders = @{
    "Content-Type" = "application/json"
    "X-API-Key" = "test-api-key-12345"
}

# 2. LISTAR CAMPAÑAS
Write-Host "`n(2/14) LISTAR TODAS LAS CAMPAÑAS (GET /campaigns)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

try {
    $campaignsResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns" `
        -Method Get `
        -Headers $headers
    
    Write-Host "OK: Campanas obtenidas: $($campaignsResponse.data.Count)" -ForegroundColor Green
    $campaignsResponse.data | Select-Object -First 3 | ForEach-Object {
        Write-Host "  - $($_.name) (Status: $($_.status), Type: $($_.type))" -ForegroundColor Gray
    }
} catch {
    Write-Host "ERROR: Error listando campanas: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. CREAR NUEVA CAMPANA
Write-Host "`n(3/14) CREAR NUEVA CAMPANA (POST /campaigns)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$newCampaignData = @{
    name = "Campana PowerShell Test $timestamp"
    description = "Campana creada desde script de pruebas PowerShell"
    type = "ACQUISITION"
    centerLat = 24.8091
    centerLng = -107.3940
    radiusMeters = 5000
    activityCodes = @("722511", "722512")
    employeeRanges = @("6-10", "11-30")
    agentConfigId = "agent-test-001"
    agentConfigName = "Agente Test"
    offer = "20% descuento en primer mes"
    couponPrefix = "PSTEST"
} | ConvertTo-Json

try {
    $createResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns" `
        -Method Post `
        -Headers $headers `
        -Body $newCampaignData
    
    $newCampaignId = $createResponse.data.id
    Write-Host "OK: Campana creada exitosamente" -ForegroundColor Green
    Write-Host "  ID: $newCampaignId" -ForegroundColor Gray
    Write-Host "  Nombre: $($createResponse.data.name)" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Error creando campana: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 4. OBTENER CAMPANA POR ID
Write-Host "`n(4/14) OBTENER CAMPANA POR ID (GET /campaigns/:id)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

try {
    $campaignResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId" `
        -Method Get `
        -Headers $headers
    
    Write-Host "OK: Campana obtenida" -ForegroundColor Green
    Write-Host "  Nombre: $($campaignResponse.data.name)" -ForegroundColor Gray
    Write-Host "  Status: $($campaignResponse.data.status)" -ForegroundColor Gray
    Write-Host "  Type: $($campaignResponse.data.type)" -ForegroundColor Gray
    Write-Host "  Activity Codes: $($campaignResponse.data.activityCodes -join ', ')" -ForegroundColor Gray
    Write-Host "  Radius: $($campaignResponse.data.radiusMeters)m" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Error obteniendo campana: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. ACTUALIZAR CAMPANA
Write-Host "`n(5/14) ACTUALIZAR CAMPANA (PATCH /campaigns/:id)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

$updateData = @{
    name = "Campana PowerShell Test ACTUALIZADA"
    status = "ACTIVE"
    description = "Descripcion actualizada desde PowerShell"
} | ConvertTo-Json

try {
    $updateResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId" `
        -Method Patch `
        -Headers $headers `
        -Body $updateData
    
    Write-Host "OK: Campana actualizada" -ForegroundColor Green
    Write-Host "  Nuevo nombre: $($updateResponse.data.name)" -ForegroundColor Gray
    Write-Host "  Nuevo status: $($updateResponse.data.status)" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Error actualizando campana: $($_.Exception.Message)" -ForegroundColor Red
}

# 6. ASIGNAR CONTACTOS MANUALMENTE
Write-Host "`n(6/14) ASIGNAR CONTACTOS MANUALMENTE (POST /campaigns/:id/contacts)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

$contactsData = @{
    establishmentIds = @("est-ps-001", "est-ps-002", "est-ps-003")
} | ConvertTo-Json

try {
    $assignResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId/contacts" `
        -Method Post `
        -Headers $headers `
        -Body $contactsData
    
    Write-Host "OK: Contactos asignados: $($assignResponse.data.Count)" -ForegroundColor Green
    $assignResponse.data | ForEach-Object {
        Write-Host "  - $($_.establishmentId)" -ForegroundColor Gray
    }
} catch {
    Write-Host "ERROR: Error asignando contactos: $($_.Exception.Message)" -ForegroundColor Red
}

# 7. LISTAR CONTACTOS DE CAMPANA
Write-Host "`n(7/14) LISTAR CONTACTOS DE CAMPANA (GET /campaigns/:id/contacts)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

try {
    $contactsResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId/contacts" `
        -Method Get `
        -Headers $headers
    
    Write-Host "OK: Contactos obtenidos: $($contactsResponse.data.Count)" -ForegroundColor Green
    $contactsResponse.data | ForEach-Object {
        Write-Host "  - $($_.establishmentId) (Status: $($_.status))" -ForegroundColor Gray
    }
    
    # Guardar primer contactId para prueba posterior
    if ($contactsResponse.data.Count -gt 0) {
        $firstContactId = $contactsResponse.data[0].id
    }
} catch {
    Write-Host "ERROR: Error listando contactos: $($_.Exception.Message)" -ForegroundColor Red
}

# 8. ACTUALIZAR ESTADO DE CONTACTO
if ($firstContactId) {
    Write-Host "`n(8/14) ACTUALIZAR ESTADO DE CONTACTO (PATCH /contacts/:contactId/status)" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"
    
    $contactUpdateData = @{
        status = "SENT"
        messageId = "whatsapp-msg-test-001"
    } | ConvertTo-Json
    
    try {
        $contactUpdateResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/contacts/$firstContactId/status" `
            -Method Patch `
            -Headers $headers `
            -Body $contactUpdateData
        
        Write-Host "OK: Estado de contacto actualizado" -ForegroundColor Green
        Write-Host "  Nuevo status: $($contactUpdateResponse.data.status)" -ForegroundColor Gray
    } catch {
        Write-Host "ERROR: Error actualizando contacto: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n(8/14) ACTUALIZAR ESTADO DE CONTACTO - OMITIDO (sin contactos)" -ForegroundColor Yellow
}

# 9. OBTENER ESTADISTICAS DE CAMPANA
Write-Host "`n(9/14) OBTENER ESTADISTICAS (GET /campaigns/:id/stats)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

try {
    $statsResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId/stats" `
        -Method Get `
        -Headers $headers
    
    Write-Host "OK: Estadisticas obtenidas" -ForegroundColor Green
    Write-Host "  Total Contactos: $($statsResponse.data.metrics.totalContacts)" -ForegroundColor Gray
    Write-Host "  Total Called: $($statsResponse.data.metrics.totalCalled)" -ForegroundColor Gray
    Write-Host "  Total Responded: $($statsResponse.data.metrics.totalResponded)" -ForegroundColor Gray
    Write-Host "  Total Converted: $($statsResponse.data.metrics.totalConverted)" -ForegroundColor Gray
    Write-Host "  Conversion Rate: $($statsResponse.data.metrics.conversionRate)%" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Error obteniendo estadisticas: $($_.Exception.Message)" -ForegroundColor Red
}

# 10. GENERAR CUPONES
Write-Host "`n(10/14) GENERAR CUPONES (POST /coupons/bulk)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

$couponsData = @{
    campaignId = $newCampaignId
    count = 5
    offerTemplate = "20% descuento en primer mes"
} | ConvertTo-Json

try {
    $couponsResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/bulk" `
        -Method Post `
        -Headers $headers `
        -Body $couponsData
    
    Write-Host "OK: Cupones generados: $($couponsResponse.data.Count)" -ForegroundColor Green
    $couponsResponse.data | ForEach-Object {
        Write-Host "  - $($_.code)" -ForegroundColor Gray
    }
    
    # Guardar primer codigo de cupon para pruebas
    if ($couponsResponse.data.Count -gt 0) {
        $firstCouponCode = $couponsResponse.data[0].code
    }
} catch {
    Write-Host "ERROR: Error generando cupones: $($_.Exception.Message)" -ForegroundColor Red
}

# 11. LISTAR CUPONES DE CAMPANA
Write-Host "`n(11/14) LISTAR CUPONES (GET /coupons?campaignId=xxx)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

try {
    $listCouponsResponse = Invoke-RestMethod -Uri "$baseUrl/coupons?campaignId=$newCampaignId" `
        -Method Get `
        -Headers $headers
    
    Write-Host "OK: Cupones listados: $($listCouponsResponse.data.Count)" -ForegroundColor Green
    $listCouponsResponse.data | ForEach-Object {
        Write-Host "  - $($_.code) (Status: $($_.status))" -ForegroundColor Gray
    }
} catch {
    Write-Host "ERROR: Error listando cupones: $($_.Exception.Message)" -ForegroundColor Red
}

# 12. TRACKEAR CUPON VISITADO
if ($firstCouponCode) {
    Write-Host "`n(12/14) TRACKEAR CUPON VISITADO (POST /coupons/:code/visit)" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"
    
    try {
        $visitedResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/$firstCouponCode/visit" `
            -Method Post `
            -Headers $apiKeyHeaders
        
        Write-Host "OK: Cupon marcado como visitado" -ForegroundColor Green
        Write-Host "  Codigo: $($visitedResponse.data.code)" -ForegroundColor Gray
        Write-Host "  Visitas: $($visitedResponse.data.visitCount)" -ForegroundColor Gray
    } catch {
        Write-Host "ERROR: Error trackeando visita: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n(12/14) TRACKEAR CUPON VISITADO - OMITIDO (sin cupones)" -ForegroundColor Yellow
}

# 13. TRACKEAR CUPON CONVERTIDO
if ($firstCouponCode) {
    Write-Host "`n(13/14) TRACKEAR CUPON CONVERTIDO (POST /coupons/:code/convert)" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"
    
    try {
        $convertedResponse = Invoke-RestMethod -Uri "$baseUrl/coupons/$firstCouponCode/convert" `
            -Method Post `
            -Headers $apiKeyHeaders
        
        Write-Host "OK: Cupon marcado como convertido" -ForegroundColor Green
        Write-Host "  Codigo: $($convertedResponse.data.code)" -ForegroundColor Gray
        Write-Host "  Status: $($convertedResponse.data.status)" -ForegroundColor Gray
    } catch {
        Write-Host "ERROR: Error trackeando conversion: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n(13/14) TRACKEAR CUPON CONVERTIDO - OMITIDO (sin cupones)" -ForegroundColor Yellow
}

# 14. ELIMINAR CAMPANA
Write-Host "`n(14/14) ELIMINAR CAMPANA (DELETE /campaigns/:id)" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------"

# Primero pausar la campana (no se puede eliminar una campana activa)
Write-Host "Pausando campana antes de eliminar..." -ForegroundColor Gray
$pauseData = @{ status = "PAUSED" } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId" `
        -Method Patch `
        -Headers $headers `
        -Body $pauseData | Out-Null
    Write-Host "Campana pausada" -ForegroundColor Gray
} catch {
    Write-Host "Advertencia: No se pudo pausar la campana" -ForegroundColor Yellow
}

# Ahora eliminar la campana
try {
    $deleteResponse = Invoke-RestMethod -Uri "$baseUrl/campaigns/$newCampaignId" `
        -Method Delete `
        -Headers $headers
    
    Write-Host "OK: Campana eliminada exitosamente" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Error eliminando campana: $($_.Exception.Message)" -ForegroundColor Red
}

# RESUMEN FINAL
Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "PRUEBAS COMPLETADAS" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "`nTodas las pruebas han sido ejecutadas." -ForegroundColor Green
Write-Host "Revisa los resultados arriba para ver el estado de cada endpoint." -ForegroundColor Green
