# Usar Google Drive para Imágenes de Cupones (Testing)

## ✅ Sí funciona, pero con configuración especial

Google Drive puede usarse para pruebas, pero **NO** para producción.

---

## 🔧 Cómo Obtener URL Pública de Google Drive

### Paso 1: Subir la imagen a Google Drive

1. Sube tu imagen a Google Drive
2. Haz clic derecho → "Obtener enlace"
3. Cambia permisos a: **"Cualquier persona con el enlace"**
4. Copia el enlace

### Paso 2: Convertir el enlace a URL directa

**Enlace original de Google Drive:**
```
https://drive.google.com/file/d/1ABC123XYZ456/view?usp=sharing
```

**Convertir a URL directa (formato 1):**
```
https://drive.google.com/uc?export=view&id=1ABC123XYZ456
```

**O formato 2 (más confiable para WhatsApp):**
```
https://lh3.googleusercontent.com/d/1ABC123XYZ456
```

### Paso 3: Actualizar el template

```sql
UPDATE coupon_templates 
SET media_url = 'https://drive.google.com/uc?export=view&id=TU_FILE_ID'
WHERE coupon_type = 'PLUS30';
```

---

## 🧪 Script de Prueba Rápida

```javascript
// test-google-drive-url.js
const axios = require('axios');

async function testGoogleDriveUrl() {
    // Reemplaza con tu ID de archivo
    const fileId = '1ABC123XYZ456';
    const url = `https://drive.google.com/uc?export=view&id=${fileId}`;
    
    console.log('🧪 Probando URL de Google Drive...');
    console.log('URL:', url);
    
    try {
        const response = await axios.head(url, { 
            timeout: 5000,
            maxRedirects: 5 
        });
        
        console.log('✅ URL accesible');
        console.log('Content-Type:', response.headers['content-type']);
        console.log('Content-Length:', response.headers['content-length']);
        
        if (response.headers['content-type']?.startsWith('image/')) {
            console.log('✅ Es una imagen válida');
        } else {
            console.log('⚠️ No es una imagen');
        }
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
}

testGoogleDriveUrl();
```

---

## ⚠️ Limitaciones de Google Drive

### 1. **Límite de Ancho de Banda**
- Google Drive tiene límites de descargas
- Si muchos usuarios reciben el cupón, puede bloquearse temporalmente
- **No apto para producción**

### 2. **Velocidad**
- Más lento que un CDN dedicado
- Puede tener latencia variable

### 3. **Redirecciones**
- Google Drive usa redirecciones
- Baileys debe seguir las redirecciones (ya lo hace por defecto)

### 4. **Cache**
- Google Drive puede cachear versiones antiguas
- Si actualizas la imagen, puede tardar en reflejarse

---

## ✅ Alternativas Mejores para Testing

### 1. **Picsum Photos** (Recomendado para testing)
```sql
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600'
WHERE coupon_type = 'PLUS30';
```
- ✅ Gratis
- ✅ Sin límites
- ✅ URLs directas
- ✅ Imágenes aleatorias

### 2. **Imgur** (Bueno para testing)
```
https://i.imgur.com/XXXXX.png
```
- ✅ Gratis
- ✅ URLs directas
- ✅ Rápido
- ⚠️ Límites de ancho de banda

### 3. **Cloudinary Free Tier** (Mejor para staging)
```
https://res.cloudinary.com/demo/image/upload/sample.jpg
```
- ✅ Gratis hasta 25GB/mes
- ✅ CDN global
- ✅ Optimización automática
- ✅ Apto para staging

---

## 🎯 Recomendación

### Para Testing Rápido (HOY)
```sql
-- Opción 1: Picsum (más fácil)
UPDATE coupon_templates 
SET media_url = 'https://picsum.photos/800/600?random=1'
WHERE coupon_type = 'PLUS30';

-- Opción 2: Google Drive (si ya tienes la imagen)
UPDATE coupon_templates 
SET media_url = 'https://drive.google.com/uc?export=view&id=TU_FILE_ID'
WHERE coupon_type = 'PLUS30';
```

### Para Producción (DESPUÉS)
- **AWS S3** + CloudFront
- **Cloudinary**
- **Imgix**

---

## 📝 Ejemplo Completo con Google Drive

### 1. Sube una imagen a Google Drive
- Nombre: `coupon-plus30.png`
- Tamaño recomendado: 800x600px
- Formato: PNG o JPG

### 2. Obtén el ID del archivo
```
URL original: https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9/view?usp=sharing
ID del archivo: 1a2b3c4d5e6f7g8h9
```

### 3. Actualiza el template
```sql
UPDATE coupon_templates 
SET media_url = 'https://drive.google.com/uc?export=view&id=1a2b3c4d5e6f7g8h9'
WHERE coupon_type = 'PLUS30';
```

### 4. Prueba el envío
```bash
node test-image-coupon.js
```

---

## 🚀 Prueba Inmediata

Ejecuta esto para probar CON Google Drive:

```bash
# 1. Actualiza el template con tu URL de Google Drive
psql -d tu_database -c "UPDATE coupon_templates SET media_url = 'https://drive.google.com/uc?export=view&id=TU_FILE_ID' WHERE coupon_type = 'PLUS30';"

# 2. Verifica
node test-image-coupon.js

# 3. Prueba el envío real desde Postman
```

---

## ✅ Conclusión

**SÍ, Google Drive funciona para testing**, pero:
- ✅ Úsalo para pruebas rápidas
- ✅ Asegúrate de usar el formato `uc?export=view&id=`
- ✅ Configura permisos públicos
- ❌ NO lo uses en producción
- ❌ NO es confiable para alto volumen

**Para testing inmediato, usa Picsum o Google Drive.**
**Para producción, usa un CDN real (S3, Cloudinary, etc.).**
