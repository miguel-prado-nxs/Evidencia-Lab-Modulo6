-- Script para actualizar templates de cupones con URLs de imágenes
-- Ejecutar este script después de subir las imágenes a tu CDN

-- Ejemplo con imagen de prueba (Picsum Photos - servicio de imágenes placeholder)
-- Reemplaza estas URLs con las URLs reales de tu CDN en producción

-- PLUS30 - 1 mes gratis Plan Plus
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=1'
WHERE coupon_type = 'PLUS30';

-- 50OFF - 50% descuento primer mes
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=2'
WHERE coupon_type = '50OFF';

-- UPGRADEPRO - Upgrade a Pro
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=3'
WHERE coupon_type = 'UPGRADEPRO';

-- TRIAL14 - +14 días de prueba
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=4'
WHERE coupon_type = 'TRIAL14';

-- REFER - Cupón Referidos
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=5'
WHERE coupon_type = 'REFER';

-- COMEBACK - Recuperación Lead
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=6'
WHERE coupon_type = 'COMEBACK';

-- Verificar los cambios
SELECT 
    coupon_type,
    name,
    CASE 
        WHEN media_url IS NOT NULL THEN '✅ Tiene imagen'
        ELSE '❌ Sin imagen'
    END as estado_imagen,
    media_url
FROM coupon_templates
WHERE active = true
ORDER BY priority DESC;

-- NOTA: En producción, usa URLs reales de tu CDN
-- Ejemplos de CDNs populares:
-- - AWS S3: https://tu-bucket.s3.amazonaws.com/coupons/plus30.png
-- - Cloudinary: https://res.cloudinary.com/tu-cloud/image/upload/v1/coupons/plus30.png
-- - Imgix: https://tu-dominio.imgix.net/coupons/plus30.png
