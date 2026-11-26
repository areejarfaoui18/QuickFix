import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";

test("artisan profile model includes identity fields after a development reload", async () => {
  mongoose.model("ArtisanProfile", new mongoose.Schema({ userId: mongoose.Schema.Types.ObjectId }));
  const { ArtisanProfile } = await import("../src/models/artisan-profile");

  assert.ok(ArtisanProfile.schema.path("identityDocument.fileId"));
  assert.ok(ArtisanProfile.schema.path("identityDocument.mimeType"));
  assert.ok(ArtisanProfile.schema.path("identityDocument.size"));
});