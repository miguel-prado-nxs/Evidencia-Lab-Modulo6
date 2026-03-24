# Documentación: Integración de Voces en Campañas (SDR y Calificación)

Esta documentación detalla la implementación realizada para que las campañas automáticas utilicen la voz y personalidad configuradas en el **Agent Builder**, replicando el comportamiento de "Mis Negocios" para ambos tipos de agentes.

## 1. Arquitectura del Flujo

Actualmente, cuando se inicia una campaña, el sistema sigue este flujo:

1.  **Servicio de Campañas (`campaignsService.js`)**: Al llamar a `startCampaign`, el servidor detecta si el Agente de la campaña es de tipo **SDR** o **CALIFICACIÓN** comparando su ID con las variables de entorno (`ELEVENLABS_SDR_AGENT_ID` vs `ELEVENLABS_QUALIFICATION_AGENT_ID`).
2.  **Consulta al Agent Builder**: Se consulta al `demo-form-service` usando el endpoint correspondiente:
    - `/agent-configs/default/SDR`
    - `/agent-configs/default/QUALIFICATION`
3.  **Extracción de Configuración**: Se extraen los campos `openai_voice` (ID de ElevenLabs) y `personality_name` (Nombre del Agente).
4.  **Inyección de Variables**: Estos valores se inyectan en las `dynamic_variables` de cada contacto. Se envían tanto en formato `camelCase` como `snake_case` para evitar errores de validación.
5.  **Despacho de Lotes (`campaignBatchDispatcherService.js`)**: El despachador recibe los contactos y construye el payload final para la API de ElevenLabs.
6.  **Shotgun Override**: Para asegurar que ElevenLabs cambie la voz física, el `voice_id` se envía en 4 ubicaciones redundantes dentro del payload de cada contacto.

## 2. Cambios Técnicos Realizados

### Backend (`easyorder-partners-api`)

#### [MODIFY] `src/services/campaignsService.js`
- Se implementó detección dinámica del tipo de agente en `startCampaign`.
- Se corrigió la inyección de variables para incluir `decision_maker_name`, `decisionMakerName`, `agent_name`, `agentName`, etc.
- Se definieron `finalVoiceId` y `finalVoiceName` con prioridad: Agent Builder > ElevenLabs Agent > Contact Data.

#### [MODIFY] `src/services/campaignBatchDispatcherService.js`
- **Shotgun Payload**: Se envían múltiples copias de `voice_id` y `conversation_config_override` para garantizar el cambio de voz física.
- **Variable Preservation**: Se desactivó la función `removeDuplicateAliases` que borraba variables `camelCase`, previniendo el error "Missing required dynamic variables".

### Frontend (`web-easyorder-ventas`)

#### [MODIFY] `src/components/campaigns/AudienceFilters.tsx`
- Se corrigió un error de consola de React añadiendo la propiedad `key={activity.code}` en el mapeo de los códigos de actividad.

## 3. Estabilización y Fixes

- **Prisma**: Se regeneraron los clientes de Prisma para `schema.prisma` y `schema-geo.prisma` tras el merge de ramas.
- **Servidor**: Se resolvió el error `EADDRINUSE` liberando el puerto 3004.

## 4. Verificación de Funcionamiento

Para validar que los cambios están activos:
1.  Configura una voz en **Agent Builder** para el tipo de agente deseado.
2.  Lanza una campaña de prueba.
3.  Revisa los logs del servidor; verás un log indicando el tipo detectado: `[CampaignStart] Detectado tipo de agente: QUALIFICATION`.
4.  Verifica en ElevenLabs que la llamada incluya el `voice_id` correcto en el payload.

---
**Última actualización:** 24 de marzo de 2026
**Implementado por:** Antigravity AI Agent
