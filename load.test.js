import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

export const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "30s", target: 20 },  // ramp up
    { duration: "1m", target: 50 },   // sustain
    { duration: "30s", target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.05"],
    errors: ["rate<0.05"],
  },
};

const BASE = __ENV.API_BASE_URL || "http://localhost:4000/api";

function randomPhone() {
  return "+91" + Math.floor(9000000000 + Math.random() * 1000000000);
}

export default function () {
  // Public tag resolution (no auth) - high volume, read-heavy
  const tagRes = http.get(`${BASE}/s/tags/scan-qr-token-placeholder`);
  check(tagRes, {
    "tag resolve status is 200 or 404": (r) => r.status === 200 || r.status === 404,
    "tag resolve fast": (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(0.5);

  // Health check
  const health = http.get(`${BASE.replace("/api", "")}/health`);
  check(health, {
    "health ok": (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(1);
}
