# Documentación: Integración de Voces en Campañas (SDR)

Esta documentación detalla la implementación realizada para que las campañas automáticas utilicen la voz y personalidad configuradas en el **Agent Builder**, replicando el comportamiento de "Mis Negocios".

## 1. Arquitectura del Flujo

Actualmente, cuando se inicia una campaña, el sistema sigue este flujo:

1.  **Servicio de Campañas (`campaignsService.js`)**: Al llamar a `startCampaign`, el servidor ahora consulta al `demo-form-service` para obtener el **Agente SDR por Defecto**.
2.  **Extracción de Configuración**: Se extraen los campos `openai_voice` (ID de ElevenLabs) y `personality_name` (Nombre del Agente).
3.  **Inyección de Variables**: Estos valores se inyectan en las `dynamic_variables` de cada contacto.
4.  **Despacho de Lotes (`campaignBatchDispatcherService.js`)**: El despachador recibe los contactos y construye el payload final para la API de ElevenLabs.
5.  **Shotgun Override**: Para asegurar que ElevenLabs cambie la voz física, el `voice_id` se envía en 4 ubicaciones redundantes del payload.

## 2. Cambios Técnicos Realizados

### Backend (`easyorder-partners-api`)

#### [MODIFY] `src/services/campaignsService.js`
- Se añadió lógica en `startCampaign` para consultar `GET /agent-configs/default/SDR`.
- Se definieron `finalVoiceId` y `finalVoiceName` con prioridad: Agent Builder > ElevenLabs Agent > Contact Data.
- Se mapeó el payload de `recipients` para incluir `voice_id`, `voice_name`, `personality_name` y `voiceId` de forma consistente.

#### [MODIFY] `src/services/campaignBatchDispatcherService.js`
- Se implementó la técnica de **"Shotgun Payload"** para forzar el cambio de voz en la API de ElevenLabs.
- El objeto de cada destinatario ahora incluye:
    - `"voice_id": "..."` (Nivel raíz)
    - `"conversation_initiation_client_data": { "voice_id": "..." }`
    - `"conversation_initiation_client_data": { "conversation_config_override": { "tts": { "voice_id": "..." } } }`
    - `"conversation_config_override": { "tts": { "voice_id": "..." } }` (Nivel raíz del destinatario)

### Frontend (`web-easyorder-ventas`)

#### [MODIFY] `src/components/campaigns/AudienceFilters.tsx`
- Se corrigió un error de consola de React añadiendo la propiedad `key={activity.code}` en el mapeo de los códigos de actividad.

## 3. Estabilización y Fixes

- **Prisma**: Se regeneraron los clientes de Prisma para `schema.prisma` y `schema-geo.prisma` para asegurar consistencia con la base de datos tras el merge.
- **Servidor**: Se resolvió el error `EADDRINUSE` liberando el puerto 3004 bloqueado por procesos huérfanos.

## 4. Verificación de Funcionamiento

Para validar que los cambios están activos:
1.  Configura una voz en **Agent Builder** (ej. Benito).
2.  Lanza una campaña de prueba.
3.  Revisa los logs del servidor; deberías ver un log: `[BatchDispatcher] About to submit batch to ElevenLabs` que incluya el `voiceId` y `configOverride` con el ID de Benito (`L4uMFXcIZzlPTOfcbCKy`).

---
**Fecha:** 24 de marzo de 2026
**Implementado por:** Antigravity AI Agent
