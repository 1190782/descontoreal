import { describe, expect, it } from "vitest";
import { DAY_MS, TIME_ZONE, calendarDaysBetween, daysBetween, formatDatePt, lisbonDate } from "../src/time";

describe("lisbonDate", () => {
  it.each([
    ["the last summer-time instant of 24 October", "2026-10-24T22:59:59.999Z", "2026-10-24"],
    ["Lisbon midnight on the day summer time ends", "2026-10-24T23:00:00.000Z", "2026-10-25"],
    ["01:59 before the clocks go back", "2026-10-25T00:59:59.000Z", "2026-10-25"],
    ["01:00 after the clocks go back", "2026-10-25T01:00:00.000Z", "2026-10-25"],
    ["the last instant of 25 October in winter time", "2026-10-25T23:59:59.999Z", "2026-10-25"],
    ["Lisbon midnight after the change", "2026-10-26T00:00:00.000Z", "2026-10-26"],
    ["the last winter-time instant before summer time", "2026-03-28T23:59:59.999Z", "2026-03-28"],
    ["Lisbon midnight on the day summer time starts", "2026-03-29T00:00:00.000Z", "2026-03-29"],
    ["summer midnight, an hour before UTC midnight", "2026-07-01T23:00:00.000Z", "2026-07-02"],
    ["the last summer instant of 1 July", "2026-07-01T22:59:59.999Z", "2026-07-01"],
    ["the last instant of the year", "2025-12-31T23:59:59.999Z", "2025-12-31"],
    ["new year's midnight", "2026-01-01T00:00:00.000Z", "2026-01-01"],
  ])("returns the Lisbon day at %s", (_case, iso, expected) => {
    // Arrange
    const date = new Date(iso);

    // Act
    const day = lisbonDate(date);

    // Assert
    expect(day).toBe(expected);
  });
});

describe("formatDatePt", () => {
  it.each([
    ["2026-10-28T06:00:00.000Z", "28 de outubro de 2026"],
    ["2026-10-24T23:30:00.000Z", "25 de outubro de 2026"],
    ["2026-03-29T00:30:00.000Z", "29 de março de 2026"],
    ["2026-01-01T00:00:00.000Z", "1 de janeiro de 2026"],
  ])("formats %s as %j", (iso, expected) => {
    // Arrange
    const date = new Date(iso);

    // Act
    const text = formatDatePt(date);

    // Assert
    expect(text).toBe(expected);
  });
});

describe("daysBetween", () => {
  it.each([
    ["the same instant", "2026-11-01T10:00:00.000Z", "2026-11-01T10:00:00.000Z", 0],
    ["one millisecond short of a day", "2026-11-01T10:00:00.000Z", "2026-11-02T09:59:59.999Z", 0],
    ["exactly one day", "2026-11-01T10:00:00.000Z", "2026-11-02T10:00:00.000Z", 1],
    ["thirty days", "2026-10-28T06:00:00.000Z", "2026-11-27T06:00:00.000Z", 30],
    ["Lisbon noon to noon across the 25-hour day", "2026-10-24T11:00:00.000Z", "2026-10-25T12:00:00.000Z", 1],
    ["Lisbon noon to noon across the 23-hour day", "2026-03-28T12:00:00.000Z", "2026-03-29T11:00:00.000Z", 0],
    ["a later start", "2026-11-02T10:00:00.000Z", "2026-11-01T10:00:00.000Z", -1],
  ])("counts whole elapsed days for %s", (_case, from, to, expected) => {
    // Arrange
    const start = new Date(from);

    // Act
    const days = daysBetween(start, new Date(to));

    // Assert
    expect(days).toBe(expected);
  });
});

describe("calendarDaysBetween", () => {
  it.each([
    ["the same instant", "2026-11-01T10:00:00.000Z", "2026-11-01T10:00:00.000Z", 0],
    ["midnight to the end of that day", "2026-11-01T00:00:00.000Z", "2026-11-01T23:59:59.999Z", 0],
    ["2 ms across winter midnight", "2026-10-28T23:59:59.999Z", "2026-10-29T00:00:00.001Z", 1],
    ["1 ms across summer midnight", "2026-07-01T22:59:59.999Z", "2026-07-01T23:00:00.000Z", 1],
    ["28 Oct 11:00 to 27 Nov midnight", "2026-10-28T11:00:00.000Z", "2026-11-27T00:00:00.000Z", 30],
    ["28 Oct 11:00 to the end of 27 Nov", "2026-10-28T11:00:00.000Z", "2026-11-27T23:59:59.999Z", 30],
    ["28 Oct 11:00 to the end of 26 Nov", "2026-10-28T11:00:00.000Z", "2026-11-26T23:59:59.999Z", 29],
    ["the 25-hour day, start to end", "2026-10-24T23:00:00.000Z", "2026-10-25T23:59:59.999Z", 0],
    ["midnight to midnight over 25 hours", "2026-10-24T23:00:00.000Z", "2026-10-26T00:00:00.000Z", 1],
    ["the 23-hour day, start to end", "2027-03-28T00:00:00.000Z", "2027-03-28T22:59:59.999Z", 0],
    ["midnight to midnight over 23 hours", "2027-03-28T00:00:00.000Z", "2027-03-28T23:00:00.000Z", 1],
    ["noon to noon across the 23-hour day", "2027-03-27T12:00:00.000Z", "2027-03-28T11:00:00.000Z", 1],
    ["noon to noon across both clock changes", "2026-10-24T12:00:00.000Z", "2027-03-29T12:00:00.000Z", 156],
    ["noon to noon across a leap day", "2028-02-28T12:00:00.000Z", "2028-03-01T12:00:00.000Z", 2],
    ["a later start", "2026-11-02T10:00:00.000Z", "2026-11-01T10:00:00.000Z", -1],
  ])("counts Lisbon calendar days for %s", (_case, from, to, expected) => {
    // Arrange
    const start = new Date(from);

    // Act
    const days = calendarDaysBetween(start, new Date(to));

    // Assert
    expect(days).toBe(expected);
  });
});

describe("time constants", () => {
  it("uses 24-hour days and the Lisbon time zone", () => {
    // Arrange
    const expectedDayMs = 24 * 60 * 60 * 1000;

    // Act
    const constants = { DAY_MS, TIME_ZONE };

    // Assert
    expect(constants).toEqual({ DAY_MS: expectedDayMs, TIME_ZONE: "Europe/Lisbon" });
  });
});
