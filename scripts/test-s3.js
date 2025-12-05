/**
 * Script para probar la conexión con Railway Storage (S3)
 */

require("dotenv").config();

const { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const config = {
  endpoint: process.env.S3_ENDPOINT || "https://storage.railway.app",
  region: process.env.S3_REGION || "auto",
  bucket: process.env.S3_BUCKET || "bucket-recursos-partners-xujxon",
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
};

console.log("\n🔧 Railway Storage (S3) Connection Test\n");
console.log("=".repeat(50));
console.log(`Endpoint: ${config.endpoint}`);
console.log(`Region: ${config.region}`);
console.log(`Bucket: ${config.bucket}`);
console.log(`Access Key ID: ${config.accessKeyId ? config.accessKeyId.substring(0, 10) + "..." : "NOT SET"}`);
console.log(`Secret Key: ${config.secretAccessKey ? "***" + config.secretAccessKey.slice(-5) : "NOT SET"}`);
console.log("=".repeat(50));

if (!config.accessKeyId || !config.secretAccessKey) {
  console.error("\n❌ Error: S3 credentials not configured in environment variables");
  process.exit(1);
}

const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
  forcePathStyle: true,
});

async function runTests() {
  try {
    // Test 1: Check bucket exists
    console.log("\n📦 Test 1: Verificando acceso al bucket...");
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    console.log("   ✅ Bucket accesible");

    // Test 2: List objects
    console.log("\n📋 Test 2: Listando objetos en el bucket...");
    const listResult = await client.send(new ListObjectsV2Command({ 
      Bucket: config.bucket,
      MaxKeys: 5,
    }));
    console.log(`   ✅ Encontrados ${listResult.KeyCount || 0} objetos`);
    if (listResult.Contents && listResult.Contents.length > 0) {
      listResult.Contents.forEach((obj) => {
        console.log(`      - ${obj.Key} (${Math.round(obj.Size / 1024)}KB)`);
      });
    }

    // Test 3: Upload test file
    console.log("\n📤 Test 3: Subiendo archivo de prueba...");
    const testKey = `test/test-${Date.now()}.txt`;
    const testContent = `Test file created at ${new Date().toISOString()}`;
    
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
      Body: testContent,
      ContentType: "text/plain",
    }));
    console.log(`   ✅ Archivo subido: ${testKey}`);

    // Test 4: Download test file
    console.log("\n📥 Test 4: Descargando archivo de prueba...");
    const getResult = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
    }));
    
    const downloadedContent = await getResult.Body.transformToString();
    if (downloadedContent === testContent) {
      console.log("   ✅ Contenido verificado correctamente");
    } else {
      console.log("   ⚠️ El contenido no coincide");
    }

    // Test 5: Delete test file
    console.log("\n🗑️ Test 5: Eliminando archivo de prueba...");
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
    }));
    console.log("   ✅ Archivo eliminado");

    // Success
    console.log("\n" + "=".repeat(50));
    console.log("🎉 Todas las pruebas pasaron exitosamente!");
    console.log("=".repeat(50));
    console.log("\nURL base de archivos:");
    console.log(`${config.endpoint}/${config.bucket}/`);
    console.log("\n");

  } catch (error) {
    console.error("\n❌ Error durante las pruebas:");
    console.error(`   ${error.name}: ${error.message}`);
    
    if (error.name === "AccessDenied") {
      console.error("\n💡 Verifica que las credenciales tengan permisos correctos");
    } else if (error.name === "NoSuchBucket") {
      console.error("\n💡 El bucket no existe. Verifica el nombre del bucket.");
    } else if (error.name === "InvalidAccessKeyId") {
      console.error("\n💡 El Access Key ID es inválido.");
    } else if (error.name === "SignatureDoesNotMatch") {
      console.error("\n💡 El Secret Access Key es incorrecto.");
    }
    
    process.exit(1);
  }
}

runTests();

