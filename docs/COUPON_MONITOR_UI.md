# Monitor de Cupones en Tiempo Real - Guía de Uso

## 🎯 Descripción

Monitor web interactivo para visualizar cupones activos con validez temporal y contador en tiempo real. Diseñado con una UI/UX moderna y responsiva.

## 🚀 Acceso

**URL:** `http://localhost:3000/coupon-monitor.html`

**Producción:** `https://partners-api-agentbuilder-dev.up.railway.app/coupon-monitor.html`

## ✨ Características

### 1. **Dashboard de Estadísticas en Tiempo Real**

- **Cupones Activos**: Total de cupones válidos actualmente
- **Por Expirar (<24h)**: Cupones que expiran en menos de 24 horas
- **Críticos (<1h)**: Cupones que expiran en menos de 1 hora
- **Tiempo Promedio**: Promedio de tiempo restante de todos los cupones

### 2. **Tarjetas de Cupones Interactivas**

Cada cupón muestra:
- **Código del cupón** (formato monospace)
- **Estado** (badge colorido: Generado, Enviado, Visitado)
- **Oferta/Descripción**
- **Contador en tiempo real** (actualiza cada segundo)
- **Barra de progreso visual** (verde → amarillo → rojo)
- **Fechas de validez** (desde/hasta)
- **Información adicional** (teléfono asignado, campaña)

### 3. **Filtros Avanzados**

- **Por Campaña**: Filtra cupones de una campaña específica
- **Por Estado**: Generados, Enviados, Visitados
- **Búsqueda**: Busca por código de cupón
- **Actualización manual**: Botón para recargar datos

### 4. **Actualización Automática**

- **Contador**: Se actualiza cada segundo
- **Datos**: Se recargan cada 30 segundos automáticamente
- **Sin recargar página**: Experiencia fluida sin interrupciones

## 🎨 Diseño UI/UX

### Colores y Estados

**Cupones Normales (>24h restantes):**
- Borde superior: Gradiente morado (#667eea → #764ba2)
- Tiempo: Verde (#48bb78)
- Barra de progreso: Verde

**Cupones Por Expirar (<24h):**
- Borde superior: Gradiente naranja (#ed8936 → #f6ad55)
- Tiempo: Naranja (#ed8936)
- Barra de progreso: Naranja

**Cupones Críticos (<1h):**
- Borde superior: Gradiente rojo (#f56565 → #fc8181)
- Tiempo: Rojo parpadeante (#f56565)
- Barra de progreso: Rojo
- Animación de pulso

### Responsive Design

- **Desktop**: Grid de 3-4 columnas
- **Tablet**: Grid de 2 columnas
- **Mobile**: Grid de 1 columna
- Adaptación automática según tamaño de pantalla

## 📊 Formato de Tiempo

El sistema muestra el tiempo restante en formato legible:

| Tiempo Restante | Formato Mostrado |
|----------------|------------------|
| 2 días 5 horas | `2d 5h` |
| 5 horas 30 min | `5h 30m` |
| 30 min 45 seg  | `30m 45s` |
| 45 segundos    | `45s` |
| Expirado       | `Expirado` |

## 🔐 Autenticación

El monitor requiere un token JWT para acceder a la API.

**Configuración:**

1. Obtén un token JWT desde `/api/v1/auth/login`
2. Guárdalo en localStorage:
   ```javascript
   localStorage.setItem('api_token', 'tu-token-jwt-aqui');
   ```
3. Recarga la página del monitor

**Alternativa sin autenticación:**

Para desarrollo local, puedes modificar el endpoint para usar API Key en lugar de JWT.

## 🛠️ Configuración Técnica

### Endpoints Utilizados

**GET** `/api/v1/coupons/active-with-time?campaignId={id}`
- Obtiene cupones activos con tiempo restante calculado
- Requiere: JWT Bearer token
- Respuesta: Array de cupones con campo `validity`

### Estructura de Datos

```javascript
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "WEEKEND50-ABC123",
      "offer": "50% descuento fin de semana",
      "status": "SENT",
      "validFrom": "2026-03-28T17:00:00.000Z",
      "validUntil": "2026-03-30T21:00:00.000Z",
      "assignedPhone": "5218001234567",
      "campaign": {
        "id": "campaign-uuid",
        "name": "Campaña Weekend"
      },
      "validity": {
        "isValid": true,
        "timeRemaining": 172800000,
        "timeRemainingFormatted": "2d 0h",
        "expiresAt": "2026-03-30T21:00:00.000Z"
      }
    }
  ],
  "count": 1,
  "timestamp": "2026-03-28T18:30:00.000Z"
}
```

## 📱 Casos de Uso

### 1. Monitoreo de Campañas Activas

Visualiza en tiempo real todos los cupones de una campaña específica y su estado de validez.

### 2. Alertas de Expiración

Identifica rápidamente cupones que están por expirar para tomar acciones correctivas.

### 3. Análisis de Rendimiento

Observa cuántos cupones están activos, enviados, visitados y su tiempo promedio de validez.

### 4. Gestión de Inventario

Verifica disponibilidad de cupones válidos antes de lanzar nuevas campañas.

## 🔧 Personalización

### Cambiar Intervalo de Actualización

Edita en `coupon-monitor.html`:

```javascript
// Actualizar cada segundo (contador)
updateInterval = setInterval(updateTimeRemaining, 1000);

// Recargar cupones cada 30 segundos (cambiar a 60000 para 1 minuto)
setInterval(loadCoupons, 30000);
```

### Modificar Umbrales de Alerta

```javascript
// En la función renderCouponCard
const hours = Math.floor(timeRemaining / (1000 * 60 * 60));

// Cambiar umbrales (actualmente 1h y 24h)
if (hours < 1) {
    cardClass = 'critical';  // Menos de 1 hora
} else if (hours < 24) {
    cardClass = 'expiring';  // Menos de 24 horas
}
```

### Agregar Filtros Personalizados

Agrega nuevos filtros en la sección `.filters`:

```html
<div class="filter-group">
    <label for="customFilter">Mi Filtro</label>
    <select id="customFilter">
        <option value="">Todos</option>
        <option value="value1">Opción 1</option>
    </select>
</div>
```

## 🐛 Troubleshooting

### Error: "Error al cargar cupones"

**Causa:** Token JWT inválido o expirado

**Solución:**
1. Verifica que el token esté guardado en localStorage
2. Obtén un nuevo token desde `/api/v1/auth/login`
3. Actualiza el token en localStorage

### No se muestran cupones

**Causa:** No hay cupones activos o filtros muy restrictivos

**Solución:**
1. Verifica que existan cupones con `status` GENERATED, SENT o VISITED
2. Limpia los filtros seleccionados
3. Verifica que los cupones tengan `validFrom` y `validUntil` configurados

### El contador no se actualiza

**Causa:** JavaScript deshabilitado o error en consola

**Solución:**
1. Abre la consola del navegador (F12)
2. Busca errores en rojo
3. Verifica que JavaScript esté habilitado

## 📈 Métricas y Analytics

El monitor proporciona métricas en tiempo real:

- **Total de cupones activos**
- **Distribución por tiempo restante**
- **Promedio de validez**
- **Cupones en riesgo de expiración**

Estas métricas se actualizan automáticamente cada segundo.

## 🚀 Próximas Mejoras

- [ ] Notificaciones push cuando cupones están por expirar
- [ ] Exportar datos a CSV/Excel
- [ ] Gráficas de tendencias de expiración
- [ ] Filtros por rango de fechas
- [ ] Modo oscuro
- [ ] Integración con dashboard principal

## 📞 Soporte

Para reportar problemas o sugerencias:
- Crear issue en el repositorio
- Contactar al equipo de desarrollo

---

**Última actualización:** 30 de Marzo, 2026
**Versión:** 1.0.0
