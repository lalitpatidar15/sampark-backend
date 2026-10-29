import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config";
import { childLogger } from "../../common/logger";
import type { PaymentProvider, CreatePaymentOrderInput } from "../types";

const log = childLogger("provider:razorpay");

/**
 * Razorpay adapter for the store/tag-sales revenue model.
 *
 * All calls are server-side. The Razorpay key secret and webhook secret are
 * never exposed to the frontend. The frontend only ever sees the public key
 * id (returned alongside a created order) to initialise Razorpay Checkout.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay";

  async createOrder(input: CreatePaymentOrderInput): Promise<{
    providerOrderId: string;
    amount: number;
    currency: string;
  }> {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(
          `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
        ).toString("base64")}`,
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

    const data = (await res.json()) as { id: string; amount: number; currency: string };
    return {
      providerOrderId: data.id,
      amount: data.amount,
      currency: data.currency,
    };
  }

  /**
   * Verify a Razorpay webhook signature over the raw request body.
   */
  verifySignature(input: Record<string, string>, signature: string): boolean {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return false;
    const expected = createHmac("sha256", secret)
      .update(JSON.stringify(input))
      .digest("hex");
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async refund(
    providerPaymentId: string,
    amount?: number,
  ): Promise<{ refundId: string }> {
    const body: { amount?: number; notes?: Record<string, string> } = {};
    if (amount) body.amount = amount;

    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${providerPaymentId}/refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
          ).toString("base64")}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      log.error({ status: res.status, body: text }, "razorpay refund failed");
      throw new Error(`Razorpay refund failed: ${res.status}`);
    }

    const data = (await res.json()) as { id: string };
    return { refundId: data.id };
  }
}

export const razorpayProvider = new RazorpayProvider();
