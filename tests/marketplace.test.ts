import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { calculateCommissionCents, MARKETPLACE_CATEGORIES } from "../src/lib/marketplace";
import { JobPost } from "../src/models/job-post";

test("the artisan commission is 5% and rounded to the nearest cent", () => {
  assert.equal(calculateCommissionCents(10_000), 500);
  assert.equal(calculateCommissionCents(101), 5);
  assert.equal(calculateCommissionCents(110), 6);
});

test("job posts require an existing service category", async () => {
  const job = new JobPost({
    clientId: new mongoose.Types.ObjectId(),
    title: "Réparation de plomberie",
    category: "Unknown",
    city: "Tunis",
    description: "Une fuite à réparer dans la cuisine.",
    address: "Adresse privée",
    scheduledAt: new Date(Date.now() + 86400000),
  });
  await assert.rejects(job.validate(), (error: mongoose.Error.ValidationError) => error.errors.category?.kind === "enum");
  job.category = MARKETPLACE_CATEGORIES[0];
  await job.validate();
});