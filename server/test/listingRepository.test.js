import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("persists a posted listing across separate API process lifecycles", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roombridge-listings-"));
  const dataFile = path.join(directory, "listings.json");
  const repositoryUrl = new URL("../src/listingRepository.js", import.meta.url).href;
  const listing = {
    id: "listing-persistence-test",
    title: "Persistence Hall – Unit 204",
    university: "Portland State University",
    rent: 975,
    createdAt: "2026-07-28T12:00:00.000Z"
  };

  try {
    const writer = `
      const repository = await import(${JSON.stringify(repositoryUrl)});
      await repository.initializeListingRepository([]);
      await repository.persistListing(${JSON.stringify(listing)});
    `;
    await execFileAsync(process.execPath, ["--input-type=module", "-e", writer], {
      env: { ...process.env, DATABASE_URL: "", LISTINGS_DATA_FILE: dataFile }
    });

    const reader = `
      const repository = await import(${JSON.stringify(repositoryUrl)});
      const result = await repository.initializeListingRepository([]);
      process.stdout.write(JSON.stringify(result.listings));
    `;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", reader], {
      env: { ...process.env, DATABASE_URL: "", LISTINGS_DATA_FILE: dataFile }
    });
    const restored = JSON.parse(stdout);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].title, listing.title);
    assert.equal(restored[0].rent, 975);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
