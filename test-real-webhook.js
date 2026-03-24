#!/usr/bin/env node

/**
 * Test webhook con ID real de contacto
 */

const crypto = require("crypto");
const axios = require("axios");
const prisma = require("./src/config/database");

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET ||
    "wsec_6e45da7186b3553b603fb8006caf88a597ed98bc6822ed26c8fdc6493a9e7feb";

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:3004/api/v1/campaigns/elevenlabs-webhook";

const computeSignature = (timestamp, body, secret) => {
    const message = `${timestamp}.${body}`;
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
};

async function testWithRealContact(contactId) {
    try {
        // Primero verificar que el contacto existe
        console.log(`\n📋 Verificando contacto ${contactId} en BD...`);
        const contact = await prisma.campaignContact.findUnique({
            where: { id: contactId },
            select: {
                id: true,
                campaignId: true,
                status: true,
                conversationId: true,
                establishmentName: true,
                establishmentPhone: true,
            },
        });

        if (!contact) {
            console.error(`❌ Contacto ${contactId} no encontrado en BD`);
            process.exit(1);
        }

        console.log(`✅ Contacto encontrado:`);
        console.log(`   ID: ${contact.id}`);
        console.log(`   Campaign: ${contact.campaignId}`);
        console.log(`   Status: ${contact.status}`);
        console.log(`   ConversationID: ${contact.conversationId || "null"}`);
        console.log(`   Establishment: ${contact.establishmentName}`);

        // Crear payload de webhook simulando ElevenLabs
        const conversationId = `conv_real_${Date.now()}`;

        const payload = {
            type: "post_call_transcription",
            data: {
                conversation_id: conversationId,
                custom_llm_data: {
                    campaignContactId: contact.id,
                    campaignId: contact.campaignId,
                },
                analysis: {
                    call_successful: true,
                    transcript_summary: "Real webhook test - llamada completada",
                },
                metadata: {
                    call_duration_secs: 180,
                },
            },
        };

        // Generar firma
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyString = JSON.stringify(payload);
        const signatureV0 = computeSignature(timestamp, bodyString, WEBHOOK_SECRET);
        const signatureHeader = `t=${timestamp},v0=${signatureV0}`;

        console.log(`\n📤 Enviando webhook a ${WEBHOOK_URL}...`);
        console.log(`   ConversationID: ${conversationId}`);
        console.log(`   ContactID: ${contact.id}`);

        const response = await axios.post(WEBHOOK_URL, payload, {
            headers: {
                "elevenlabs-signature": signatureHeader,
                "Content-Type": "application/json",
            },
            validateStatus: () => true,
        });

        console.log(`\n📥 Respuesta del servidor:`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Body: ${JSON.stringify(response.data, null, 2)}`);

        // Verificar estado después del webhook
        console.log(`\n🔍 Verificando estado del contacto después del webhook...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo

        const updatedContact = await prisma.campaignContact.findUnique({
            where: { id: contactId },
            select: {
                id: true,
                status: true,
                conversationId: true,
                webhookReceivedAt: true,
                callTranscript: true,
            },
        });

        console.log(`✅ Estado actualizado:`);
        console.log(`   Status: ${updatedContact.status} (antes: ${contact.status})`);
        console.log(`   ConversationID: ${updatedContact.conversationId}`);
        console.log(`   WebhookReceivedAt: ${updatedContact.webhookReceivedAt}`);
        console.log(`   CallTranscript: ${updatedContact.callTranscript}`);

        if (updatedContact.status === "CALLED") {
            console.log(`\n✅ ¡ÉXITO! El contacto se actualizó de ${contact.status} a CALLED`);
        } else if (updatedContact.status === contact.status) {
            console.log(`\n❌ El contacto NO se actualizó. Sigue en ${contact.status}`);
        }

    } catch (error) {
        console.error("Error:", error.message);
        if (error.response?.data) {
            console.error("Response:", error.response.data);
        }
    } finally {
        await prisma.$disconnect();
    }
}

// Obtener ID del argumento o usar el que pasó el usuario
const contactId = process.argv[2] || "3f016d36-52e8-4ea1-9b11-8619c58bd86f";
testWithRealContact(contactId);
