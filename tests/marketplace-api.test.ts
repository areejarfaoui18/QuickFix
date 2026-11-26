import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import mongoose from "mongoose";
import { ArtisanProfile } from "../src/models/artisan-profile";
import { JobPost } from "../src/models/job-post";
import { JobProposal } from "../src/models/job-proposal";
import { ServiceRequest } from "../src/models/service-request";
import { Session } from "../src/models/session";
import { User } from "../src/models/user";

const userId = new mongoose.Types.ObjectId();
const artisanId = new mongoose.Types.ObjectId();
const jobId = new mongoose.Types.ObjectId();
const proposalId = new mongoose.Types.ObjectId();
const requestId = new mongoose.Types.ObjectId();
const cookie = `quickfix_session=${"a".repeat(43)}`;

let jobs: typeof import("../src/app/api/jobs/route");
let proposals: typeof import("../src/app/api/job-proposals/route");

before(async () => {
  Object.assign(globalThis, { mongooseCache: { connection: mongoose, promise: null } });
  jobs = await import("../src/app/api/jobs/route");
  proposals = await import("../src/app/api/job-proposals/route");
});

function authenticate(context: TestContext, role: "CLIENT" | "ARTISAN" | "ADMIN") {
  context.mock.method(Session, "findOne", () => ({ select: async () => ({ userId }) }) as never);
  context.mock.method(User, "findById", () => ({
    select: () => ({ lean: async () => ({ _id: userId, name: "Test", role, isSuspended: false, mustChangePassword: false }) }),
  }) as never);
}

function mockTransaction(context: TestContext) {
  context.mock.method(mongoose, "startSession", (async () => ({
    withTransaction: async (callback: () => Promise<void>) => callback(),
    endSession: async () => undefined,
  })) as never);
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("public job posting requires a client account", async (context) => {
  authenticate(context, "ARTISAN");
  const response = await jobs.POST(request("/api/jobs", "POST", {}));
  assert.equal(response.status, 403);
});

test("a client cannot read proposals for another client's job", async (context) => {
  authenticate(context, "CLIENT");
  context.mock.method(JobPost, "exists", (async () => null) as never);
  const response = await proposals.GET(request(`/api/job-proposals?jobId=${jobId}`));
  assert.equal(response.status, 404);
});

test("artisan job listings do not expose the intervention address", async (context) => {
  authenticate(context, "ARTISAN");
  context.mock.method(ArtisanProfile, "findOne", () => ({
    select: () => ({ lean: async () => ({ category: "Plomberie", isAvailable: true, verificationStatus: "VERIFIED", identityDocument: { fileId: jobId } }) }),
  }) as never);
  context.mock.method(JobProposal, "find", () => ({ select: () => ({ lean: async () => [] }) }) as never);
  context.mock.method(JobPost, "find", () => ({
    select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{
      _id: jobId, title: "Réparation", category: "Plomberie", city: "Tunis", description: "Détails publics",
      address: "adresse strictement privée", scheduledAt: new Date(), status: "OPEN", createdAt: new Date(),
    }] }) }) }),
  }) as never);
  const response = await jobs.GET(request("/api/jobs"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.eligible, true);
  assert.equal(result.jobs.length, 1);
  assert.equal("address" in result.jobs[0], false);
  assert.doesNotMatch(JSON.stringify(result), /adresse strictement privée/);
});

test("only verified and available artisans can submit a proposal", async (context) => {
  authenticate(context, "ARTISAN");
  mockTransaction(context);
  context.mock.method(ArtisanProfile, "findOne", () => ({ select: () => ({ session: async () => null }) }) as never);
  const response = await proposals.POST(request("/api/job-proposals", "POST", {
    jobId: jobId.toString(), message: "Je peux effectuer cette intervention.",
    items: [{ description: "Main-d’œuvre", amountCents: 10000 }], validDays: 30,
  }));
  assert.equal(response.status, 403);
});

test("proposal submission calculates the fee server-side and requires an open matching job", async (context) => {
  authenticate(context, "ARTISAN");
  mockTransaction(context);
  context.mock.method(ArtisanProfile, "findOne", () => ({ select: () => ({ session: async () => ({ category: "Plomberie" }) }) }) as never);
  let observedFilter: Record<string, unknown> | undefined;
  let created: Record<string, unknown> | undefined;
  context.mock.method(JobPost, "findOneAndUpdate", (async (filter: Record<string, unknown>) => {
    observedFilter = filter;
    return { _id: jobId };
  }) as never);
  context.mock.method(JobProposal, "exists", () => ({ session: async () => null }) as never);
  context.mock.method(JobProposal, "create", (async (documents: Record<string, unknown>[]) => {
    created = documents[0];
    return [{ id: proposalId.toString() }];
  }) as never);
  const response = await proposals.POST(request("/api/job-proposals", "POST", {
    jobId: jobId.toString(), message: "Je peux effectuer cette intervention.",
    items: [{ description: "Main-d’œuvre", amountCents: 10000 }, { description: "Pièces", amountCents: 5000 }],
    validDays: 30, commissionCents: 0,
  }));
  assert.equal(response.status, 201);
  assert.equal(observedFilter?.status, "OPEN");
  assert.equal(observedFilter?.category, "Plomberie");
  assert.equal(created?.totalCents, 15000);
  assert.equal(created?.commissionCents, 750);
});

test("an artisan cannot submit a second proposal for the same job", async (context) => {
  authenticate(context, "ARTISAN");
  mockTransaction(context);
  context.mock.method(ArtisanProfile, "findOne", () => ({ select: () => ({ session: async () => ({ category: "Plomberie" }) }) }) as never);
  context.mock.method(JobPost, "findOneAndUpdate", (async () => ({ _id: jobId })) as never);
  context.mock.method(JobProposal, "exists", () => ({ session: async () => ({ _id: proposalId }) }) as never);
  const createProposal = context.mock.method(JobProposal, "create", (async () => []) as never);
  const response = await proposals.POST(request("/api/job-proposals", "POST", {
    jobId: jobId.toString(), message: "Je peux effectuer cette intervention.",
    items: [{ description: "Main-d’œuvre", amountCents: 10000 }], validDays: 30,
  }));
  assert.equal(response.status, 409);
  assert.equal(createProposal.mock.callCount(), 0);
});

test("choosing a proposal creates one accepted request with the agreed itemized quote", async (context) => {
  authenticate(context, "CLIENT");
  mockTransaction(context);
  let open = true;
  let createdRequests = 0;
  let created: Record<string, unknown> | undefined;
  context.mock.method(JobPost, "findOneAndUpdate", (async (filter: Record<string, unknown>) => {
    assert.equal(filter.status, "OPEN");
    assert.equal(filter.clientId, userId);
    if (!open) return null;
    open = false;
    return { _id: jobId, clientId: userId, category: "Plomberie", description: "Détails du travail", address: "Adresse privée", scheduledAt: new Date(Date.now() + 86400000) };
  }) as never);
  context.mock.method(JobProposal, "findOne", () => ({ session: async () => ({
    _id: proposalId, artisanId, totalCents: 15000,
    items: [{ description: "Main-d’œuvre", amountCents: 10000 }, { description: "Pièces", amountCents: 5000 }],
    validUntil: new Date(Date.now() + 86400000), createdAt: new Date(),
  }) }) as never);
  context.mock.method(User, "exists", () => ({ session: async () => ({ _id: artisanId }) }) as never);
  context.mock.method(ArtisanProfile, "exists", () => ({ session: async () => ({ _id: artisanId }) }) as never);
  context.mock.method(ServiceRequest, "create", (async (documents: Record<string, unknown>[]) => {
    created = documents[0];
    createdRequests += 1;
    return [{ _id: requestId, id: requestId.toString() }];
  }) as never);
  context.mock.method(JobProposal, "updateOne", (async () => ({})) as never);
  context.mock.method(JobProposal, "updateMany", (async () => ({})) as never);
  context.mock.method(JobPost, "updateOne", (async () => ({})) as never);
  const body = { jobId: jobId.toString(), proposalId: proposalId.toString() };
  const first = await proposals.PATCH(request("/api/job-proposals", "PATCH", body));
  assert.equal(first.status, 200);
  assert.equal(created?.status, "ACCEPTEE");
  assert.equal(created?.announcedPrice, 150);
  assert.deepEqual(created?.quoteItems, [{ description: "Main-d’œuvre", amount: 100 }, { description: "Pièces", amount: 50 }]);
  assert.ok(created?.quoteAcceptedAt instanceof Date);
  const second = await proposals.PATCH(request("/api/job-proposals", "PATCH", body));
  assert.equal(second.status, 409);
  assert.equal(createdRequests, 1);
});

test("only the owner can cancel an open job and its pending proposals", async (context) => {
  authenticate(context, "CLIENT");
  mockTransaction(context);
  let observedFilter: Record<string, unknown> | undefined;
  let declinedFilter: Record<string, unknown> | undefined;
  context.mock.method(JobPost, "findOneAndUpdate", (async (filter: Record<string, unknown>) => {
    observedFilter = filter;
    return { _id: jobId };
  }) as never);
  context.mock.method(JobProposal, "updateMany", (async (filter: Record<string, unknown>) => {
    declinedFilter = filter;
    return {};
  }) as never);
  const response = await jobs.PATCH(request("/api/jobs", "PATCH", { id: jobId.toString() }));
  assert.equal(response.status, 200);
  assert.equal(observedFilter?.clientId, userId);
  assert.equal(observedFilter?.status, "OPEN");
  assert.equal(declinedFilter?.jobId, jobId);
  assert.equal(declinedFilter?.status, "PENDING");
});