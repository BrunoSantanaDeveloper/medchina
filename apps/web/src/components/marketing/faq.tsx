"use client";
import Link from "next/link";

import { Accordion, AccordionDetails, AccordionSummary, Button, Typography } from "@mui/material";

import JsonLd from "@/components/marketing/json-ld";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";

export type FaqItem = { question: string; answer: string };

/**
 * Funnel stage: objection handling. Each question should be a REAL purchase
 * objection (price, migration, security, lock-in), answered plainly.
 *
 * Emits FAQPage structured data from the same `items` — an eligible rich
 * result and a strong AI-search signal, with nothing for the page to remember.
 *
 * `layout="split"` (blueprint §24): sticky intro column (eyebrow, title,
 * subtitle, CTA link) beside the accordion list — the home treatment; "stack"
 * keeps the classic centered list for quieter pages.
 */
export default function Faq({
  eyebrow,
  title,
  subtitle,
  items,
  id,
  layout = "stack",
  link,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  items: FaqItem[];
  id?: string;
  layout?: "stack" | "split";
  /** Split layout only: conversion link under the intro (repeats the page CTA). */
  link?: { label: string; href: string };
}) {
  const accordions = (
    <Reveal className="flex w-full flex-col gap-2">
      {items.map((item) => (
        <Accordion
          key={item.question}
          elevation={0}
          disableGutters
          className="border-grey-100 bg-background-paper rounded-2xl! border"
        >
          <AccordionSummary expandIcon={<NiChevronDownSmall />} className="px-6! py-4!">
            <Typography component="h3" variant="subtitle1">
              {item.question}
            </Typography>
          </AccordionSummary>
          <AccordionDetails className="px-6! pt-0! pb-6!">
            <Typography variant="body1" className="text-text-secondary leading-6">
              {item.answer}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </Reveal>
  );

  if (layout === "split") {
    return (
      <Section id={id}>
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: items.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          }}
        />
        <div className="grid grid-cols-1 items-start gap-10 md:grid-cols-[0.6fr_1fr] md:gap-16">
          <div className="md:sticky md:top-28">
            <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} align="start" className="mb-0 md:mb-0" />
            {link && (
              <Button variant="pastel" color="primary" href={link.href} LinkComponent={Link} className="mt-6">
                {link.label}
              </Button>
            )}
          </div>
          {accordions}
        </div>
      </Section>
    );
  }

  return (
    <Section id={id}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: { "@type": "Answer", text: item.answer },
          })),
        }}
      />
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <div className="mx-auto w-full max-w-3xl">{accordions}</div>
    </Section>
  );
}
