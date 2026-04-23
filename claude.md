# EasyOrder Partners API

## Qué es este proyecto

Backend API del sistema de ventas y partners de EasyOrder. Gestiona el ciclo completo de adquisición de clientes restauranteros en México: desde prospección geográfica (800k+ establecimientos DENUE), llamadas automatizadas con agentes de voz IA (ElevenLabs), enriquecimiento de datos, campañas de marketing, cupones, hasta la conversión final y sincronización con CRM (Twenty).

## Stack técnico

- **Runtime**: Node.js (CommonJS, `require`)
- **Framework**: Express 4.x
- **ORM**: Prisma 5.x (dos schemas: principal + geo)
- **BD principal**: PostgreSQL (`DATABASE_URL`) — usuarios, partners, leads, campañas, enrichment, cupones
- **BD geo (solo lectura)**: PostgreSQL (`DATABASE_URL_RESTAURANTES`) — 800k+ establecimientos DENUE/INEGI
- **Colas**: Bull + Redis (IORedis) — para llamadas SDR, qualification y reconciliación
- **Real-time**: Socket.io + SSE para eventos de enriquecimiento
- **Auth**: JWT (usuarios web) + API Key (agentes/webhooks)
- **Logging**: Winston
- **Almacenamiento**: AWS S3
- **Email**: Resend
- **Validación**: Zod
- **Agentes IA**: ElevenLabs (4 agentes vía MCP - Model Context Protocol)
- **CRM externo**: Twenty CRM (sincronización bidireccional)

## Estructura de carpetas

```
src/
├── app.js                  # Entry point, monta middleware y rutas
├── startWorkers.js         # Entry point de workers (Bull)
├── config/
│   ├── env.js              # Variables de entorno centralizadas
│   ├── database.js         # Prisma client principal
│   ├── database-geo.js     # Prisma client geo (solo lectura)
│   ├── logger.js           # Winston config
│   ├── socket.js           # Socket.io config
│   ├── sseEvents.js        # Server-Sent Events
│   └── storage.js          # AWS S3 config
├── controllers/            # Handlers de rutas (req, res)
├── services/               # Lógica de negocio
│   └── twenty/             # Integración Twenty CRM
├── routes/                 # Definición de rutas Express
├── middleware/
│   ├── auth.js             # JWT + API Key + roles
│   ├── enrichmentAgent.js  # Auth para agentes de enriquecimiento
│   ├── errorHandler.js     # Error handler global
│   ├── upload.js           # Multer config
│   └── validation.js       # Validaciones genéricas
├── mcp/                    # Servidores MCP para agentes ElevenLabs
│   ├── discoveryMcp.js     # Agente Discovery
│   ├── qualificationMcp.js # Agente Qualification
│   ├── activationMcp.js    # Agente Activation
│   └── conversionMcp.js    # Agente Conversion
├── queues/                 # Configuración Bull queues
├── workers/                # Procesadores de colas
│   ├── sdrCallWorker.js
│   ├── qualificationCallWorker.js
│   ├── campaignBatchReconciliationWorker.js
│   └── twentySyncWorker.js
prisma/
├── schema.prisma           # Schema principal (partners, leads, campaigns, enrichment, coupons)
├── schema-geo.prisma       # Schema geo (establishments DENUE - SOLO LECTURA)
├── migrations/             # Migraciones SQL
├── seed.js                 # Seeds principales
├── seed-coupon-templates.js
├── seed-email-templates.js
└── seed-campaigns.js
```

## Convenciones de código

- **Lenguaje**: JavaScript (CommonJS). NO TypeScript. Usa `require` y `module.exports`.
- **Naming**: camelCase para variables/funciones, PascalCase para modelos Prisma.
- **Controladores**: Reciben `(req, res)`, manejan HTTP, delegan a services. Siempre responden `{ success: true/false, data?, error? }`.
- **Servicios**: Lógica de negocio pura. Reciben parámetros, retornan datos. Acceden a Prisma directamente.
- **Rutas**: Archivo por dominio. Usan middleware de auth según necesidad: `authenticateJWT` (usuarios web), `authenticateApiKey` (agentes/webhooks).
- **Errores**: Se lanzan con `throw new Error()`. El `errorHandler` middleware los captura globalmente.
- **Prisma**: Los modelos usan `@map()` para snake_case en BD. En JS se usa camelCase.

## Bases de datos (dos conexiones Prisma)

### BD Principal (`prisma/schema.prisma`)
- `User`, `Partner`, `Lead`, `Deal`, `Commission` — Sistema de partners
- `Campaign`, `CampaignContact`, `CampaignBatch` — Campañas de llamadas
- `EstablishmentEnrichment` — Datos recolectados por agentes (campo JSON `establishmentData` + columnas directas)
- `CampaignCoupon`, `CouponTemplate` — Sistema de cupones
- `CallLead`, `LeadProspect` — Leads de llamadas
- `EstablishmentMeeting` — Agendamiento Calendly
- Tablas de training, certificates, notifications, settings, etc.

### BD Geo (`prisma/schema-geo.prisma`)
- `Establishment` — 800k+ restaurantes de DENUE/INEGI (SOLO LECTURA)
- `GeoZone` — Zonas geográficas con métricas
- Importar cliente como: `require("../config/database-geo")`

## Modelos clave

### EstablishmentEnrichment
Tabla central donde los 4 agentes de voz guardan datos. Tiene:
- **Columnas directas**: `decisionMakerName`, `decisionMakerEmail`, `pain`, `fear`, `desire`, `intent`, `enrichmentStatus`, `callStatus`, `callSummary`, `level`
- **Campo JSON** `establishmentData`: Datos flexibles por etapa (`discovery`, `qualification`, `activation`, `conversion`)
- **`enrichmentStatus`**: Controla flujo secuencial (`discovery_completed` → `qualification_completed` → `activation_completed` → `conversion_completed`)
- **`level`** (enum): `ESTABLISHMENT` → `CONTACT` → `PROSPECT` → `LEAD` → `CLIENT`

### Campaign
- `type`: Tipo de campaña (DISCOVERY, QUALIFICATION, ACTIVATION, CONVERSION)
- `agentConfigId`: ID del agente de ElevenLabs
- `status`: DRAFT, READY, IN_PROGRESS, COMPLETED, PAUSED, CANCELLED

## Agentes de voz (MCP)

4 agentes ElevenLabs, cada uno con su servidor MCP en `src/mcp/`:
1. **Discovery** — Primer contacto, explora negocio
2. **Qualification** — Califica prospect con preguntas de operación
3. **Activation** — Agenda demo, activa cuenta
4. **Conversion** — Maneja objeciones, cierra venta

Cada MCP expone tools via `@modelcontextprotocol/sdk` que los agentes llaman durante las llamadas telefónicas. El backend persiste datos en `EstablishmentEnrichment`.

Las rutas MCP se montan en `/mcp/discovery`, `/mcp/qualification`, `/mcp/activation`, `/mcp/conversion` (ver `src/routes/mcpRoutes.js`).

## Autenticación

Dos mecanismos en `src/middleware/auth.js`:
- **`authenticateJWT`**: Para usuarios del frontend web. Token Bearer en header.
- **`authenticateApiKey`**: Para agentes, webhooks y servicios externos. Header `x-api-key`.
- **Roles**: `ADMIN`, `PARTNER`, `SALES_REP`, `VIEWER`. Middleware `requireRole()` y `requireAnyRole()`.

## Servicios importantes

| Servicio | Función |
|----------|---------|
| `campaignsService.js` | CRUD campañas, asignación de contactos, dispatch de llamadas, mapeo agent→type |
| `campaignBatchDispatcherService.js` | Preparación y envío de lotes de llamadas a ElevenLabs |
| `funnelWebhookService.js` | Persistencia de datos de agentes (save/end call por etapa) |
| `enrichmentService.js` | Enriquecimiento manual y automático de establishments |
| `geoService.js` | Queries geográficas (radio, conteo, filtros por actividad) |
| `couponGeneratorService.js` | Generación, redención y validación de cupones |
| `couponWhatsappService.js` | Envío de cupones por WhatsApp |
| `twenty/twentyService.js` | Sincronización con Twenty CRM |

## Variables de entorno importantes

```
DATABASE_URL=                    # PostgreSQL principal
DATABASE_URL_RESTAURANTES=       # PostgreSQL geo (solo lectura)
JWT_SECRET=
API_KEY_SECRET=
REDIS_URL=                       # Redis para Bull queues
ELEVENLABS_SDR_API_KEY=
ELEVENLABS_SDR_AGENT_ID=
ELEVENLABS_QUALIFICATION_API_KEY=
ELEVENLABS_QUALIFICATION_AGENT_ID=
ELEVENLABS_WEBHOOK_SECRET=
TWENTY_BASE_URL=
TWENTY_API_KEY=
ALLOWED_ORIGINS=                 # CORS origins separados por coma
PORT=3004                        # Puerto del servidor
```

## Comandos

```bash
npm run dev            # Desarrollo con nodemon (puerto 3004)
npm start              # Producción
npm run start:workers  # Iniciar workers de colas
npm run build          # Genera Prisma clients (principal + geo)
npm run db:generate    # Regenera Prisma clients
npm run db:migrate:dev # Crear nueva migración
npm run db:migrate     # Aplicar migraciones pendientes
npm run db:push        # Push schema sin migración
npm run db:studio      # Prisma Studio (UI visual de BD)
npm run db:seed        # Ejecutar seeds
npm run seed:emails    # Seed de email templates
npm run redis:check    # Verificar conexión Redis
```

## Endpoints principales

Base: `/api/v1/`

| Prefijo | Auth | Descripción |
|---------|------|-------------|
| `/auth` | Público | Login, registro, verificación |
| `/partners` | JWT | CRUD partners |
| `/leads` | JWT | CRUD leads |
| `/campaigns` | JWT | CRUD campañas, dispatch, webhooks |
| `/geo` | JWT/API Key | Queries geográficas, conteos |
| `/coupons` | JWT/API Key | Generación, redención |
| `/coupon-templates` | JWT | CRUD templates de cupones |
| `/settings` | JWT | Configuración del sistema |
| `/sdr` | JWT/API Key | Gestión llamadas SDR |
| `/qualification` | JWT/API Key | Gestión calificación |
| `/events` | JWT | SSE para real-time |
| `/easyorder` | API Key | Integración con app principal EasyOrder |
| `/mcp/*` | API Key | Servidores MCP para agentes |

## Reglas de desarrollo (OBLIGATORIAS)

### Estilo de código
- **NUNCA usar emojis en código, logs, mensajes de error ni comentarios de código.** Los emojis solo están permitidos en documentación (.md) y en mensajes de chat.
- **Comentarios**: Siempre incluir comentarios concisos y útiles. NO párrafos largos. Explicar el "por qué", no el "qué". Que otro desarrollador o IA pueda entender el código rápidamente.
- **Logs**: Usar formato estructurado con contexto: `logger.info("[Servicio:Función] descripción", { datos })`. Sin emojis.

### Escalabilidad
- Diseñar pensando en crecimiento. No limitar implementaciones al mínimo funcional solo por velocidad.
- Cuando se agreguen features o modificaciones importantes, considerar: ¿qué pasa si hay 10x más datos? ¿Si se agrega un 5to agente? ¿Si hay más tipos de campaña?
- Preferir patrones extensibles (mapas de configuración, factories) sobre switches/ifs hardcodeados cuando sea razonable.
- Separar lógica de negocio de lógica de transporte (HTTP, WebSocket). Los services no deben conocer req/res.

### Seguridad
- **NUNCA hardcodear credenciales, API keys, secrets o tokens** en el código. Siempre usar variables de entorno via `config/env.js`.
- Validar TODA entrada del usuario (body, params, query) con Zod o validaciones explícitas antes de procesar.
- Sanitizar datos antes de queries. Prisma ya previene SQL injection, pero validar tipos igualmente.
- Usar `authenticateJWT` o `authenticateApiKey` en TODAS las rutas. Ninguna ruta con datos sensibles debe ser pública.
- No exponer stack traces, detalles internos o rutas de archivos en respuestas de error a producción.
- Revisar que los endpoints respeten autorización (un partner no puede ver datos de otro partner).

### Mejores prácticas
- Manejar errores explícitamente. No dejar promesas sin catch. Usar try/catch en operaciones async.
- No duplicar lógica. Si algo se repite 2+ veces, extraer a función o servicio.
- Nombrar variables y funciones de forma descriptiva. Evitar nombres genéricos como `data`, `result`, `temp`.
- Al modificar un servicio existente, respetar el patrón y estilo del archivo. No mezclar estilos.
- Preferir composición sobre herencia. Funciones pequeñas y enfocadas.

## Notas para desarrollo

- Al modificar `schema.prisma` o `schema-geo.prisma`, SIEMPRE ejecutar `npm run db:generate` para regenerar los clients.
- La BD geo es de SOLO LECTURA. NUNCA escribir en ella desde este servicio.
- Los workers corren en proceso separado (`npm run start:workers`). En dev se auto-inician con `app.js`.
- Bull Dashboard disponible en `/admin/queues` para monitorear colas.
- Los webhooks de ElevenLabs llegan a `/api/v1/campaigns/elevenlabs-webhook`.
- Socket.io se usa para notificar al frontend cambios en enrichment en tiempo real.
