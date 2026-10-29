/**
 * End-to-end smoke test for the Sampark API.
 *
 * Drives the real product journey against a running server: an owner signs in
 * with an OTP, registers a vehicle and a tag, then an anonymous visitor scans
 * the tag, messages the owner, and raises an emergency. It asserts the privacy
 * guarantees that the whole product depends on, so a regression that exposes
 * owner identity or a real phone number fails here rather than in production.
 *
 * Requires: Postgres, Redis, and a server on API_BASE_URL.
 *   npm run build && npm run dev   # in one shell
 *   npm run test:smoke             # in another
 */

import assert from "node:assert/strict";

const API = process.env.API_BASE_URL ?? "http://localhost:4000/api";

/**
 * Unique per run so repeated runs do not collide on unique keys, and so the
 * 8-per-15-minutes OTP resend throttle (correctly keyed on phone) does not
 * block a second run. Override SMOKE_PHONE to reuse a fixed test account.
 */
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const PHONE = process.env.SMOKE_PHONE ?? `9${Date.now().toString().slice(-9)}`;
const REGISTRATION = `MH12${RUN}`;

interface Result {
  status: number;
  body: Record<string, any>;
}

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<Result> {
  const res = await fetch(API + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const data = (r: Result) => {
  assert.ok(r.body.data, `expected a data payload, got ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const errCode = (r: Result) => r.body.error?.code;

const steps: string[] = [];
let checks = 0;

function check(label: string, fn: () => void): void {
  fn();
  checks += 1;
  steps.push(`  ok  ${label}`);
}

/** Retries the OTP request around the 60s resend throttle. */
async function requestOtp(phone: string, path = "/auth/otp/request", body?: unknown): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const r = await call("POST", path, { body: body ?? { phone, purpose: "LOGIN" } });
    if (r.status === 202) return data(r).devCode as string;
    if (errCode(r) === "RATE_LIMITED") {
      steps.push(`  ..  resend throttled, waiting (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    throw new Error(`OTP request failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  throw new Error("OTP request stayed rate limited");
}

async function main(): Promise<void> {
  // Owner sign-in ------------------------------------------------------------
  const otp = await requestOtp(PHONE);
  const login = await call("POST", "/auth/login", { body: { phone: PHONE, code: otp } });
  const token = data(login).accessToken as string;
  check("owner signs in with an OTP", () => assert.ok(token.length > 20));

  const badOtp = await call("POST", "/auth/login", { body: { phone: PHONE, code: "000000" } });
  check("a wrong OTP is rejected", () => assert.equal(badOtp.status, 400));

  // Assets and tags ----------------------------------------------------------
  const asset = data(
    await call("POST", "/vehicles/assets", { body: { assetType: "VEHICLE", displayName: "Smoke Test Car" }, token }),
  ).id as string;
  check("owner registers a vehicle asset", () => assert.match(asset, /^[0-9a-f-]{36}$/));

  const vehicle = data(
    await call(
      "POST",
      "/vehicles",
      { body: { assetId: asset, registration: REGISTRATION, make: "Hyundai", model: "Creta" }, token },
    ),
  );
  check("owner adds a vehicle and reads its registration back", () =>
    assert.equal(vehicle.registration, REGISTRATION),
  );
  check("the owner only ever sees the last 4 characters in listings", () =>
    assert.equal(vehicle.registrationEnding, REGISTRATION.slice(-4)),
  );

  const tag = data(
    await call("POST", "/tags", { body: { tagType: "VEHICLE", assetId: asset, label: "Smoke" }, token }),
  );
  const tagId = tag.tagId as string;
  const publicToken = tag.publicToken as string;
  check("owner creates a tag and receives an opaque public token", () => {
    assert.ok(publicToken.length > 16);
    assert.ok(!publicToken.includes(tagId), "the public token must not embed the tag id");
  });

  const activated = data(await call("POST", `/tags/${tagId}/activate`, { body: {}, token }));
  check("the tag activates", () => assert.equal(activated.status, "ACTIVE"));

  // Public scan --------------------------------------------------------------
  const scan = data(await call("GET", `/s/tags/${publicToken}`));
  const session = scan.session.sessionToken as string;

  check("an anonymous visitor can scan without an account or an app", () => {
    assert.match(scan.session.id, /^scn_/);
    assert.ok((session as string).length >= 32, "the bearer session token must be long and unguessable");
  });
  check("the scan exposes only the last 4 registration characters", () =>
    assert.equal(scan.view.display.registrationEnding, REGISTRATION.slice(-4)),
  );
  check("the scan never returns the full registration", () =>
    assert.equal(JSON.stringify(scan).includes(REGISTRATION), false),
  );
  check("the scan never returns the owner's phone number", () =>
    assert.equal(JSON.stringify(scan).includes(PHONE), false),
  );
  check("the scan never returns the owner's real name", () =>
    assert.equal(JSON.stringify(scan).includes("Smoke Test Car Owner"), false),
  );
  check("the scan only offers the reasons the tag owner allowed", () =>
    assert.ok(Array.isArray(scan.view.reasons) && scan.view.reasons.length > 0),
  );

  // Relay communication -------------------------------------------------------
  await call("POST", "/s/session/reason", { body: { sessionToken: session, reasonCode: "BLOCKING" } });

  const chat = data(
    await call("POST", "/s/contact", { body: { sessionToken: session, reasonCode: "BLOCKING", channel: "CHAT" } }),
  );
  const chatId = chat.sessionId as string;
  check("the visitor opens a secure chat through a relay", () => assert.ok(chatId));

  await call("POST", `/s/chat/sessions/${chatId}/messages`, {
    body: { body: "Smoke test: your car is blocking the gate." },
    headers: { "x-scanner-session": session },
  });
  const ownerThread = data(await call("GET", `/communications/sessions/${chatId}/messages`, { token }));
  check("the owner's thread receives the visitor's message", () =>
    assert.equal(ownerThread[0].body, "Smoke test: your car is blocking the gate."),
  );

  await call("POST", `/communications/sessions/${chatId}/reply`, {
    body: { body: "Moving it now." },
    token,
  });
  const afterReply = data(await call("GET", `/communications/sessions/${chatId}/messages`, { token }));
  check("the owner can reply without revealing their number", () =>
    assert.equal(afterReply.length, 2),
  );

  const sms = data(
    await call("POST", "/s/contact", { body: { sessionToken: session, reasonCode: "BLOCKING", channel: "SMS" } }),
  );
  check("an SMS relay session leaks no phone number to the visitor", () =>
    assert.equal(JSON.stringify(sms).includes(PHONE), false),
  );

  // Step-up auth --------------------------------------------------------------
  const contactNoReauth = await call("POST", "/emergency/contacts", {
    body: { name: "Smoke Spouse", relationship: "Wife", phone: "9000000001", priority: 1, enabled: true },
    token,
  });
  check("adding an emergency contact requires step-up authentication", () =>
    assert.equal(contactNoReauth.status, 403),
  );

  const reauthOtp = await requestOtp(PHONE, "/auth/reauth/request");
  const reauth = data(
    await call("POST", "/auth/reauth/verify", { body: { phone: PHONE, code: reauthOtp }, token }),
  );
  const reauthToken = reauth.reauthToken as string;

  const contact = data(
    await call(
      "POST",
      "/emergency/contacts",
      {
        body: { name: "Smoke Spouse", relationship: "Wife", phone: "9000000001", priority: 1, enabled: true },
        token,
        headers: { "x-reauth-token": reauthToken },
      },
    ),
  );
  check("with a fresh OTP the contact is saved", () => assert.ok(contact.id));

  // Emergency ----------------------------------------------------------------
  const alert = data(
    await call("POST", "/s/emergency", {
      body: { sessionToken: session, reasonCode: "ACCIDENT_EMERGENCY", note: "Smoke test alert." },
    }),
  );
  check("a stranger can raise an emergency on a tag", () => assert.equal(alert.status, "RAISED"));

  const alerts = data(await call("GET", "/communications/emergency-alerts", { token }));
  check("the owner is notified of the emergency", () =>
    assert.ok(alerts.some((a: { reasonCode: string }) => a.reasonCode === "ACCIDENT_EMERGENCY")),
  );

  // Authorization ------------------------------------------------------------
  const forbidden = await call("GET", "/admin/users", { token });
  assert.equal(forbidden.status, 403);
  checks += 1;
  steps.push("  ok  an owner cannot reach the admin API");

  const anonymous = await call("GET", "/communications/sessions");
  assert.equal(anonymous.status, 401);
  checks += 1;
  steps.push("  ok  an unauthenticated request is rejected");

  const badToken = await call("GET", "/users/me", { token: "not-a-real-token" });
  assert.equal(badToken.status, 401);
  checks += 1;
  steps.push("  ok  a forged token is rejected");

  const suspended = await call("POST", `/tags/${tagId}/deactivate`, { body: {}, token });
  assert.equal(suspended.status, 200);
  checks += 1;
  steps.push("  ok  the owner deactivates the tag");

  const scanInactive = await call("GET", `/s/tags/${publicToken}`);
  assert.equal(scanInactive.status, 404);
  checks += 1;
  steps.push("  ok  a deactivated tag stops resolving publicly");

  // Summary ------------------------------------------------------------------
  process.stdout.write(`\nSampark API smoke test: ${checks} checks passed (phone ${PHONE})\n${steps.join("\n")}\n`);
}

main().catch((err) => {
  process.stderr.write(`\nSMOKE TEST FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
