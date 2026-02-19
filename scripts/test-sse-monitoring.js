#!/usr/bin/env node

/**
 * Script de prueba para endpoints de Monitoreo en Tiempo Real SSE
 * 
 * Uso:
 *   node test-sse-monitoring.js [test-id]
 * 
 * Si se proporciona test-id, monitorea ese test específico.
 * De lo contrario, monitorea las estadísticas globales de colas.
 * 
 * Requisitos:
 *   - Servidor API corriendo (default: http://localhost:3001)
 *   - Test A/B activo (para monitoreo específico de test)
 */

const http = require('http');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const testId = process.argv[2];

// Colores para salida de consola
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(color, prefix, message) {
  const timestamp = new Date().toISOString();
  console.log(`${colors[color]}[${timestamp}] [${prefix}]${colors.reset} ${message}`);
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function testSSE(endpoint, testName) {
  log('blue', 'INFO', `Iniciando prueba SSE: ${testName}`);
  log('cyan', 'INFO', `Endpoint: ${endpoint}`);
  
  const url = new URL(endpoint, API_BASE_URL);
  let totalBytesReceived = 0;
  let updateCount = 0;
  const startTime = Date.now();
  
  const req = http.request({
    hostname: url.hostname,
    port: url.port || 3001,
    path: url.pathname,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  }, (res) => {
    log('green', 'CONNECTED', `Status: ${res.statusCode}, Content-Type: ${res.headers['content-type']}`);
    
    if (res.statusCode !== 200) {
      log('red', 'ERROR', `Código de estado inesperado: ${res.statusCode}`);
      res.on('data', (chunk) => {
        console.log(chunk.toString());
      });
      return;
    }
    
    let buffer = '';
    
    res.on('data', (chunk) => {
      totalBytesReceived += chunk.length;
      buffer += chunk.toString();
      
      // Procesar mensajes SSE completos
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Mantener mensaje incompleto en buffer
      
      lines.forEach(message => {
        if (!message.trim()) return;
        
        const eventMatch = message.match(/^event: (.+)/m);
        const dataMatch = message.match(/^data: (.+)/ms);
        
        if (eventMatch && dataMatch) {
          const eventType = eventMatch[1];
          const eventData = dataMatch[1];
          
          if (eventType === 'connected') {
            const data = JSON.parse(eventData);
            log('green', 'EVENT', `Conectado - ID: ${data.connectionId}`);
          } else if (eventType === 'update') {
            updateCount++;
            const data = JSON.parse(eventData);
            
            log('yellow', 'UPDATE', `#${updateCount} - Timestamp: ${data.timestamp}`);
            
            if (data.queues) {
              const q = data.queues.total;
              console.log(`  Estadísticas de Cola: Activos=${q.active}, Esperando=${q.waiting}, Completados=${q.completed}, Fallidos=${q.failed}`);
            }
            
            if (data.test) {
              const t = data.test;
              console.log(`  Test: ${t.testName} (${t.status})`);
              console.log(`  Progreso General: ${t.overall.overallProgress}% (${t.overall.totalProcessed}/${t.overall.totalContacts})`);
              
              t.variants.forEach((v, i) => {
                console.log(`  Variante ${i + 1}: ${v.variantName} - ${v.progressPercentage}% completado, ${v.successRate}% éxito`);
              });
            }
            
            console.log(`  Datos recibidos: ${formatBytes(totalBytesReceived)} total, ${updateCount} actualizaciones`);
          } else if (eventType === 'complete') {
            const data = JSON.parse(eventData);
            log('green', 'COMPLETE', `Test ${data.testId} completado`);
            log('bright', 'STATS', `Actualizaciones totales: ${updateCount}, Datos: ${formatBytes(totalBytesReceived)}, Duración: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
            req.abort();
          } else if (eventType === 'error') {
            const data = JSON.parse(eventData);
            log('red', 'ERROR', `${data.error} - ${data.message || ''}`);
            req.abort();
          }
        } else if (message.startsWith(':')) {
          // Comentario keepalive
          log('cyan', 'KEEPALIVE', 'Ping keepalive del servidor recibido');
        }
      });
    });
    
    res.on('end', () => {
      log('yellow', 'DISCONNECTED', 'Stream finalizado por el servidor');
      log('bright', 'STATS', `Actualizaciones totales: ${updateCount}, Datos: ${formatBytes(totalBytesReceived)}, Duración: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    });
  });
  
  req.on('error', (err) => {
    log('red', 'ERROR', `Solicitud fallida: ${err.message}`);
  });
  
  // Manejar Ctrl+C de manera elegante
  process.on('SIGINT', () => {
    log('yellow', 'INTERRUPT', 'Cerrando conexión...');
    log('bright', 'STATS', `Actualizaciones totales: ${updateCount}, Datos: ${formatBytes(totalBytesReceived)}, Duración: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    req.abort();
    process.exit(0);
  });
  
  req.end();
}

// Ejecución principal
console.log(`${colors.bright}=== Prueba de Monitoreo en Tiempo Real SSE ===${colors.reset}\n`);

if (testId) {
  testSSE(`/api/v1/ab-tests/${testId}/monitor-stream`, `Monitoreo específico de test (${testId})`);
} else {
  log('yellow', 'INFO', 'No se proporcionó ID de test, monitoreando colas globales');
  log('cyan', 'TIP', 'Uso: node test-sse-monitoring.js [test-id]');
  console.log('');
  testSSE('/api/v1/ab-tests/queues/monitor-stream', 'Monitoreo global de colas');
}
