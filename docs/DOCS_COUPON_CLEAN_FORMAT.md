# Documentación: Refactor de Formato Limpio para Cupones (Marzo 2026)

## 🎯 Objetivo de la Actualización
Simplificar visualmente los códigos de los cupones que se envían por WhatsApp (ej. de `EASY-PLUS30-98CE` a simplemente `EASY-PLUS30`), mientras se mantiene el registro individual y la trazabilidad de qué lead o prospecto activó cada cupón utilizando identificadores internos (UUIDs).

## 🗃️ Cambios en Base de Datos (Migración Prisma)
Se ejecutó una migración sobre `schema.prisma` (`npx prisma db push`):

1. **Remoción de Restricción Única (`@unique`) en `code`**: 
   - **Antes**: `code String @unique`. Esto obligaba al sistema a generar sufijos aleatorios para que ningún código colisionara.
   - **Ahora**: `code String`. El sistema permite que miles de registros compartan el código `EASY-PLUS30`.
2. **Restauración de Enum `PAUSED`**:
   - Se aseguró que `PAUSED` permanezca en `ContactStatus` para asegurar la estabilidad de la data histórica de contactos pausados.

*La trazabilidad analítica de conversión individual ahora se realiza a través de la relación de `id` del registro del cupón, el `assignedPhone`, y el `campaignContactId` en lugar de requerir que el texto de visualización sea estricto.*

## ⚙️ Cambios en la Lógica de Aplicación

**1. Generación de Cupones (`src/services/couponGeneratorService.js`)**
- Se eliminó el `while` loop que validaba e incrementaba la variable para asegurar la unicidad (uniqueness) en base de datos.
- El valor asinado a `code` ahora es estático basado estrictamente en la campaña:
  ```javascript
  const code = `EASY-${template.couponType}`;  // Resultado: EASY-PLUS30, EASY-50OFF
  ```
- Al renderizar el mensaje para WhatsApp, se expuso la variable `couponId` para utilizarla en links de seguimiento en lugar del texto del código visual.

**2. Formateo de Mensajes WhatsApp (`src/services/couponWhatsappService.js`)**
- La función de renderizado `message.replace(/{{codigo}}/g, coupon.code)` se mantiene utilizando `code` ya que este ahora es "limpio" desde el punto de la generación.
- Modificación directa en los templates de base de datos para utilizar de forma estándar:
  `Actívalo aquí: https://easyorder.mx/activate?code={{codigo}}`

## 🔒 Contratos de Integración Intactos
Los endpoints externos **no requirieron ninguna modificación**, al igual que las directrices para herramientas de inteligencia artificial como ElevenLabs:
- `POST /api/v1/coupons-whatsapp/generate-and-send`
- Solo depende del campo `couponType` que ahora se define a nivel campaña, manteniendo `scenario` solo para fines informativos guardados en base de datos.

## 🧪 Testing y Casos de Uso
1. **Verificación Directa**: Se ejecutó prueba a WhatsApp validando todos los templates de sistema simultáneamente (`TRIAL14`, `UPGRADEPRO`, `REFER`, `COMEBACK`, `PLUS30`, `50OFF`).
2. **Click-Through HTTP**: Los formatos ahora contienen la separación de líneas adecuada para asegurar que la App de WhatsApp nativa e iOS conviertan los hipervínculos correctamente asegurando alta tasa de click.
