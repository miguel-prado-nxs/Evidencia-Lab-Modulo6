# EasyOrder Partners API

Backend API para el sistema de partners de EasyOrder. Este proyecto gestiona campañas de marketing, generación de cupones, integración con WhatsApp (Baileys) y automatización de llamadas con ElevenLabs.

## 🚀 Estructura del Proyecto

- `src/`: Código fuente de la aplicación (Express.js).
  - `controllers/`: Lógica de manejo de peticiones.
  - `services/`: Lógica de negocio y servicios externos (WhatsApp, ElevenLabs, etc.).
  - `routes/`: Definición de endpoints.
  - `middleware/`: Validaciones y seguridad.
- `prisma/`: Esquemas de base de datos y migraciones (PostgreSQL).
- `docs/`: Documentación detallada del sistema (Cupones, Webhooks, Integraciones).
- `scripts/`: Utilidades y herramientas de diagnóstico.
- `tests/`: Pruebas de integración y unitarias.

## 🛠️ Tecnologías Principales

- **Runtime**: Node.js
- **Framework**: Express.js
- **ORM**: Prisma
- **Base de Datos**: PostgreSQL
- **Mensajería**: WhatsApp (Baileys API)
- **Voz**: ElevenLabs ConvAI
- **Cola de Procesos**: Bull / Redis

## 📖 Documentación

Para más detalles, consulta la carpeta `docs/`:
- [Sistema de Cupones](docs/COUPONS_SYSTEM.md)
- [Integración WhatsApp](docs/COUPON_WHATSAPP_INTEGRATION.md)
- [Configuración de Webhooks](docs/ELEVENLABS_WEBHOOK_CONFIG.md)
- [Sincronización con CRM (Twenty)](docs/TWENTY_SYNC.md)

## 🛠️ Ejecución Local

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Configurar el archivo `.env` (basado en `.env.example`).
3. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```

---
© 2026 EasyOrder. Todos los derechos reservados.
