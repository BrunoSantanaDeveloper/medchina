import {
  aboutEvent,
  addEventToken,
  deviceFromUserAgent,
  EVENT_COOKIE_MAX_EVENTS,
  eventDaypart,
  eventPath,
  eventSlugFromPath,
  isEventSlug,
  isSafeInternalPath,
  normalizeChannel,
  normalizeInternalPath,
  parseEventCookie,
  readEventTopics,
  slugFromTitle,
  topicsCountLabel,
} from "./live-event-common";
import { describe, expect, it } from "vitest";

const token = (seed: string) => seed.repeat(43).slice(0, 43);

describe("eventPath", () => {
  it("keeps the first event at its published address", () => {
    expect(eventPath("lei-15345")).toBe("/lei-15345");
  });
  it("puts every other event under /ao-vivo", () => {
    expect(eventPath("masterclass-fertilidade")).toBe("/ao-vivo/masterclass-fertilidade");
  });
});

describe("slugs", () => {
  it("suggests a slug from a Portuguese title", () => {
    expect(slugFromTitle("Masterclass: Fertilidade na MTC — ao vivo!")).toBe("masterclass-fertilidade-na-mtc-ao-vivo");
    expect(slugFromTitle("Ação e Reação")).toBe("acao-e-reacao");
  });
  it("accepts only the database shape", () => {
    expect(isEventSlug("lei-15345")).toBe(true);
    expect(isEventSlug("ab")).toBe(false);
    expect(isEventSlug("-abc")).toBe(false);
    expect(isEventSlug("Abc")).toBe(false);
    expect(isEventSlug("a/b")).toBe(false);
  });
});

describe("aboutEvent", () => {
  it("uses the topic inside the sentence", () => {
    expect(aboutEvent({ title: "Qualquer", topic: "a Lei 15.345" })).toBe("sobre a Lei 15.345");
  });
  it("falls back to the quoted title", () => {
    expect(aboutEvent({ title: "Fertilidade na MTC", topic: null })).toBe("“Fertilidade na MTC”");
  });
});

describe("registration cookie", () => {
  it("reads a legacy single-token cookie", () => {
    expect(parseEventCookie(token("a"))).toEqual([token("a")]);
  });
  it("drops malformed and repeated parts", () => {
    expect(parseEventCookie(`${token("a")}.nope.${token("a")}.${token("b")}`)).toEqual([token("a"), token("b")]);
  });
  it("adds the newest event first, tagged with its slug", () => {
    const value = addEventToken(`evento-a~${token("a")}`, token("b"), "evento-b");
    expect(value).toBe(`evento-b~${token("b")}.evento-a~${token("a")}`);
    expect(parseEventCookie(value)).toEqual([token("b"), token("a")]);
  });
  it("keeps ONE slot per event: a new token of the same event replaces the old one", () => {
    // Each e-mail link mints a token; they must not push the other events out.
    let value = addEventToken("", token("x"), "outro-evento");
    for (const seed of "abcdefgh") value = addEventToken(value, token(seed), "lei-15345");
    expect(parseEventCookie(value)).toEqual([token("h"), token("x")]);
  });
  it("stays bounded across events", () => {
    let value = "";
    for (const seed of "abcdefghij") value = addEventToken(value, token(seed), `evento-${seed}`);
    expect(parseEventCookie(value)).toHaveLength(EVENT_COOKIE_MAX_EVENTS);
    expect(parseEventCookie(value)[0]).toBe(token("j"));
  });
  it("keeps a legacy bare token behind the new entries", () => {
    const value = addEventToken(token("a"), token("b"), "evento-b");
    expect(parseEventCookie(value)).toEqual([token("b"), token("a")]);
  });
  it("ignores a malformed token or slug instead of storing it", () => {
    expect(addEventToken(token("a"), "short", "evento-b")).toBe(token("a"));
    expect(addEventToken(token("a"), token("b"), "Nope/slug")).toBe(token("a"));
  });
  it("drops an entry whose slug or token is malformed", () => {
    expect(parseEventCookie(`x~${token("a")}.evento-b~short.evento-c~${token("c")}`)).toEqual([token("c")]);
  });
});

describe("deviceFromUserAgent", () => {
  it("tells a phone from a computer", () => {
    expect(
      deviceFromUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
      ),
    ).toBe("phone");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("phone");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36")).toBe(
      "computer",
    );
    expect(deviceFromUserAgent(null)).toBe("computer");
  });
});

describe("isSafeInternalPath", () => {
  it("accepts addresses of this site", () => {
    expect(isSafeInternalPath("/")).toBe(true);
    expect(isSafeInternalPath("/china")).toBe(true);
    expect(isSafeInternalPath("/ao-vivo/proximo")).toBe(true);
    expect(isSafeInternalPath("/assinar?origem=gravacao&utm_campaign=x")).toBe(true);
  });
  it("refuses anything that leaves it", () => {
    expect(isSafeInternalPath("//evil.example")).toBe(false);
    expect(isSafeInternalPath("https://evil.example")).toBe(false);
    expect(isSafeInternalPath("/\\evil.example")).toBe(false);
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalPath("china")).toBe(false);
    expect(isSafeInternalPath("")).toBe(false);
  });
});

describe("normalizeInternalPath / eventSlugFromPath", () => {
  it("folds the spellings of one page together", () => {
    expect(normalizeInternalPath("/lei-15345?utm_source=x")).toBe("/lei-15345");
    expect(normalizeInternalPath("/lei-15345/")).toBe("/lei-15345");
    expect(normalizeInternalPath("/ao-vivo/lei-15345")).toBe("/lei-15345");
    expect(normalizeInternalPath("/china#oferta")).toBe("/china");
    expect(normalizeInternalPath("/")).toBe("/");
  });
  it("finds the event a path is the page of", () => {
    expect(eventSlugFromPath("/lei-15345")).toBe("lei-15345");
    expect(eventSlugFromPath("/ao-vivo/lei-15345?x=1")).toBe("lei-15345");
    expect(eventSlugFromPath("/ao-vivo/masterclass-fertilidade/")).toBe("masterclass-fertilidade");
    expect(eventSlugFromPath("/china")).toBeNull();
    expect(eventSlugFromPath("/ao-vivo/ab")).toBeNull();
  });
});

describe("normalizeChannel", () => {
  it("spells a channel like the database does", () => {
    expect(normalizeChannel("Instagram")).toBe("instagram");
    expect(normalizeChannel("meta ads!")).toBe("metaads");
    expect(normalizeChannel("a".repeat(40))).toBe("a".repeat(32));
    expect(normalizeChannel("")).toBe("direto");
    expect(normalizeChannel(null)).toBe("direto");
    expect(normalizeChannel("¡¿")).toBe("direto");
  });
});

describe("eventDaypart", () => {
  it("names the part of the day in Brasília time", () => {
    expect(eventDaypart("2026-10-08T23:00:00Z")).toBe("Uma noite"); // 20:00 in Brasília
    expect(eventDaypart("2026-10-08T17:00:00Z")).toBe("Uma tarde"); // 14:00
    expect(eventDaypart("2026-10-08T12:00:00Z")).toBe("Uma manhã"); // 09:00
    expect(eventDaypart(null)).toBe("Um encontro");
    expect(eventDaypart("nope")).toBe("Um encontro");
  });
});

describe("topics", () => {
  it("keeps well-formed items, at most three", () => {
    const topics = readEventTopics([
      { icon: "lei", text: "A" },
      { icon: "nope", text: "B" },
      { icon: "video", text: "  " },
      { icon: "livro", text: "C" },
      { icon: "folha", text: "D" },
      { icon: "grafico", text: "E" },
    ]);
    expect(topics.map((item) => item.text)).toEqual(["A", "C", "D"]);
    expect(readEventTopics("nope")).toEqual([]);
  });
  it("counts in words", () => {
    expect(topicsCountLabel(1)).toBe("um assunto");
    expect(topicsCountLabel(3)).toBe("três assuntos");
  });
});
