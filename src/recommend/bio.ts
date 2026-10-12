// A fallback for members who have not picked any topic interests but did write a bio.
// Deliberately simple keyword matching: it only ever produces a weak, clearly labeled
// signal. In production this would be an embedding or model-based extraction.

const BIO_TOPIC_HINTS: [pattern: RegExp, topicSlug: string][] = [
  [/career break|return(ing)? to work|after (parental |maternity )?leave/i, "career-breaks"],
  [/first[- ]time manager|new manager|managing (a|my) team/i, "managing-a-team"],
  [/leadership/i, "leadership-skills"],
  [/mentor|sponsor/i, "sponsorship-mentorship"],
  [/negotiat|pay equity|salary|comp(ensation)? conversation/i, "negotiation"],
  [/promot|next level/i, "getting-promoted"],
  [/confiden/i, "confidence"],
  [/public speaking|executive presence|presenting/i, "public-speaking"],
  [/imposter|impostor/i, "imposter-syndrome"],
  [/burnout|burned out/i, "stress-burnout"],
  [/networking/i, "networking"],
];

/** Topic slugs a bio points to. Empty when there is no bio or nothing recognizable in it. */
export function inferTopicsFromBio(bio: string | null): string[] {
  if (!bio) return [];
  return BIO_TOPIC_HINTS.filter(([pattern]) => pattern.test(bio)).map(([, slug]) => slug);
}
