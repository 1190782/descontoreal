import { readFileSync } from "node:fs";
import { BOT_POLICY } from "@descontoreal/core";
import { describe, expect, it } from "vitest";

const LINES = readFileSync(new URL("../../../.github/workflows/scrape.yml", import.meta.url), "utf8").split(
  /\r?\n/,
);

function indentOf(line: string | undefined): number {
  return line === undefined ? 0 : line.length - line.trimStart().length;
}

/** Trimmed lines of the step named `name`, up to the next line indented no deeper than its "- name:". */
function stepLines(name: string): string[] {
  const start = LINES.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) {
    throw new Error(`scrape.yml has no step "${name}"`);
  }
  const indent = indentOf(LINES[start]);
  const end = LINES.findIndex(
    (line, index) => index > start && line.trim() !== "" && indentOf(line) <= indent,
  );
  return LINES.slice(start, end === -1 ? undefined : end).map((line) => line.trim());
}

describe("scrape.yml", () => {
  it("starts the daily collection at the time the bot page states (BOT_POLICY)", () => {
    // Act
    const crons = LINES.flatMap((line) => /^\s*- cron: "(.+)"\s*$/.exec(line)?.[1] ?? []);

    // Assert
    const { hour, minute } = BOT_POLICY.dailyRunUtc;
    expect(crons).toEqual([`${minute} ${hour} * * *`]);
  });

  it("collects with NODE_ENV=production, so the Resend SDK never prints an API error in the public log", () => {
    // Act
    const lines = stepLines("Recolher preços");

    // Assert
    expect(lines).toContain("NODE_ENV: production");
  });

  it("sets NODE_ENV on no other step or job, so installs keep the devDependencies", () => {
    // Act
    const settings = LINES.filter((line) => line.trim().startsWith("NODE_ENV:"));

    // Assert
    expect(settings.map((line) => line.trim())).toEqual(["NODE_ENV: production"]);
  });
});
