// Every caption in the world. First person, plain, facts only.
// Where each fact comes from, and what I still have to confirm, lives in notes.ts. Nothing here may
// import it: this file ships, that one does not.
import type { DistrictId, Entry } from '../types';

export const SITE = {
  title: 'Long Sunday',
  subtitle: 'A walk through the work of Dervin Dimanche',
  intro:
    'I recruit the people who build AI, and I build things to understand what they are building. This is both halves of that, laid out as a place you can walk through.',
  nameNote: 'Dimanche is French for Sunday.',
  hint: 'Follow the road uphill for the career, in order. The side roads lead to my experiments, and one leads to the life outside work.',
  email: 'dervindim@gmail.com',
  github: 'https://github.com/DervinEvolve',
  githubLabel: 'github.com/DervinEvolve',
} as const;

export const ENTRIES: Entry[] = [
  // ------------------------------------------------------------------------------------ Trailhead
  {
    id: 'about',
    district: 'trailhead',
    kind: 'origin',
    title: 'Start here',
    blurb:
      "Hi, I'm Dervin. Technologist, traveler, community builder and people person from New York City.",
    bullets: [
      'Nine years in technical recruiting, from a staffing desk to an AI lab.',
      'The same nine years spent building things on the side to see how they work.',
      'The road ahead runs uphill in date order. The side roads lead to my experiments, shipped and failed, and one leads to the life outside work.',
    ],
    links: [
      { label: 'GitHub', url: 'https://github.com/DervinEvolve' },
      { label: 'Email me', url: 'mailto:dervindim@gmail.com' },
    ],
  },
  {
    id: 'elms',
    district: 'trailhead',
    kind: 'origin',
    title: 'Two degrees, one bell tower',
    org: 'College of Our Lady of the Elms',
    dates: '2017',
    blurb:
      'I finished two bachelor of science degrees at the same time: Computer Information Sciences and Marketing. One for the machines, one for the people. That split never went away.',
  },
  {
    id: 'languages',
    district: 'trailhead',
    kind: 'origin',
    title: 'Hello, Bonjou, Bonjour',
    blurb: 'I speak English, Haitian Creole and French. My family is from Ayiti.',
  },
  {
    id: 'camera',
    district: 'trailhead',
    kind: 'thread',
    status: 'retired',
    title: 'Retired portrait shooter',
    dates: '2016 to 2022',
    blurb:
      'Before any of this I shot portraits. My last gallery was a series collected during a time of global protests. I put the camera down afterwards.',
  },

  // ---------------------------------------------------------------------------------- Switchboard
  {
    id: 'tek-recruiter',
    district: 'switchboard',
    kind: 'role',
    title: 'Technical Recruiter',
    org: 'TEKsystems, New York',
    dates: 'Apr 2017 to Mar 2019',
    blurb:
      'My first desk. I learned the job on the phone, matching engineers to teams one call at a time.',
    bullets: [
      'Recruited frontend, backend, full-stack and infrastructure engineers for digital, fintech and enterprise technology clients.',
      'Led sourcing drives and hiring events for major financial services accounts including JPMC and American Express.',
      'Built candidate pipelines across JavaScript, Java, .NET, cloud, QA, DevOps and enterprise application development roles.',
    ],
  },
  {
    id: 'tek-am',
    district: 'switchboard',
    kind: 'role',
    title: 'Account Manager',
    org: 'TEKsystems, New York',
    dates: 'Mar 2019 to Oct 2019',
    blurb:
      'I moved to the other side of the table and ran a full desk, selling the work and then filling it.',
    bullets: [
      'Managed full-cycle client relationships across technology staffing accounts.',
      'Established staffing partnerships and supported placements with clients including Uber, Adobe, HackerOne and Anheuser-Busch.',
      'Won technology services opportunities with Anheuser-Busch.',
    ],
  },

  // -------------------------------------------------------------------------------------- Commons
  {
    id: 'meta-sourcer',
    district: 'commons',
    kind: 'role',
    title: 'Technical Sourcer',
    org: 'Meta, Cambridge MA',
    dates: 'Oct 2019 to Jul 2021',
    blurb:
      'I sourced software engineers for generalist hiring across the East Coast, at volume, from new graduates to senior staff.',
    bullets: [
      'Sourced software engineering talent across L3 to L6.',
      'Built and managed high-volume pipelines across backend, frontend, full-stack, mobile and infrastructure profiles.',
    ],
  },
  {
    id: 'interview-prep',
    district: 'commons',
    kind: 'role',
    title: 'More than 160 a month',
    org: 'Meta',
    dates: '2019 to 2021',
    blurb:
      'I expanded an interview preparation initiative to more than 160 attendees a month. Candidates who know what the screen looks like do better on it.',
    bullets: ['Improved candidate readiness and top-of-funnel screen success.'],
  },
  {
    id: 'black-at-boston',
    district: 'commons',
    kind: 'thread',
    title: 'Black@Boston',
    org: 'Meta, Cambridge office',
    dates: '2019 to 2021',
    blurb:
      'I founded the Black@Boston employee resource group at the Cambridge office.',
    bullets: [
      'Collaborated monthly with the Black employee groups at Google and at Microsoft in Cambridge.',
      'Hosted fireside chats with influencers and authors.',
    ],
  },
  {
    id: 'hackathon',
    district: 'commons',
    kind: 'thread',
    title: "The first Black@ hackathon",
    org: 'Meta',
    blurb:
      "I co-led Meta's first Black@ hackathon.",
  },

  // ------------------------------------------------------------------------------------- Terraces
  {
    id: 'google-recruiter',
    district: 'terraces',
    kind: 'role',
    title: 'Senior Technical Recruiter',
    org: 'Google Cloud',
    dates: 'Jul 2021 to Jun 2023',
    blurb:
      'I was the primary recruiting contact for seven Google Cloud teams.',
    bullets: [
      'Cloud Center of Excellence, AI Industry Solutions, Managed Infrastructure, Sovereign Cloud, Conversational AI, Applied AI and ML Learning Solutions.',
      'Partnered with hiring leaders to refine evaluation criteria and improve hiring committee rubrics.',
    ],
  },
  {
    id: 'sovereign-vault',
    district: 'terraces',
    kind: 'role',
    title: 'The vault',
    org: 'Google Cloud, Sovereign Cloud',
    dates: '2021 to 2023',
    blurb:
      'Some of the hiring was for cleared technical teams, including roles that required TS/SCI clearance and Full Scope Polygraph eligibility. The door stays shut. That is the point of it.',
  },
  {
    id: 'l7-l8',
    district: 'terraces',
    kind: 'role',
    title: 'The top of the ladder',
    org: 'Google Cloud',
    dates: '2021 to 2023',
    blurb:
      'I drove senior technical and product hiring at L7 and L8: Principal Engineers, Principal Product Managers and senior cloud and AI leaders.',
  },
  {
    id: 'committees',
    district: 'terraces',
    kind: 'role',
    title: 'The committee table',
    org: 'Google Cloud, Cloud Center of Excellence',
    dates: '2021 to 2023',
    blurb:
      'I frequently facilitated hiring committees: candidate evaluation, calibration, packet review and the decision at the end.',
  },

  // ---------------------------------------------------------------------------------- Mask Garden
  {
    id: 'diaspora-origin',
    district: 'maskgarden',
    kind: 'role',
    title: 'Founder, Diaspora DAO',
    org: 'Diaspora DAO',
    dates: 'Jan 2023 to May 2024',
    blurb:
      'A research and product studio exploring AI, tokenization, mixed reality and creator-owned digital experiences. It began as a Haiti relief art idea with the artist Isaac Udogwu: Afrofuturist portraits of Haitian historical figures.',
    bullets: [
      'Led product strategy across creator monetization, digital identity, tokenized media and community-owned platforms.',
    ],
  },
  {
    id: 'mask-pass',
    district: 'maskgarden',
    kind: 'experiment',
    status: 'parked',
    title: 'The mask pass',
    org: 'Diaspora DAO',
    blurb:
      'Membership was going to be a mask. Each tier had its own design, inspired by tribal masks, and holding one was your pass into the community.',
    bullets: ['A trip to Cape Verde helped shape the rarities in the collection.'],
  },
  {
    id: 'diaspora-team',
    district: 'maskgarden',
    kind: 'role',
    title: 'A team of six',
    org: 'Diaspora DAO',
    blurb:
      'I recruited and led four engineers and two designers across smart contracts, mobile, web and immersive experience design.',
    bullets: [
      'Luc Succes, technical lead and co-founder.',
      'Jesse Aridoux, website design lead.',
    ],
  },
  {
    id: 'consensus-demo',
    district: 'maskgarden',
    kind: 'experiment',
    status: 'shipped',
    title: 'On stage at Consensus',
    org: 'Consensus by CoinDesk',
    dates: '2023',
    blurb:
      'We built a tokenized video advertising prototype on Solana infrastructure and I demoed it to more than 200 attendees.',
  },
  {
    id: 'consensus-panel',
    district: 'maskgarden',
    kind: 'thread',
    title: 'Black Founders in Crypto',
    org: 'Consensus by CoinDesk',
    dates: '2023',
    blurb:
      'I spoke on the Black Founders in Crypto panel about ownership, emerging technology and access in Web3.',
  },
  {
    id: 'tokenized-video',
    district: 'maskgarden',
    kind: 'experiment',
    status: 'shipped',
    title: 'A film you can buy from',
    org: 'Diaspora DAO',
    dates: '2023',
    blurb:
      'A short film made with Asoko Studio, played in a React media player that let you buy the items in a scene as NFTs while you watched. Luc Succes led the build.',
  },
  {
    id: 'ar-lenses',
    district: 'maskgarden',
    kind: 'experiment',
    status: 'shipped',
    title: 'Doorways',
    org: 'Diaspora DAO',
    blurb:
      'I designed augmented reality experiences in Snap Lens Studio and Meta Spark, turning 3D renders into interactive prototypes. One was a face filter of the DAO membership mask.',
    bullets: [
      'The longer idea was geospatial AR: a layer over the city, in the spirit of Ghost in the Shell.',
    ],
    links: [{ label: 'The mask filter', url: 'https://www.instagram.com/ar/217766077513789/' }],
  },
  {
    id: 'pivot',
    district: 'maskgarden',
    kind: 'experiment',
    status: 'parked',
    title: 'The fork in the path',
    org: 'Diaspora DAO',
    dates: '2023 to 2024',
    blurb:
      'The bear market came and the DAO did not launch the way I drew it. I turned it into a lab and kept the parts that worked: the team habits, the prototypes, the questions.',
  },

  // ---------------------------------------------------------------------------------- Observatory
  {
    id: 'msai-role',
    district: 'observatory',
    kind: 'role',
    status: 'ongoing',
    title: 'Senior Talent Sourcer',
    org: 'Microsoft AI',
    dates: 'Mar 2024 to now',
    blurb:
      'I recruit senior pre-training and post-training researchers, and infrastructure, inference and product talent, for the Microsoft AI Superintelligence teams.',
    bullets: ['I joined after interviewing with a few different AI startups.'],
    links: [{ label: 'Microsoft AI', url: 'https://microsoft.ai/' }],
  },
  {
    id: 'talent-map',
    district: 'observatory',
    kind: 'role',
    status: 'ongoing',
    title: 'Mapping the field',
    org: 'Microsoft AI',
    blurb:
      'I led talent intelligence work: competitor talent mapping and internal capability research, delivered to leadership to shape workforce planning for the lab.',
    bullets: [
      'Built repeatable mapping processes across frontier labs, open-source communities, research groups, GitHub, Hugging Face and adjacent AI infrastructure companies.',
    ],
  },
  {
    id: 'model-teams',
    district: 'observatory',
    kind: 'role',
    status: 'ongoing',
    title: 'Seven orbits',
    org: 'Microsoft AI',
    blurb:
      "I built talent pipelines for the teams working on Microsoft AI's in-house models: pre-training, post-training, multimodal, speech, text, inference and data.",
    links: [{ label: 'The models', url: 'https://microsoft.ai/models/' }],
  },
  {
    id: 'scout',
    district: 'observatory',
    kind: 'role',
    status: 'shipped',
    title: 'The scout',
    org: 'Microsoft AI',
    blurb:
      'I piloted Microsoft Scout in a closed cohort and led its roll out to our recruiting team.',
    links: [
      {
        label: 'About Microsoft Scout',
        url: 'https://www.microsoft.com/en-us/microsoft-365/blog/2026/06/02/introducing-microsoft-scout-your-always-on-personal-agent/',
      },
    ],
  },
  {
    id: 'mayo',
    district: 'observatory',
    kind: 'role',
    status: 'shipped',
    title: 'The clinic lamp',
    org: 'Microsoft AI',
    blurb:
      'I sourced and hired our first Forward Deployed AI Engineers for the collaboration with Mayo Clinic.',
    links: [
      {
        label: 'About the collaboration',
        url: 'https://news.microsoft.com/source/2026/06/02/mayo-clinic-and-microsoft-collaborate-to-develop-a-frontier-ai-model-for-healthcare/',
      },
    ],
  },
  {
    id: 'agent-swarms',
    district: 'observatory',
    kind: 'role',
    status: 'ongoing',
    title: 'Lanterns',
    org: 'Microsoft AI',
    blurb:
      'I led up-skilling sessions for the team on orchestrating swarms of agents to source and map top talent. This is where the two roads become one.',
  },
  {
    id: 'pm-hiring',
    district: 'observatory',
    kind: 'role',
    status: 'shipped',
    title: 'Pages and Tasks',
    org: 'Microsoft AI',
    blurb:
      'I advised product leadership on PM hiring for the teams that shipped Copilot Pages, Tasks and related consumer Copilot experiences.',
    links: [
      {
        label: 'Copilot Tasks',
        url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/2026/02/26/copilot-tasks-from-answers-to-actions/',
      },
      { label: 'Copilot Pages', url: 'https://www.youtube.com/watch?v=oxxqw0E7Io8' },
    ],
  },

  // --------------------------------------------------------------------------------------- Studio
  {
    id: 'backrun',
    district: 'studio',
    kind: 'experiment',
    status: 'live',
    title: 'Backrun',
    dates: 'Nov 2026',
    blurb:
      'A backrun is the hard, cauliflower-shaped edge you get when fresh water touches a drying wash. I built a small watercolour physics model and three painters that try to use the water well: a search, a network that imitates the search, and a language model that writes the strokes.',
    bullets: [
      'The learned painter scores 8.85 on sealed targets. A blank sheet scores 24.02 and the search scores 5.26. Lower is better.',
      'Its first GPU run scored no better than a blank sheet.',
      'The language model painter places the colours of the subject and does not yet draw.',
    ],
    links: [
      { label: 'Open the studio', url: 'https://dervinevolve.github.io/backrun/' },
      { label: 'Code', url: 'https://github.com/DervinEvolve/backrun' },
    ],
  },
  {
    id: 'hon',
    district: 'studio',
    kind: 'experiment',
    status: 'shipped',
    title: 'Hon, a comic creator',
    dates: '2026',
    blurb: 'An AI comic creation platform you can talk to. You describe the page out loud and it gets drawn.',
    links: [{ label: 'Code', url: 'https://github.com/DervinEvolve/Hon-Voice-Native-Canvas' }],
  },
  {
    id: 'memory-visualizer',
    district: 'studio',
    kind: 'experiment',
    status: 'shipped',
    title: 'Memory Visualizer',
    dates: '2026',
    blurb:
      'A web app that turns photos into 3D Gaussian splats. Your photos float as cards in space, and clicking one opens it as a scene you can move through.',
    bullets: ['It answers a question I wrote down in 2023: can we use AI to Gaussian splat memories?'],
    links: [{ label: 'Code', url: 'https://github.com/DervinEvolve/Memory-Visualizer' }],
  },
  {
    id: 'ai-notebook',
    district: 'studio',
    kind: 'thread',
    title: 'The 2023 shelf',
    dates: '2023',
    blurb:
      'In 2023 I kept a notebook of every generative tool I could get my hands on.',
    bullets: [
      'AI Comic Factory, MusicLM, Runway Motion Brush, ElevenLabs, Luma Genie, D-ID, Hume.',
      'Two of those grew into projects of their own: comics and voice.',
    ],
  },
  {
    id: 'talentsniper',
    district: 'studio',
    kind: 'experiment',
    status: 'shipped',
    title: 'TalentSniper',
    blurb:
      'Two custom GPTs I built for sourcing. The first time my day job and my side projects pointed at the same thing.',
    links: [{ label: 'TalentSniper v2', url: 'https://chat.openai.com/g/g-IwS5koX6N-talentsniper-v2' }],
  },
  {
    id: 'collectible-card',
    district: 'studio',
    kind: 'experiment',
    status: 'shipped',
    title: 'My collectible card',
    blurb:
      'A 3D card of me built in Spline, with a Gaussian splat portal cut into it. A business card you can fall into.',
  },

  // ----------------------------------------------------------------------------------- Greenhouse
  {
    id: 'observable-lab',
    district: 'greenhouse',
    kind: 'experiment',
    status: 'shipped',
    title: 'Observable Lab',
    dates: 'Jan to Jul 2026',
    blurb:
      'Five AI models from five labs take turns in five roles: planner, executor, challenger, reviewer and commentator. Together they grow an agent specification, drawn as a plant you can watch.',
    bullets: ['Roles rotate every five epochs, so every model plays every part.'],
    links: [{ label: 'Code', url: 'https://github.com/DervinEvolve/Observable-Lab' }],
  },
  {
    id: 'research-lab',
    district: 'greenhouse',
    kind: 'experiment',
    status: 'ongoing',
    title: 'Research Lab',
    dates: 'Nov 2026',
    blurb:
      'Agents take turns editing one training script, five minutes a try, to make a small model better at writing children\'s stories. They cannot touch the test. Most tries do not make it.',
    bullets: [
      'The best try scored 0.7067 at round 14. Lower is better.',
      'Rounds 44 to 48 crashed or were rolled back.',
    ],
  },
  {
    id: 'tradingos',
    district: 'greenhouse',
    kind: 'experiment',
    status: 'ongoing',
    title: 'TradingOS',
    dates: 'Jun to Aug 2026',
    blurb:
      'A private research workspace where six specialist agents hold their own identities, join rooms, mark up charts together and run simulations while a human watches.',
    bullets: ['By design it cannot route orders. The agents research and annotate. They do not trade.'],
  },

  // ----------------------------------------------------------------------------------- Sky Harbor
  {
    id: 'krill',
    district: 'skyharbor',
    kind: 'experiment',
    status: 'live',
    title: 'Krill',
    dates: 'Nov 2026',
    blurb:
      'A Solana DAO where many small voters outweigh one whale. Quadratic voting with exact integer math, and a milestone escrow that pays contractors one approved step at a time.',
    bullets: [
      'Eleven agents holding 1 SOL each out-vote one agent holding 100 SOL: 347.850 for, 316.227 against.',
      'On my old site the Solana contract page just said: hold that thought. This is the thought.',
    ],
    links: [
      { label: 'Open the arena', url: 'https://dervinevolve.github.io/krill/' },
      { label: 'Code', url: 'https://github.com/DervinEvolve/krill' },
    ],
  },
  {
    id: 'ophanim',
    district: 'skyharbor',
    kind: 'experiment',
    status: 'ongoing',
    title: 'Ophanim',
    dates: 'Dec 2025',
    blurb:
      'A speech-to-speech model I designed for Hon: 92.63 million parameters in seven modules, named for the wheels within wheels. The goal is a first packet of sound in under 300 milliseconds, and the planned stages add up to about 250.',
    bullets: ['The tool-reasoning module, 11 million parameters, validated at 86.4% accuracy on its own.'],
  },
  {
    id: 'ophanim-desktop',
    district: 'skyharbor',
    kind: 'experiment',
    status: 'ongoing',
    title: 'Ophanim Desktop',
    dates: 'Jan 2026',
    blurb: 'A voice-native desktop agent for macOS that runs on fully local models. You talk, it works, nothing leaves the machine.',
  },
  {
    id: 'empathy-archives',
    district: 'skyharbor',
    kind: 'experiment',
    status: 'shipped',
    title: 'Empathy Archives',
    blurb:
      "Built for Microsoft's hackathon. You talk with history by voice, and it listens for how you sound as well as what you say.",
    bullets: [
      'Voice to voice, with emotion-aware responses built on Hume expression detection.',
      'Answers drawn from primary sources, with real-time transcription.',
      'A dial shows the top three tones it hears in your voice.',
    ],
    links: [{ label: 'Open it', url: 'https://empathyarchives.vercel.app/' }],
  },

  // ------------------------------------------------------------------------------------- Boneyard
  {
    id: 'tribe',
    district: 'boneyard',
    kind: 'experiment',
    status: 'failed',
    title: 'Tribe',
    blurb:
      'An iPhone app in Swift that needed the raw depth map from the face scanner. Apple does not let apps read the raw depth data from the Face ID camera. That was the whole idea, so that was the end of it.',
    bullets: ['What I kept: check what the platform will actually give you before you design around it.'],
  },
  {
    id: 'empty-pages',
    district: 'boneyard',
    kind: 'experiment',
    status: 'unfinished',
    title: 'Empty frames',
    blurb:
      'Two pages on my old site have a title and nothing else: Predictions, and AI/Voice/Creation. I hung the frames and never filled them.',
  },
  {
    id: 'ankh',
    district: 'boneyard',
    kind: 'experiment',
    status: 'unfinished',
    title: 'Ankh',
    blurb:
      'Three names on a page about security and privacy: Ankh AR, Ankh Security, and Ankh Lang with a question mark. Names are the easy part.',
  },
  {
    id: 'contracts',
    district: 'boneyard',
    kind: 'experiment',
    status: 'unfinished',
    title: 'Hold that thought',
    blurb:
      'Two blank tablets for the smart contracts I meant to write, one for Solana and one for Ethereum. The page just said: hold that thought.',
    bullets: ['The Solana one did get written. It is Krill, in Sky Harbor.'],
  },
  {
    id: 'seedlings',
    district: 'boneyard',
    kind: 'thread',
    title: 'What grows here',
    blurb:
      'Nothing here was wasted. The question about splatting memories became Memory Visualizer. The contracts became Krill. The 2023 voice experiments became Empathy Archives and then Ophanim.',
  },

  // ------------------------------------------------------------------------------------ Postcards
  {
    id: 'jamaica',
    district: 'postcards',
    kind: 'place',
    title: 'Jamaica',
    blurb:
      'My first time back in the Antilles as an adult. Eight parishes, Strawberry Hill up in the Blue Mountains, and oysters. My family is from Ayiti, and this was as close as I could get.',
  },
  {
    id: 'el-salvador',
    district: 'postcards',
    kind: 'place',
    title: 'El Salvador',
    blurb: 'Bitcoin, volcanoes and open water, from La Libertad to El Tunco beach. A lot of history that many overlook.',
  },
  {
    id: 'cape-town',
    district: 'postcards',
    kind: 'place',
    title: 'Cape Town',
    blurb:
      'My first time in Africa and it completely changed my perspective. Table Mountain, wine country, penguin beach, and paragliding off Lion\'s Head.',
  },
  {
    id: 'lisbon',
    district: 'postcards',
    kind: 'place',
    title: 'Lisbon',
    blurb:
      'A solo stop on the way somewhere else. I am an amateur historian, and this city was a candy store: Moorish architecture, tiles, and a city four centuries older than Rome.',
  },
  {
    id: 'cape-verde',
    district: 'postcards',
    kind: 'place',
    title: 'Cape Verde',
    blurb:
      'Volcanic islands and beach volleyball in São Vicente. The Creole here grew from African and Portuguese roots, where mine grew from African and French. This trip shaped the rarities in the mask collection.',
  },
  {
    id: 'puerto-rico',
    district: 'postcards',
    kind: 'place',
    title: 'Puerto Rico',
    dates: '2024',
    blurb: 'Horseback riding in 2024. On another Caribbean trip, for a wedding, the sea convinced me to learn to swim.',
  },
  {
    id: 'vienna',
    district: 'postcards',
    kind: 'place',
    title: 'Vienna',
    dates: '2024',
    blurb: 'Sightseeing in between sessions at the ICML conference in 2024, where I worked the Microsoft booth.',
  },
  {
    id: 'morocco',
    district: 'postcards',
    kind: 'place',
    title: 'Morocco',
    blurb:
      'Casablanca and its landmark mosque, the Bahia Palace, and a hot air balloon over the Agafay Desert.',
  },
  {
    id: 'tokyo',
    district: 'postcards',
    kind: 'place',
    title: 'Tokyo',
    blurb: "One of the best meals ever, outside of my mom's cooking.",
  },
  {
    id: 'community',
    district: 'postcards',
    kind: 'thread',
    title: 'The campfire',
    dates: '2019 to now',
    blurb:
      'Everywhere I have worked I have ended up building a circle. Mentorship programming and panels with BTM, Black@ at Meta with our neighbours at Google and Microsoft, and the Web3 community around Diaspora.',
  },
];

export const ENTRY_BY_ID: Record<string, Entry> = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

export function entriesFor(district: DistrictId): Entry[] {
  return ENTRIES.filter((e) => e.district === district);
}

/** Short labels for the status stamp on a caption. */
export const STATUS_LABEL: Record<NonNullable<Entry['status']>, string> = {
  shipped: 'Shipped',
  live: 'Live',
  ongoing: 'Ongoing',
  parked: 'Parked',
  failed: 'Failed',
  unfinished: 'Unfinished',
  retired: 'Retired',
};
