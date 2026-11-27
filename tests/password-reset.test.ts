import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import { verifyPassword } from "../src/lib/password";
import { User } from "../src/models/user";

const userId = new mongoose.Types.ObjectId();
let forgotPassword: typeof import("../src/app/api/auth/forgot-password/route");
let resetPassword: typeof import("../src/app/api/auth/reset-password/route");

before(async () => {
  Object.assign(globalThis, { mongooseCache: { connection: mongoose, promise: null } });
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMTP_USER = "quickfix.demo@gmail.com";
  process.env.SMTP_APP_PASSWORD = "app-password";
  forgotPassword = await import("../src/app/api/auth/forgot-password/route");
  resetPassword = await import("../src/app/api/auth/reset-password/route");
});

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockMailer(context: TestContext) {
  const messages: Array<{ text: string }> = [];
  const sendMail = context.mock.fn(async (message: { text: string }) => {
    messages.push(message);
    return { messageId: "message-id" };
  });
  context.mock.method(nodemailer, "createTransport", () => ({ sendMail }) as never);
  return { sendMail, messages };
}

test("forgot password always returns the same message for an unknown address", async (context) => {
  context.mock.method(User, "findOne", () => ({ select: async () => null }) as never);
  const response = await forgotPassword.POST(request("/api/auth/forgot-password", { email: "missing@example.com" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Si un compte actif correspond à cette adresse, un lien de réinitialisation vient d’être envoyé." });
});

test("forgot password rejects an invalid address", async () => {
  const response = await forgotPassword.POST(request("/api/auth/forgot-password", { email: "not-an-email" }));
  assert.equal(response.status, 400);
});

test("forgot password stores a hashed token and sends the reset link", async (context) => {
  const save = context.mock.fn(async () => undefined);
  const user: Record<string, unknown> = {
    id: userId.toString(), name: "Test User", email: "user@example.com", passwordResetSentAt: undefined, save,
  };
  const { sendMail, messages } = mockMailer(context);
  context.mock.method(User, "findOne", () => ({ select: async () => user }) as never);

  const response = await forgotPassword.POST(request("/api/auth/forgot-password", { email: "user@example.com" }));
  assert.equal(response.status, 200);
  assert.equal(save.mock.callCount(), 1);
  assert.match(user.passwordResetTokenHash as string, /^[a-f0-9]{64}$/);
  assert.ok(user.passwordResetExpiresAt instanceof Date);
  assert.equal(sendMail.mock.callCount(), 1);
  assert.match(messages[0]?.text ?? "", /reset-password\?token=[A-Za-z0-9_-]{43}/);
});

test("forgot password does not resend during the cooldown", async (context) => {
  const save = context.mock.fn(async () => undefined);
  const user = {
    id: userId.toString(), name: "Test User", email: "user@example.com", passwordResetSentAt: new Date(), save,
  };
  const { sendMail } = mockMailer(context);
  context.mock.method(User, "findOne", () => ({ select: async () => user }) as never);

  const response = await forgotPassword.POST(request("/api/auth/forgot-password", { email: "user@example.com" }));
  assert.equal(response.status, 200);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(sendMail.mock.callCount(), 0);
});

test("reset password rejects an expired or invalid token", async (context) => {
  context.mock.method(User, "findOneAndUpdate", async () => null as never);
  const response = await resetPassword.POST(request("/api/auth/reset-password", {
    token: "a".repeat(43), password: "new-secure-password",
  }));
  assert.equal(response.status, 400);
});

test("reset password changes the password once", async (context) => {
  let available = true;
  let passwordHash = "";
  context.mock.method(User, "findOneAndUpdate", async (_filter: unknown, update: unknown) => {
    if (!available) return null as never;
    available = false;
    passwordHash = (update as { $set: { passwordHash: string } }).$set.passwordHash;
    return { _id: userId } as never;
  });
  const body = { token: "a".repeat(43), password: "new-secure-password" };

  const first = await resetPassword.POST(request("/api/auth/reset-password", body));
  assert.equal(first.status, 200);
  assert.equal(await verifyPassword(body.password, passwordHash), true);
  const second = await resetPassword.POST(request("/api/auth/reset-password", body));
  assert.equal(second.status, 400);
});
