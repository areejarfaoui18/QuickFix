import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import mongoose from "mongoose";
import { compareNames, parseIdentityOcrFields } from "../src/lib/identity-ocr";
import { ArtisanProfile } from "../src/models/artisan-profile";
import { Session } from "../src/models/session";
import { User } from "../src/models/user";

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();
const cookie = `quickfix_session=${"a".repeat(43)}`;

let ocrRoute: typeof import("../src/app/api/admin/artisans/ocr/route");

before(async () => {
  Object.assign(globalThis, { mongooseCache: { connection: mongoose, promise: null } });
  ocrRoute = await import("../src/app/api/admin/artisans/ocr/route");
});

function authenticate(context: TestContext, role: "ARTISAN" | "ADMIN") {
  context.mock.method(Session, "findOne", () => ({ select: async () => ({ userId }) }) as never);
  context.mock.method(User, "findById", () => ({
    select: () => ({ lean: async () => ({ _id: userId, name: "Test", role, isSuspended: false, mustChangePassword: false }) }),
  }) as never);
}

function ocrRequest() {
  return new Request("http://localhost/api/admin/artisans/ocr", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ profileId: profileId.toString() }),
  });
}

test("names match despite accents, order and transliteration spelling", () => {
  assert.equal(compareNames("Mohamed Ben Salah", "BEN SALAH Mohammed"), "MATCH");
  assert.equal(compareNames("Inès Trabelsi", "Ines TRABELSI"), "MATCH");
  assert.equal(compareNames("محمد بن صالح", "Mohamed Ben Salah", "محمد بن صالح"), "MATCH");
});

test("names match across different transliterations of the same Arabic name", () => {
  assert.equal(compareNames("Ines Trabelsi", "Inas El Tarablosi", "إيناس الطرابلسي"), "MATCH");
  assert.equal(compareNames("Salah Jaziri", "Saleh Jeziri"), "MATCH");
});

test("similar-looking but different names do not match", () => {
  assert.equal(compareNames("Mohamed", "Mahmoud"), "MISMATCH");
  assert.equal(compareNames("Karim", "Akram"), "MISMATCH");
  assert.equal(compareNames("Sami", "Sana"), "MISMATCH");
});

test("a different or partly different name is flagged", () => {
  assert.equal(compareNames("Mohamed Ben Salah", "Karim Gharbi"), "MISMATCH");
  assert.equal(compareNames("Mohamed Trabelsi", "Mohamed Gharbi"), "PARTIAL");
  assert.equal(compareNames("Mohamed Trabelsi", "", ""), "UNKNOWN");
});

test("OCR answers are validated and cleaned", () => {
  assert.deepEqual(parseIdentityOcrFields({
    fields: {
      document_type: "TUNISIAN_CIN", readable: true, full_name_original: " محمد  بن صالح ", full_name_latin: "Mohamed Ben Salah",
      document_number: "0123 4567", birth_date: "1990-05-17", expiry_date: "17/05/2030",
    },
  }), {
    documentType: "TUNISIAN_CIN", readable: true, fullName: "محمد بن صالح", fullNameLatin: "Mohamed Ben Salah",
    documentNumber: "01234567", birthDate: "1990-05-17", expiryDate: "",
  });
  assert.equal(parseIdentityOcrFields({ fields: { document_type: "SOMETHING_ELSE" } }), null);
  assert.equal(parseIdentityOcrFields({ error: "boom" }), null);
});

test("only administrators can start the automatic reading", async (context) => {
  authenticate(context, "ARTISAN");
  const response = await ocrRoute.POST(ocrRequest());
  assert.equal(response.status, 403);
});

test("the automatic reading reports when it is not configured", async (context) => {
  authenticate(context, "ADMIN");
  delete process.env.IDENTITY_OCR_URL;
  const response = await ocrRoute.POST(ocrRequest());
  assert.equal(response.status, 503);
});

test("the automatic reading needs a pending identity document", async (context) => {
  authenticate(context, "ADMIN");
  process.env.IDENTITY_OCR_URL = "https://ocr.example.test";
  process.env.IDENTITY_OCR_TOKEN = "test-token";
  context.after(() => { delete process.env.IDENTITY_OCR_URL; delete process.env.IDENTITY_OCR_TOKEN; });
  context.mock.method(ArtisanProfile, "findOne", () => ({ select: () => ({ lean: async () => null }) }) as never);
  const response = await ocrRoute.POST(ocrRequest());
  assert.equal(response.status, 409);
});
