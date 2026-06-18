# Data Model: Mejoras CRM para Marketing

**Feature**: 001-crm-mejoras-marketing | **Date**: 2026-06-18

---

## Cambios al schema Prisma (schema.prisma)

### TwentySyncJob — campos nuevos

```prisma
model TwentySyncJob {
  id              String              @id @default(uuid())
  establishmentId String              @map("establishment_id")
  partnerId       String?             @map("partner_id")
  reason          String

  // NUEVO: tipo de job — PIPELINE (sync de nivel/datos) vs INTERACTION (nota por llamada)
  type            TwentySyncJobType   @default(PIPELINE) @map("type")

  // NUEVO: payload del evento (solo para INTERACTION)
  // { stage, outcome, callSummary, callDuration, campaignId, conversationId, campaignName, eventType }
  payload         Json?               @map("payload")

  // NUEVO: clave de deduplicación para INTERACTION
  // Formato: "interaction:{conversationId}:{stage}" o "coupon:{couponId}:{evento}"
  // @unique garantiza que insertar el mismo evento dos veces lanza P2002 (capturado como skip)
  dedupeKey       String?             @unique @map("dedupe_key")

  // NUEVO: límite de reintentos (null = sin límite para PIPELINE e INTERACTION conversacionales)
  maxAttempts     Int?                @map("max_attempts")

  status          TwentySyncJobStatus @default(PENDING)
  attempts        Int                 @default(0)
  nextRunAt       DateTime            @default(now()) @map("next_run_at")
  lastError       String?             @map("last_error")
  lastErrorAt     DateTime?           @map("last_error_at")
  completedAt     DateTime?           @map("completed_at")
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  // Índice compuesto para el worker: prioriza por type, status y tiempo
  @@index([type, status, nextRunAt])
  @@index([status, nextRunAt])
  @@index([establishmentId])
  @@index([createdAt(sort: Desc)])
  @@map("twenty_sync_jobs")
}
```

### Nuevo enum TwentySyncJobType

```prisma
enum TwentySyncJobType {
  PIPELINE      // Sync de nivel y datos del establecimiento (comportamiento actual)
  INTERACTION   // Nota de interacción por llamada, cupón u otro evento
}
```

### Reglas de negocio de la migración

- Los jobs existentes sin `type` reciben `PIPELINE` como default — **comportamiento actual intacto**.
- La lógica de colapso de jobs (un solo PENDING por establecimiento) aplica **solo a type PIPELINE**.
- Para INTERACTION, se intenta INSERT con el `dedupeKey`. Si viola P2002 (duplicado), se captura como "ya existe, skip".
- `maxAttempts = null` para PIPELINE y INTERACTION conversacional (retry sin límite).
- `maxAttempts = 5` para INTERACTION no conversacional (FAILED/NO_ANSWER/VOICEMAIL, cupones).

---

## Nuevos archivos de servicio

### `twentyActivityService.js` — entidades y contratos internos

#### Función `enqueueInteractionSync`

```javascript
// Parámetros de entrada
{
  establishmentId: String,   // requerido
  conversationId:  String,   // requerido — parte del dedupeKey
  stage:           String,   // 'discovery' | 'qualification' | 'activation' | 'conversion' | 'coupon_sent' | 'coupon_redeemed'
  outcome:         String,   // 'COMPLETED' | 'NO_ANSWER' | 'VOICEMAIL' | 'FAILED' | 'SENT' | 'REDEEMED'
  callSummary:     String?,  // resumen de la conversación (opcional)
  callDuration:    Number?,  // segundos (opcional)
  campaignId:      String?,  // id de la campaña
  campaignName:    String?,  // nombre legible de la campaña
}

// Comportamiento
// 1. Construye dedupeKey: `interaction:${conversationId}:${stage}` (o `coupon:${conversationId}:${stage}`)
// 2. Determina maxAttempts según conversacionalidad del outcome (ver STAGE_CONFIG)
// 3. Crea TwentySyncJob con type=INTERACTION
// 4. Si P2002 (dedupeKey duplicado): log info + return { skipped: true }
// 5. Retorna el job creado o { skipped: true }
```

#### Función `processInteractionJob`

```javascript
// Input: job de tipo TwentySyncJob con type=INTERACTION y payload poblado
// Secuencia de operaciones:
// 1. Resolver twentyEstablecimientoId desde TwentySyncState
//    Si no existe TwentySyncState: ejecutar pipeline sync primero (enqueueSync + esperar o ejecutar sync inline)
// 2. Armar Note según STAGE_CONFIG[stage]:
//    - title: `Llamada ${stageLabel} — ${outcomeLabel} — ${fechaFormateada}`
//    - body: markdown con campaña, etapa, outcome, duración, resumen, conversationId
// 3. createNote(title, body) → noteId
// 4. createNoteTarget(noteId, { companyId: twentyEstablecimientoId })
// 5. Calcular totalLlamadasCampana (COUNT de jobs INTERACTION DONE para establishmentId)
// 6. PATCH Company: ultimaCampana, fechaUltimaLlamada (si más reciente), totalLlamadasCampana
// 7. Marcar job como DONE
```

#### Mapa STAGE_CONFIG

```javascript
const STAGE_CONFIG = {
  discovery: {
    stageLabel: 'Discovery',
    isConversational: (outcome) => outcome === 'COMPLETED',
    outcomeLabels: {
      COMPLETED: 'Contacto realizado',
      NO_ANSWER:  'Sin respuesta',
      VOICEMAIL:  'Buzón de voz',
      FAILED:     'Fallo técnico',
    },
  },
  qualification: {
    stageLabel: 'Qualification',
    isConversational: (outcome) => outcome === 'COMPLETED',
    outcomeLabels: { /* igual que discovery */ },
  },
  activation: {
    stageLabel: 'Activation',
    isConversational: (outcome) => outcome === 'COMPLETED',
    outcomeLabels: { /* igual que discovery */ },
  },
  conversion: {
    stageLabel: 'Conversion',
    isConversational: (outcome) => outcome === 'COMPLETED',
    outcomeLabels: { /* igual que discovery */ },
  },
  coupon_sent: {
    stageLabel: 'Cupón',
    isConversational: () => false,  // best effort siempre
    outcomeLabels: { SENT: 'Cupón enviado por WhatsApp' },
  },
  coupon_redeemed: {
    stageLabel: 'Cupón',
    isConversational: () => false,
    outcomeLabels: { REDEEMED: 'Cupón redimido' },
  },
};
```

---

## Entidades en Twenty CRM (sin migración Prisma)

### Company — campos custom a crear

| Campo API | Tipo | Descripción | Cuándo se actualiza |
|---|---|---|---|
| `ultimaCampana` | Text | Nombre de la última campaña que contactó el establecimiento | Cada job INTERACTION procesado |
| `fechaUltimaLlamada` | DateTime | Timestamp de la llamada más reciente | Solo si más reciente que el valor actual |
| `totalLlamadasCampana` | Number | Total de llamadas de campaña recibidas (todas las etapas) | Recalculado desde COUNT de jobs DONE por establecimiento |

**Prerequisito**: Estos campos deben crearse en la UI admin de Twenty ANTES del deploy del código. Los nombres de API devueltos por Twenty deben documentarse en `research.md` tras CRM-855.

### Note (nativa de Twenty)

| Campo | Tipo | Valor |
|---|---|---|
| `title` | String | `Llamada {Etapa} — {OutcomeLabel} — {DD/MM/YYYY HH:mm}` |
| `body` | String (markdown) | Ver plantilla abajo |
| Anclada a | Company | Vía `noteTargets` con `companyId` |

**Plantilla body markdown**:
```markdown
**Campaña**: {campaignName}
**Etapa**: {stageLabel}
**Resultado**: {outcomeLabel}
**Duración**: {callDuration}s
**Resumen**: {callSummary || 'Sin resumen disponible'}
**ID de conversación**: `{conversationId}`
```

---

## Relaciones entre entidades

```
Establishment (BD geo — solo lectura)
    │ 1:1
    ▼
TwentySyncState
    │ twentyEstablecimientoId
    ▼
Company (Twenty CRM)
    │ companyId via noteTargets
    ▼
Note[] (Twenty CRM — una por llamada/cupón)

TwentySyncJob[] (BD principal)
    ├── type=PIPELINE (1 PENDING por establishment — colapso)
    └── type=INTERACTION (1 por conversationId+stage — único por dedupeKey)
```

---

## Estados del TwentySyncJob (INTERACTION)

```
PENDING → PROCESSING → DONE
                    ↘ FAILED (si attempts >= maxAttempts y maxAttempts != null)
                    ↗ PENDING (si falla pero quedan reintentos, nextRunAt += backoff)
```

- Backoff exponencial: heredado del mecanismo existente en `twentySyncService.js`
- `PIPELINE` sin límite: nunca llega a FAILED por `attempts`
- `INTERACTION` conversacional sin límite: nunca llega a FAILED por `attempts`
- `INTERACTION` no conversacional (maxAttempts=5): llega a FAILED tras 5 intentos
