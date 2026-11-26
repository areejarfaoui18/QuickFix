import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { before, test, type TestContext } from "node:test";
import mongoose from "mongoose";
import { ArtisanProfile } from "../src/models/artisan-profile";
import { Session } from "../src/models/session";
import { User } from "../src/models/user";

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();
const requestId = new mongoose.Types.ObjectId();
const cookie = `quickfix_session=${"a".repeat(43)}`;

let verification: typeof import("../src/app/api/artisan/verification/route");
let adminArtisans: typeof import("../src/app/api/admin/artisans/route");
let requests: typeof import("../src/app/api/requests/route");
let registration: typeof import("../src/app/api/auth/register/route");

before(async () => {
  Object.assign(globalThis, { mongooseCache: { connection: mongoose, promise: null } });
  verification = await import("../src/app/api/artisan/verification/route");
  adminArtisans = await import("../src/app/api/admin/artisans/route");
  requests = await import("../src/app/api/requests/route");
  registration = await import("../src/app/api/auth/register/route");
});

function authenticate(context: TestContext, role: "CLIENT" | "ARTISAN" | "ADMIN") {
  context.mock.method(Session, "findOne", () => ({ select: async () => ({ userId }) }) as never);
  context.mock.method(User, "findById", () => ({
    select: () => ({ lean: async () => ({ _id: userId, name: "Test", role, isSuspended: false, mustChangePassword: false }) }),
  }) as never);
}

function authenticatedRequest(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function identityUploadRequest() {
  const form = new FormData();
  form.set("document", new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }), "identity.pdf");
  return new Request("http://localhost/api/artisan/verification", { method: "POST", headers: { cookie }, body: form });
}

function mockIdentityStorage(context: TestContext, fileId: mongoose.Types.ObjectId) {
  const originalDatabase = mongoose.connection.db;
  Object.assign(mongoose.connection, { db: { collection: () => ({}) } });
  context.after(() => Object.assign(mongoose.connection, { db: originalDatabase }));
  context.mock.method(mongoose.mongo.GridFSBucket.prototype, "openUploadStream", () => Object.assign(
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    { id: fileId },
  ) as never);
}

test("ID status requires authentication", async () => {
  const response = await verification.GET(new Request("http://localhost/api/artisan/verification"));
  assert.equal(response.status, 401);
});

test("clients cannot download identity documents", async (context) => {
  authenticate(context, "CLIENT");
  const response = await verification.GET(authenticatedRequest(`/api/artisan/verification?profileId=${profileId}`));
  assert.equal(response.status, 403);
});

test("artisan sees verification status without document metadata", async (context) => {
  authenticate(context, "ARTISAN");
  context.mock.method(ArtisanProfile, "findOne", () => ({
    select: () => ({ lean: async () => ({ verificationStatus: "PENDING", identityDocument: { fileId: profileId } }) }),
  }) as never);
  const response = await verification.GET(authenticatedRequest("/api/artisan/verification"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "PENDING", reason: "", hasDocument: true });
});

test("an administrator cannot approve a profile without an ID", async (context) => {
  authenticate(context, "ADMIN");
  context.mock.method(ArtisanProfile, "findOne", () => ({ select: async () => ({ userId }) }) as never);
  const response = await adminArtisans.PATCH(authenticatedRequest("/api/admin/artisans", "PATCH", {
    profileId: profileId.toString(), status: "VERIFIED",
  }));
  assert.equal(response.status, 409);
});

test("unverified artisans cannot accept an existing request", async (context) => {
  authenticate(context, "ARTISAN");
  context.mock.method(ArtisanProfile, "exists", async () => null as never);
  const response = await requests.PATCH(authenticatedRequest("/api/requests", "PATCH", {
    id: requestId.toString(), status: "ACCEPTEE",
  }));
  assert.equal(response.status, 403);
});

test("unverified artisans cannot start an existing request", async (context) => {
  authenticate(context, "ARTISAN");
  context.mock.method(ArtisanProfile, "exists", async () => null as never);
  const response = await requests.PATCH(authenticatedRequest("/api/requests", "PATCH", {
    id: requestId.toString(), status: "EN_COURS",
  }));
  assert.equal(response.status, 403);
});

test("artisan signup creates an active account and pending profile with a session", async (context) => {
  let accountData: Record<string, unknown> | undefined;
  let profileData: Record<string, unknown> | undefined;
  context.mock.method(User, "create", (async (data: Record<string, unknown>) => {
    accountData = data;
    return { _id: userId, id: userId.toString(), name: data.name, role: data.role, mustChangePassword: false };
  }) as never);
  context.mock.method(ArtisanProfile, "create", (async (data: Record<string, unknown>) => {
    profileData = data;
    return data;
  }) as never);
  context.mock.method(Session, "create", (async () => ({})) as never);
  const response = await registration.POST(authenticatedRequest("/api/auth/register", "POST", {
    name: "Test Artisan", email: "artisan@example.com", password: "secure-password-123", phone: "12345678",
    role: "ARTISAN", category: "Plomberie", city: "Tunis", bio: "",
  }));
  assert.equal(response.status, 201);
  assert.equal(accountData?.isSuspended, false);
  assert.equal(profileData?.verificationStatus, "PENDING");
  assert.match(response.headers.get("set-cookie") ?? "", /^quickfix_session=/);
  assert.equal((await response.json()).user.role, "ARTISAN");
});

test("clients cannot submit identity documents", async (context) => {
  authenticate(context, "CLIENT");
  const response = await verification.POST(authenticatedRequest("/api/artisan/verification", "POST"));
  assert.equal(response.status, 403);
});

test("an ID awaiting verification cannot be uploaded again", async (context) => {
  authenticate(context, "ARTISAN");
  context.mock.method(ArtisanProfile, "findOne", () => ({
    select: () => ({ lean: async () => ({ _id: profileId, verificationStatus: "PENDING", identityDocument: { fileId: profileId } }) }),
  }) as never);
  const response = await verification.POST(identityUploadRequest());
  assert.equal(response.status, 409);
});

test("an uploaded ID is saved, shown as pending, and cannot be uploaded again", async (context) => {
  authenticate(context, "ARTISAN");
  const fileId = new mongoose.Types.ObjectId();
  mockIdentityStorage(context, fileId);
  let document: { fileId: mongoose.Types.ObjectId; mimeType: string; size: number } | undefined;
  context.mock.method(ArtisanProfile, "findOne", () => ({
    select: () => ({ lean: async () => ({ _id: profileId, verificationStatus: "PENDING", identityDocument: document }) }),
  }) as never);
  context.mock.method(ArtisanProfile, "findOneAndUpdate", (async (_filter: unknown, update: { $set: { identityDocument: typeof document } }) => {
    document = update.$set.identityDocument;
    return { identityDocument: document };
  }) as never);

  const firstUpload = await verification.POST(identityUploadRequest());
  assert.equal(firstUpload.status, 201);
  const status = await verification.GET(authenticatedRequest("/api/artisan/verification"));
  assert.deepEqual(await status.json(), { status: "PENDING", reason: "", hasDocument: true });
  const duplicateUpload = await verification.POST(identityUploadRequest());
  assert.equal(duplicateUpload.status, 409);
});

test("an upload is not reported as successful if its profile reference was not saved", async (context) => {
  authenticate(context, "ARTISAN");
  const fileId = new mongoose.Types.ObjectId();
  mockIdentityStorage(context, fileId);
  const deleteFile = context.mock.method(mongoose.mongo.GridFSBucket.prototype, "delete", async () => undefined);
  context.mock.method(ArtisanProfile, "findOne", () => ({
    select: () => ({ lean: async () => ({ _id: profileId, verificationStatus: "PENDING" }) }),
  }) as never);
  context.mock.method(ArtisanProfile, "findOneAndUpdate", (async () => ({ identityDocument: {} })) as never);

  const response = await verification.POST(identityUploadRequest());
  assert.equal(response.status, 503);
  assert.equal(deleteFile.mock.callCount(), 1);
});