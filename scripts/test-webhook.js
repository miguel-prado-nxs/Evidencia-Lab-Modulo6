#!/usr/bin/env node

/**
 * Test script to simulate ElevenLabs webhook calls
 * This helps debug webhook processing issues
 */

const crypto = require("crypto");
const axios = require("axios");

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET ||
    "wsec_6e45da7186b3553b603fb8006caf88a597ed98bc6822ed26c8fdc6493a9e7feb";

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:3004/api/v1/campaigns/elevenlabs-webhook";

const computeSignature = (timestamp, body, secret) => {
    const message = `${timestamp}.${body}`;
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
};

const sendWebhookTest = async (testName, payload) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyString = JSON.stringify(payload);
    const signatureV0 = computeSignature(timestamp, bodyString, WEBHOOK_SECRET);
    const signatureHeader = `t=${timestamp},v0=${signatureV0}`;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`TEST: ${testName}`);
    console.log(`${"=".repeat(60)}`);
    console.log("Payload:", JSON.stringify(payload, null, 2));
    console.log("Signature Header:", signatureHeader);
    console.log("URL:", WEBHOOK_URL);

    try {
        const response = await axios.post(WEBHOOK_URL, payload, {
            headers: {
                "elevenlabs-signature": signatureHeader,
                "Content-Type": "application/json",
            },
            validateStatus: () => true, // Accept all status codes
        });

        console.log("Response Status:", response.status);
        console.log("Response Body:", response.data);
    } catch (error) {
        console.error("Error:", error.message);
    }
};

const runTests = async () => {
    // Test 1: Basic webhook with campaignContactId in dynamic_variables
    await sendWebhookTest("Webhook with campaignContactId in dynamic_variables", {
        type: "post_call_transcription",
        data: {
            conversation_id: "conv_test_123",
            custom_llm_data: {
                campaignContactId: "contact_123",
                campaignId: "campaign_456",
            },
            analysis: {
                call_successful: true,
                transcript_summary: "Test call completed successfully",
            },
            metadata: {
                call_duration_secs: 120,
            },
        },
    });

    // Test 2: Webhook with campaignContactId in conversation_initiation_client_data
    await sendWebhookTest("Webhook with campaignContactId in conversation_initiation_client_data", {
        type: "post_call_transcription",
        data: {
            conversation_id: "conv_test_124",
            conversation_initiation_client_data: {
                dynamic_variables: {
                    campaignContactId: "contact_124",
                    campaignId: "campaign_456",
                },
            },
            analysis: {
                call_successful: false,
                failure_reason: "Call was rejected",
                transcript_summary: "Prospect rejected the call",
            },
            metadata: {
                call_duration_secs: 10,
            },
        },
    });

    // Test 3: Webhook with call_ended event type
    await sendWebhookTest("Webhook with call_ended event type", {
        type: "call_ended",
        data: {
            conversation_id: "conv_test_125",
            dynamic_variables: {
                campaignContactId: "contact_125",
            },
            analysis: {
                call_successful: true,
            },
        },
    });

    // Test 4: Missing campaignContactId (should be rejected gracefully)
    await sendWebhookTest("Webhook without campaignContactId", {
        type: "post_call_transcription",
        data: {
            conversation_id: "conv_test_126",
            analysis: {
                call_successful: true,
            },
        },
    });

    // Test 5: Test with string "true" for call_successful
    await sendWebhookTest("Webhook with string call_successful", {
        type: "post_call_transcription",
        data: {
            conversation_id: "conv_test_127",
            custom_llm_data: {
                campaignContactId: "contact_127",
            },
            analysis: {
                call_successful: "true",
                transcript_summary: "String boolean test",
            },
        },
    });

    console.log("\n" + "=".repeat(60));
    console.log("All tests completed!");
    console.log("=".repeat(60));
};

runTests().catch(console.error);
