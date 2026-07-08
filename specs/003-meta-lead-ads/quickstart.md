# Quickstart: Validar la integración de Meta Lead Ads

**Feature**: 003-meta-lead-ads

## Prerequisitos

- Variables de entorno configuradas en `.env` (coordinadas con el operador de `roasify.ai`, ver `research.md` Decisión 7 y el addendum de `specs/001-crm-mejoras-marketing/research.md`):
  - `META_APP_ID`
  - `META_APP_SECRET`
  - `META_WEBHOOK_VERIFY_TOKEN` (definido por este proyecto, no por Meta)
  - `META_LEAD_ADS_ENABLED=false` (hasta que se apruebe `leads_retrieval`)
- Migraciones de Prisma aplicadas (`npm run db:migrate:dev` tras crear los modelos de `data-model.md` + `npm run db:generate`).
- Servidor corriendo (`npm run dev`, puerto 3004) y worker de colas activo (`npm run start:workers` o auto-iniciado en dev).

## Escenario 1 — Verificación de suscripción del webhook

```bash
curl "http://localhost:3004/api/v1/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=<META_WEBHOOK_VERIFY_TOKEN>&hub.challenge=test123"
```

**Esperado**: `200`, body = `test123`.

```bash
curl "http://localhost:3004/api/v1/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=test123"
```

**Esperado**: `403`.

## Escenario 2 — Notificación de lead con firma inválida (debe rechazarse)

```bash
curl -X POST http://localhost:3004/api/v1/webhooks/meta-leads \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000" \
  -d '{"object":"page","entry":[{"id":"123","changes":[{"field":"leadgen","value":{"leadgen_id":"lead_test_1","page_id":"123","form_id":"456"}}]}]}'
```

**Esperado**: `403`. Verificar en logs que no se creó ningún `MetaLeadWebhookEvent` (`SELECT * FROM meta_lead_webhook_events WHERE leadgen_id = 'lead_test_1'` debe devolver 0 filas).

## Escenario 3 — Notificación de lead válida (feliz camino, FR-001/FR-003)

Generar la firma correcta con el `META_APP_SECRET` real sobre el body exacto (ver contrato en `contracts/meta-webhook.md`), luego:

```bash
curl -X POST http://localhost:3004/api/v1/webhooks/meta-leads \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=<firma calculada>" \
  -d '{"object":"page","entry":[{"id":"<page_id>","changes":[{"field":"leadgen","value":{"leadgen_id":"lead_test_2","page_id":"<page_id>","form_id":"<form_id>"}}]}]}'
```

**Esperado**:
1. Respuesta `200` inmediata.
2. `MetaLeadWebhookEvent` creado con `leadgenId = 'lead_test_2'`.
3. Si `META_LEAD_ADS_ENABLED=true`: en el siguiente ciclo del worker, se crea un `MetaLead` con los datos obtenidos de la Graph API (requiere `page_access_token` real y permiso aprobado — con `META_LEAD_ADS_ENABLED=false`, este paso no ocurre, ver Escenario 5).
4. El equipo recibe la notificación `LEAD_NEW` (verificar en la tabla `notifications` o vía Socket.io en el frontend).

## Escenario 4 — Deduplicación ante notificación repetida (US3/FR-004)

Repetir exactamente la misma request del Escenario 3 (mismo `leadgen_id = 'lead_test_2'`).

**Esperado**: `200` igual, pero **no** se crea un segundo `MetaLeadWebhookEvent` ni un segundo `MetaLead` — verificar `SELECT COUNT(*) FROM meta_lead_webhook_events WHERE leadgen_id = 'lead_test_2'` = 1.

## Escenario 5 — Comportamiento con `META_LEAD_ADS_ENABLED=false` (FR-007/SC-005)

Con el flag en `false`, repetir el Escenario 3 con un `leadgen_id` nuevo.

**Esperado**: `200`, se crea el `MetaLeadWebhookEvent`, pero no se encola/procesa el `MetaLeadJob` — no hay ningún intento de llamar a la Graph API de Meta, ni error en logs. El registro queda listo para procesarse automáticamente en cuanto se active el flag (sin necesidad de reenviar el webhook).

## Escenario 6 — Lead con teléfono inválido (US2/FR-005/SC-004)

Enviar un lead válido cuyo `field_data` de la Graph API (mockeado en el job para esta prueba) no incluya un teléfono usable.

**Esperado**: el `MetaLead` resultante queda con `status = INCOMPLETE_DATA`, visible en el CRM, sin generar ningún error ni excepción no capturada en logs.

## Escenario 7 — Lead que coincide con un Establecimiento existente (FR-006)

Con un `EstablishmentEnrichment` de prueba que tenga `decisionMakerPhone` conocido, enviar un lead de Meta con ese mismo teléfono en el `field_data`.

**Esperado**: el `MetaLead` resultante queda con `status = LINKED_TO_ESTABLISHMENT` y `establishmentId` apuntando al establecimiento correcto — no se crea un Prospecto nuevo y separado.
