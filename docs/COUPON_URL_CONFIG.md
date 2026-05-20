# Configuración de URLs de Cupones

## Cambios realizados

El sistema ahora construye dinámicamente los URLs de activación de cupones en lugar de tenerlos hardcodeados en los templates.

### Antes
```
https://easyorder.mx/activate?code={{codigo}}
```

### Después
```
https://admin.easyorder.mx/active-code?coupon={{codigo}}&plan={{plan}}
```

El plan se resuelve automáticamente desde el `stripe_product_id[0]` del template usando un mapa configurado.

## Variables de entorno requeridas

Agrega estas variables a tu `.env` o `.env.local`:

```env
# URLs de activación de cupones
COUPON_ACTIVATION_BASE_URL=https://admin.easyorder.mx
COUPON_ACTIVATION_PATH=/active-code

# IDs de productos Stripe (mapeo a planes)
STRIPE_PRODUCT_ID_PLUS=prod_xxxxx_plus
STRIPE_PRODUCT_ID_PRO=prod_xxxxx_pro
```

## Cómo funciona

1. **Cuando se genera un cupón**, `couponGeneratorService.js`:
   - Obtiene el template del cupón
   - Lee `stripe_product_id[0]` del template
   - Busca el plan slug en el mapa configurado (por defecto "plus")
   - Construye el URL completo usando:
     - Base URL: `https://admin.easyorder.mx`
     - Path: `/active-code`
     - Parámetros: `coupon=EASY-PLUS30-A3F2&plan=plus`

2. **El URL se inyecta en el mensaje** como variable `{{couponLink}}`

3. **El usuario recibe** el WhatsApp con el link listo para usar

## Actualizar los templates

Para aplicar los cambios a los templates existentes, ejecuta el seed:

```bash
npm run db:seed:emails
# o
npm run db:seed
```

Esto actualiza todos los templates para usar `{{couponLink}}` dinámicamente.

## Ejemplo completo

Template en BD:
```
Código: {{codigo}}
Actívalo aquí: {{couponLink}}
```

Cuando se genera un cupón EASY-PLUS30:
```
Código: EASY-PLUS30-A3F2
Actívalo aquí: https://admin.easyorder.mx/active-code?coupon=EASY-PLUS30-A3F2&plan=plus
```

## Notas técnicas

- Si un template no tiene `stripe_product_id` configurado, se usa por defecto "plus"
- El mapa es flexible y puede extenderse fácilmente agregando más variables de entorno
- Los URLs se construyen en tiempo de ejecución, no en el seed
- Los templates se actualizan una sola vez en BD; los URLs se generan dinámicamente
