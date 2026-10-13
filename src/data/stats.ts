/**
 * Every number on the page comes from here, with the page it was read from.
 * Sources: research/market.md and source/market-stats.md.
 */
export interface Source {
  label: string
  url: string
}

export interface ProblemStat {
  value: number
  /** How to print the counter: prefix/suffix and decimals. */
  prefix?: string
  suffix?: string
  decimals?: number
  headline: string
  detail: string
  source: Source
}

export const PROBLEM_STATS: ProblemStat[] = [
  {
    value: 2.7,
    suffix: 'M',
    decimals: 1,
    headline: 'fake reviews blocked by Tripadvisor in 2024',
    detail: 'Out of 31.1M submitted. 214,000 of them were written by AI.',
    source: { label: 'Tripadvisor Transparency Report, via Hospitality Net', url: 'https://www.hospitalitynet.org/news/4126305.html' },
  },
  {
    value: 292,
    suffix: 'M',
    headline: 'reviews removed from Google Maps in 2025',
    detail: 'Plus 13M fake Business Profiles taken down in the same year.',
    source: { label: 'Google, via Search Engine Roundtable', url: 'https://www.seroundtable.com/google-maps-spam-fighting-2025-41176.html' },
  },
  {
    value: 16,
    suffix: '%',
    headline: 'of AI trip-planner users were sent somewhere that does not exist',
    detail: 'A place, tour or activity. 55% hit a bad AI recommendation.',
    source: { label: 'Greetwell survey, Aug 2026, 1,000 US adults', url: 'https://tripprof.com/en/blog/ai-travel-hallucination-survey/' },
  },
  {
    value: 73,
    suffix: '%',
    headline: 'say an influencer recommendation influenced a booking',
    detail: '61% now find trip ideas on social platforms, up from 35% in 2022.',
    source: { label: 'Expedia Traveler Value Index 2025, 11,000 adults', url: 'https://www.hospitalitynet.org/news/4127293.html' },
  },
  {
    value: 71,
    suffix: '%',
    headline: 'regret a purchase an influencer pushed them into',
    detail: '35% say they distrust AI-generated influencer content.',
    source: { label: 'Typeform, May 2025, 1,300 respondents', url: 'https://www.netinfluencer.com/71-percent-of-consumers-regret-influencer-driven-purchases-as-trust-gap-widens/' },
  },
]

export const PROBLEM_STORIES: { kicker: string; text: string; source: Source }[] = [
  {
    kicker: 'July 2025',
    text: "An AI-generated news video of a cable car called 'Kuak SkyRide' sent an elderly Malaysian couple on a 4.5-hour trip to an attraction that never existed.",
    source: { label: 'The Standard', url: 'https://www.thestandard.com.hk/world/article/306539/AI-generated-fake-tourism-video-lures-Malaysian-couple-on-wild-goose-chase' },
  },
  {
    kicker: 'On purpose',
    text: "Tourism brands now run AI influencers. Germany's 'Emma' launched in October 2024. Qatar Airways' 'Sama' has 328,000 followers, and some followers don't realise she is AI.",
    source: { label: 'Skift; NYT via The Star', url: 'https://www.thestar.com.my/tech/tech-news/2025/12/17/these-travel-influencers-dont-want-freebies-theyre-ai' },
  },
  {
    kicker: 'Regulators noticed',
    text: "The US FTC now bans reviews by someone who 'does not exist, such as AI-generated fake reviews, or who did not have actual experience with the business'.",
    source: { label: 'FTC final rule, effective Oct 2024', url: 'https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials' },
  },
  {
    kicker: 'In Thailand',
    text: "Inspectors checked 1,225 tour guides between January and June 2026 and found 129 violations, including people working without a valid licence.",
    source: { label: 'Pattaya Mail', url: 'https://www.pattayamail.com/thailandnews/illegal-tours-fake-guides-unearthed-in-thailand-tourism-inspections-560182' },
  },
]

export const PHUKET_SOURCE: Source = {
  label: 'Thailand Ministry of Tourism and Sports, via phukettravels.com/stats',
  url: 'https://phukettravels.com/stats',
}

export const PHUKET_2025 = {
  visitors: 14_248_853,
  foreignVisitors: 10_748_204,
  revenueUsdBillions: 16.5,
  revenueThbMillions: 555_428,
  dailySpendUsd: 255,
  dailySpendThb: 8_563,
  occupancyPct: 76.3,
}

export const TOP_MARKETS_2025: { country: string; visitors: number; share: number }[] = [
  { country: 'Russia', visitors: 1_748_249, share: 17.3 },
  { country: 'China', visitors: 1_285_894, share: 12.8 },
  { country: 'India', visitors: 1_029_588, share: 10.2 },
  { country: 'UK', visitors: 762_815, share: 7.6 },
  { country: 'Australia', visitors: 628_551, share: 6.2 },
  { country: 'Germany', visitors: 571_661, share: 5.7 },
]

/** Total visitors, selected years only (the source page lists these). */
export const VISITOR_HISTORY: { year: number; visitors: number }[] = [
  { year: 2012, visitors: 8_829_298 },
  { year: 2019, visitors: 14_576_466 },
  { year: 2020, visitors: 4_028_829 },
  { year: 2021, visitors: 1_236_480 },
  { year: 2025, visitors: 14_248_853 },
]

export const GLOBAL_CONTEXT: { value: string; label: string; source: Source }[] = [
  {
    value: '1.52B',
    label: 'international arrivals worldwide in 2025, 331M of them in Asia-Pacific',
    source: { label: 'UN Tourism, via TravelMole', url: 'https://travelmole.com/news/global-tourism-2025-un-tourism' },
  },
  {
    value: '32.97M',
    label: 'foreign arrivals in Thailand in 2025',
    source: { label: 'Asia News Network', url: 'https://asianews.network/thailand-tourism-slips-in-2025-despite-domestic-growth/' },
  },
  {
    value: '20M',
    label: 'travellers on Polarsteps, a trip-tracking app, in March 2026',
    source: { label: 'Polarsteps', url: 'https://www.polarsteps.com/news/20-million-travelers-and-counting-tech-success-story-polarsteps-celebrates-its-fast-growing-community' },
  },
]
