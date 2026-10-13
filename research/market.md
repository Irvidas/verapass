# Verapass market and problem evidence

Research date: 2026-10-08. Scope: the problem (AI fakes, fake reviews, scams), the market (Phuket, Thailand, global) and comparable products, then TAM/SAM/SOM for Verapass.

How to read the sources:
- "Read" means the page itself was fetched and the figure checked on it.
- "Reported" means the page blocked fetching (HTTP 403) and the figure comes from several matching search-result summaries of that page. Treat these as second-hand until someone opens the page in a browser.
- Phuket figures come from `source/market-stats.md`, which was taken from https://phukettravels.com/stats (Ministry of Tourism and Sports provincial data). Key 2025 Phuket figures were re-checked on that page today.

## 1. The problem in one paragraph

Travellers now plan trips from social feeds and AI tools, and both channels are filling with content made by things that were never there. Platforms remove fake reviews by the hundreds of millions each year. AI personas run travel accounts with tens or hundreds of thousands of followers. AI video and chatbots have sent real people to places that do not exist. Regulators in the US and UK now define a fake review as one by someone who "does not exist" or "did not have actual experience". Verapass makes "actual experience" checkable: only a verified human can publish a place, and a traveller can only collect it by being there.

## 2. Evidence: fake reviews at scale

| Fact | Figure | Source | Status |
|---|---|---|---|
| Fake reviews blocked by Tripadvisor in 2024 | 2.7 million of 31.1 million submitted (about 8.7%) | [Hospitalitynet, Tripadvisor 2025 Transparency Report, 2025-03-18](https://www.hospitalitynet.org/news/4126305.html) | Read |
| AI-generated reviews removed by Tripadvisor in 2024 | 214,000 | same | Read |
| Share of Tripadvisor fraud that was "review boosting" by the business or its staff | 54% | same | Read |
| Reviews removed for employee incentive schemes | 360,000; about 9,000 businesses warned | same | Read |
| Policy-violating reviews removed by Google Maps in 2024 | more than 240 million (40% more than 2023), plus 12 million+ fake Business Profiles and 70 million+ bad place edits | [9to5Google, 2025-04-07](https://9to5google.com/2025/04/07/google-maps-fake-reviews/) | Read |
| Same, for 2025 | 292 million reviews, 13 million fake Business Profiles, 79 million edits | [Search Engine Roundtable, 2026-04-17](https://www.seroundtable.com/google-maps-spam-fighting-2025-41176.html) | Read |

Regulation is moving toward "proof of actual experience":
- US FTC final rule (announced 2024-08-14, effective 2024-10-21) bans reviews and testimonials that "misrepresent that they are by someone who does not exist, such as AI-generated fake reviews, or who did not have actual experience with the business", and allows civil penalties against knowing violators. [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials) (Read). Law-firm summaries cite up to about $52,000 per violation ([Hunton](https://hunton.com/hunton-retail-law-resource/ftc-issues-final-rule-targeting-fake-consumer-reviews-and-testimonials-including-those-generated-by-artificial-intelligence-ai-and-online-bots), Reported).
- UK: the Digital Markets, Competition and Consumers Act 2024 bans fake reviews from 2025; the CMA published guidance in April 2025 and after a grace period found more than half of 100+ reviewed business websites lacked a compliant fake-review policy. [Greenberg Traurig, 2025-07](https://www.gtlaw.com/en/insights/2025/7/uk-competition-and-markets-authority-enforces-ban-on-fake-reviews) (Reported).
- EU: the Omnibus Directive (in force since 2022-05-28) bans claiming reviews come from real customers without "reasonable and proportionate steps" to verify that. [Makeinfluence summary](https://www.makeinfluence.com/en/academy/fake-and-manipulated-reviews-what-the-eu-omnibus-directive-bans) (Reported).

Why this matters for Verapass: each check-in is a signed, location-bound record from a verified person. That is the "reasonable step to verify" these rules ask for, built into the product instead of added by moderators afterwards.

## 3. Evidence: AI personas and AI-made places

AI travel influencers (named cases):
- Emma, an AI influencer launched by the German National Tourist Board on 2024-10-17, "intentionally designed to make her appear authentic and trustworthy". [Skift](https://skift.com/2024/10/17/meet-the-new-face-of-german-tourism-the-ai-travel-influencer-named-emma/) (Read)
- The New York Times (2025-12-09, republished by The Star) profiled AI travel personas: Qatar Airways' AI persona Sama (328,000 followers), Emma (29,600 followers) and Radhika (about 7,500 followers, north-east India). It notes followers sometimes do not realise the accounts are AI. [The Star](https://www.thestar.com.my/tech/tech-news/2025/12/17/these-travel-influencers-dont-want-freebies-theyre-ai) (Read)
- Mia Zelu, a fully AI-generated Instagram persona, gained 160,000+ followers from Wimbledon posts in July 2025 (Reported, via search summaries; not travel-specific but shows how easily "I was there" content is faked).

Places that do not exist:
- July 2025, Malaysia: an AI-generated "news report" about a "Kuak SkyRide" cable car in Kuak Hulu, Perak, sent an elderly couple on a 4.5-hour drive from Kuala Lumpur to an attraction that never existed. Other victims reportedly spent about USD 1,600 on travel. [The Standard HK, 2025-07-12](https://www.thestandard.com.hk/world/article/306539/AI-generated-fake-tourism-video-lures-Malaysian-couple-on-wild-goose-chase) (Read)
- Greetwell survey (August 2026, 1,000 US adults, 485 had used AI for trip planning): 16% were sent to "a place, tour, or activity that doesn't exist"; 55% hit at least one bad AI travel recommendation; 21% said their trust in AI fell afterwards. [Tripprof summary](https://tripprof.com/en/blog/ai-travel-hallucination-survey/) (Read; the summary cites Greetwell as the survey owner)
- AI use in travel planning rose from 15% to 25% in a year according to Deloitte's 2026 travel research (Reported, via the same coverage; primary Deloitte page not read).

Platforms are reacting: Instagram announced it will limit reach of accounts featuring AI-generated people that do not use its "AI-generated profile" label ([TechRepublic](https://techrepublic.com/article/news-instagram-ai-generated-profile-label-recommendations/), Reported; date not confirmed).

## 4. Evidence: traveller trust and how people plan

- 61% of travellers find trip ideas on social platforms (up from 35% in 2022); 73% say influencer recommendations have influenced a booking. Expedia Group Traveler Value Index 2025, 11,000 adults in 11 markets (AU, BR, CA, CN, FR, DE, IT, JP, MX, UK, US), fieldwork Feb-Mar 2025. [Hospitalitynet](https://www.hospitalitynet.org/news/4127293.html) (Read)
- Icelandair survey (April 2025): more than three in four respondents worry about fake or AI-generated reviews when researching travel; 33% felt deceived by travel listings because of edited or misleading imagery. [Arctic Today](https://www.arctictoday.com/icelandair-survey-finds-ai-tourism-facing-backlash-as-consumer-sentiment-sours) (Read, partly paywalled; search summaries give the figures as 78% worried and 57% finding it harder to trust online content, sample 4,000, Reported)
- Typeform survey (published 2025-05-29, 1,300 respondents): 71% of consumers regret purchases made on influencer recommendations; only one in three believe influencers really use what they promote; 35% distrust AI-generated influencer content; 61% want influencers to disclose AI use. [Net Influencer](https://www.netinfluencer.com/71-percent-of-consumers-regret-influencer-driven-purchases-as-trust-gap-widens/) (Read)

The tension: travellers rely on creators more than ever and trust them less than ever. Verapass sits in that gap.

## 5. Evidence: scams and fake guides in Thailand and Phuket

- Phuket scam calls and online fraud: 1,365 victims and B10.9 million losses (2022), 3,538 victims and B18.8 million (2023), 5,510 victims and B413 million (2024), per Pol Col Kritsada Manawongsakun, TCSD Region 5, reported by The Phuket News. [Phuket News](https://www.thephuketnews.com/dont-be-duped-scam-calls-cost-phuket-b413mn-in-one-year-95415.php) (Reported; page returned 403. Note: these are all residents and visitors combined, not tourists only.)
- Phuket jet ski crackdown began 2026-07-15 after the Deputy Minister of Transport "received complaints about jet ski services"; 23 offenders fined on day one; stated aim is to "reduce exploitation of tourists". [Nation Thailand](https://www.nationthailand.com/news/40068686) (Read)
- Department of Tourism inspections, January-June 2026: 1,225 tour guides inspected, 129 violations, including "working without a valid tour guide license" and not displaying an official guide ID card. [Pattaya Mail, 2026-08-06](https://www.pattayamail.com/thailandnews/illegal-tours-fake-guides-unearthed-in-thailand-tourism-inspections-560182) (Read)
- Registered tour guides in Thailand: 70,655 as of 2017-06-30 (46,880 general, 19,154 area-specific). [Bangkok Post via PressReader, 2017](https://www.pressreader.com/thailand/bangkok-post/20170717/281595240580316) (Reported; old figure, no newer public total found)

Relevance: in Thailand, "is this guide real and licensed?" is already a law-enforcement question. A guide licence is a natural anchor for Verapass creator verification.

## 6. Market size inputs

Phuket 2025 (Ministry of Tourism and Sports via [phukettravels.com/stats](https://phukettravels.com/stats), Read):
- 14,248,853 total visitors (13,042,914 overnight, 1,205,939 same-day); 10,748,204 foreign (75.4%).
- Average spend 8,563 THB (about $255) per person per day; tourism revenue 555,428 million THB (about $16.5B).
- Top foreign markets: Russia 1,748,249; China 1,285,894; India 1,029,588; UK 762,815; Australia 628,551; Germany 571,661.
- Peak month December (1,026,381 foreign arrivals in 2025), low June (692,365).

Thailand 2025 (Ministry of Tourism and Sports year-end summary, 2026-01-01, via [Asia News Network](https://asianews.network/thailand-tourism-slips-in-2025-despite-domestic-growth/), Read):
- 32,974,321 foreign arrivals (down 7.23%); international tourism revenue 1,536,574 million THB; total tourism revenue 2,703,335 million THB.
- Records: India 2,487,319; Russia 1,898,837; UK 1,083,162; Germany 965,898; France 816,935.

Global:
- 1.52 billion international tourist arrivals in 2025 (+4%); Asia-Pacific 331 million; international tourism receipts about $1.9 trillion. UN Tourism Barometer via [TravelMole, 2026-01-21](https://travelmole.com/news/global-tourism-2025-un-tourism) (Read)
- Travel experiences (tours, activities, attractions): $271B in 2025, projected $342B by 2029, 8% nominal CAGR 2023-2029 vs 5% for travel overall; 33% of 2025 bookings online; online share rising from 17% (2019) to a projected 42% (2029). Arival and Phocuswright, "The Outlook for Travel Experiences 2019-2029". [TravelDailyNews](https://www.traveldailynews.com/statistics-trends/global-experiences-market-projected-to-reach-342bn-by-2029/), [ITIJ](https://www.itij.com/latest/news/global-travel-experiences-market-set-reach-342bn-2029-says-new-report) (Reported; all coverage pages returned 403, figures consistent across several summaries). The earlier edition (published 2022-11-15) put 2019 at $253B, which was Read on [Hospitality News](https://hospitalitynewsmag.com/?p=30202).
- Travel creator spend: one report summary says travel and hospitality brands spend $3.4B a year on creator partnerships ([Stay22 report](https://stay22.com/travel-industry-report), Reported; methodology not checked, do not use in the pitch without opening it).
- Virtual (AI) influencer market estimates for 2025 range from $6B to $11B across commercial research firms (Reported, low-quality sources with inconsistent figures; use only as "a multi-billion market is being built on synthetic personas", never as a headline number).

Not found: a public figure for the Thailand or Phuket tours-and-activities market, and a current count of TAT-licensed guides. Klook reported expecting 2 million+ Thailand package bookings in a year (Bangkok Post, Reported; date not confirmed).

## 7. Comparable products

| Product | What it proves | Public numbers | Lesson for Verapass | Source |
|---|---|---|---|---|
| Pokemon Go (Niantic games, sold to Scopely) | Location-based play gets people to physically go places | Niantic games: 30M+ MAU, 20M+ weekly players, $1B+ revenue in 2024; Pokemon Go 100M+ unique players in 2024; sale valued at $3.5B (2025-03-13) | People will travel to a point to "collect" it; location check-in is a mass-market behaviour | [Geek Culture](https://geekculture.co/pokemon-go-amp-more-niantic-games-sold-to-monopoly-go-maker-scopely-for-usd-3-5-billion) (Read) |
| Polarsteps | Travellers want a record of where they actually went | 20M users (2026-03-27); 15M in 2025; 5M in 2022; 1M in 2019; 25M tracked trips (Aug 2026) | Strong demand for an automatic travel log; Polarsteps does not verify creators or places | [Polarsteps news](https://www.polarsteps.com/news/20-million-travelers-and-counting-tech-success-story-polarsteps-celebrates-its-fast-growing-community) (Read) |
| Visited | Self-reported "countries visited" maps | 1.65M users (2023-04-27) | Self-reporting is popular but unverifiable; Verapass adds proof | [AAP / GlobeNewswire](https://www.aap.com.au/aapreleases/globenewswire8825701/) (Read) |
| Been | Self-reported visited-countries map | 1M+ Google Play installs | Same as Visited | [AppBrain](https://www.appbrain.com/dev/Simple+Apps+You+Love/) (Reported) |
| Foursquare Swarm | Social check-ins and lifetime check-in stats | Foursquare City Guide sunset in 2024, merged into Swarm. No current user number confirmed | Check-ins without a reward or trust purpose faded; the data value moved to B2B | [Wikipedia](https://en.wikipedia.org/wiki/Foursquare_Swarm) (Read) |
| POAP (Proof of Attendance Protocol) | On-chain attendance badges | 7.5M+ POAPs minted by 45,000+ issuers (early 2026); maintenance mode from 2026-03-16; founder announced full wind-down 2026-08-03 citing sustainability | Proof-of-attendance without a business model died. Verapass pairs proof with card payments (Stripe) and paid creators from day one | [IQ.wiki](https://iq.wiki/wiki/poap) (Read) |

POAP is the most important comp to be honest about in an SCF application: reviewers will know it. The pitch should say plainly why Verapass is different (verified human creators, revenue from travellers by card, a specific destination with a real guide) rather than ignore it.

## 8. TAM, SAM, SOM

Unit of revenue (assumption A1): $19 per traveller for a destination passport plus guide content. This is the current launch price of Sukanya's eBook "Phuket Without the Tourist Traps" on the original landing page (shown as $19, struck-through $29). It is a price anchor, not tested demand.

All figures are gross traveller payments before Stripe fees and before the creator's share. They count passport sales only; experience bookings are treated separately in 8.4.

### 8.1 Phuket (pilot)

| Layer | Definition | Calculation | Result |
|---|---|---|---|
| TAM | Every 2025 foreign visitor buys one passport | 10,748,204 x $19 | $204.2M per year |
| SAM | Foreign visitors from markets where an English-only product is usable (India, UK, Australia, Germany), who plan from social media | (1,029,588 + 762,815 + 628,551 + 571,661 = 2,992,615) x 61% x $19 | 1,825,495 people, $34.7M per year |
| SOM, year 1 | 0.2% of SAM | 3,651 passports x $19 | about $69k |
| SOM, year 2 | 1% of SAM | 18,255 x $19 | about $347k |
| SOM, year 3 | 3% of SAM | 54,765 x $19 | about $1.04M |

Assumptions:
- A2: English-usable markets = the four of the top six Phuket source markets that are not Russia or China. Russia (1.75M) and China (1.29M) are excluded until the app is translated; they are the obvious SAM expansion.
- A3: The 61% social-media planning share comes from Expedia's 11-market survey, which covers UK, Australia and Germany but not India. Applying it to India is an assumption.
- A4: Adoption rates of 0.2%, 1% and 3% of SAM are planning assumptions, not measured. For scale: 3,651 passports in year 1 is about 10 a day across Phuket, distributed through one flagship creator's channels. Validate with the first 90 days of sales before quoting year 2 or 3.

### 8.2 Thailand (next)

| Layer | Definition | Calculation | Result |
|---|---|---|---|
| TAM | Every 2025 foreign arrival buys one passport | 32,974,321 x $19 | $626.5M per year |
| SAM | English-usable record markets (India, UK, Germany) who plan from social media | (2,487,319 + 1,083,162 + 965,898 = 4,536,379) x 61% x $19 | 2,767,191 people, $52.6M per year |
| SOM at 1% of SAM | | 27,672 x $19 | about $526k |
| SOM at 3% of SAM | | 83,016 x $19 | about $1.58M |

Assumptions:
- A5: One passport per traveller per trip; multi-destination trips (Phuket plus Bangkok plus Chiang Mai) could mean more than one passport. Not modelled.
- A6: Australia and US arrivals for all of Thailand were not in the sources read, so the Thailand SAM leaves them out and is understated.

### 8.3 Global

| Layer | Definition | Calculation | Result |
|---|---|---|---|
| TAM (passport lens) | Every 2025 international tourist buys one $19 passport | 1.52B x $19 | $28.9B per year |
| Asia-Pacific slice | Same, Asia-Pacific arrivals | 331M x $19 | $6.3B per year |
| TAM (experiences lens) | Global tours, activities and attractions | Arival/Phocuswright 2025 | $271B (reported) |
| Online share of experiences | 33% of 2025 bookings online | $271B x 33% | about $89B (reported inputs) |

The passport lens is the honest near-term market. The experiences lens is where verified creators earn later: if a traveller trusts a verified guide's places, the next step is booking that guide's tour. That is a large, still mostly offline, fast-growing market (8% CAGR vs 5% for travel overall).

### 8.4 Upside not in the SOM (illustrative only)

Verified experience bookings through creators, using placeholder assumptions: if 20% of passport holders book one creator experience at an assumed $50 with an assumed 15% platform take, that adds $1.50 per passport sold. These three numbers are placeholders with no source and must not appear in the pitch as fact.

## 9. Why now, in five facts

1. Fake content is measured in the hundreds of millions: Google removed 292M reviews in 2025; Tripadvisor already removes AI-written reviews (214,000 in 2024).
2. AI is now inventing places people drive to (Kuak Hulu, July 2025) and 16% of AI trip-planner users in one 2026 survey were sent somewhere that does not exist.
3. Law is converging on "actual experience" as the test of a real review (FTC 2024, UK DMCCA 2025, EU Omnibus).
4. Travellers still plan from creators (61% find ideas on social, 73% influenced by influencers) while trust falls (71% regret influencer-driven purchases).
5. Phuket alone had 10.7M foreign visitors and about $16.5B tourism revenue in 2025, and Thailand is actively policing unlicensed guides and tourist exploitation.

## 10. Gaps and caveats

- Arival/Phocuswright experience figures, the Phuket News scam figures and the UK CMA figures are second-hand (403 on fetch). Open them in a browser before putting them on a slide.
- No sourced figure for Thailand or Phuket tours-and-activities spend; the passport model avoids needing one.
- The 2017 guide count is old; ask the Department of Tourism or the Phuket guide association for a current number.
- All adoption rates and the $19 price are assumptions; the eBook's real sales history (if the founders have it) is the best evidence to replace A1 and A4.
