"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayProvider = exports.RazorpayProvider = void 0;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../config");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("provider:razorpay");
/**
 * Razorpay adapter for the store/tag-sales revenue model.
 *
 * All calls are server-side. The Razorpay key secret and webhook secret are
 * never exposed to the frontend. The frontend only ever sees the public key
 * id (returned alongside a created order) to initialise Razorpay Checkout.
 */
class RazorpayProvider {
    name = "razorpay";
    async createOrder(input) {
        const res = await fetch("https://api.razorpay.com/v1/orders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${Buffer.from(`${config_1.env.RAZORPAY_KEY_ID}:${config_1.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
            },
            body: JSON.stringify({
                amount: input.amount,
                currency: input.currency,
                receipt: input.receipt,
                notes: input.notes,
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            log.error({ status: res.status, body: text }, "razorpay order creation failed");
            throw new Error(`Razorpay order creation failed: ${res.status}`);
        }
        const data = (await res.json());
        return {
            providerOrderId: data.id,
            amount: data.amount,
            currency: data.currency,
        };
    }
    /**
     * Verify a Razorpay webhook signature over the raw request body.
     */
    verifySignature(input, signature) {
        const secret = config_1.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret)
            return false;
        const expected = (0, node_crypto_1.createHmac)("sha256", secret)
            .update(JSON.stringify(input))
            .digest("hex");
        return (0, node_crypto_1.timingSafeEqual)(Buffer.from(expected), Buffer.from(signature));
    }
    async refund(providerPaymentId, amount) {
        const body = {};
        if (amount)
            body.amount = amount;
        const res = await fetch(`https://api.razorpay.com/v1/payments/${providerPaymentId}/refund`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${Buffer.from(`${config_1.env.RAZORPAY_KEY_ID}:${config_1.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            log.error({ status: res.status, body: text }, "razorpay refund failed");
            throw new Error(`Razorpay refund failed: ${res.status}`);
        }
        const data = (await res.json());
        return { refundId: data.id };
    }
}
exports.RazorpayProvider = RazorpayProvider;
exports.razorpayProvider = new RazorpayProvider();
//# sourceMappingURL=razorpay.adapter.js.map