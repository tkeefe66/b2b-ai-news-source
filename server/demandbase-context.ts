import { storage } from "./storage";

export async function getDemandbaseContext(): Promise<string> {
  const grouped = await storage.getActiveKnowledgeByCategory();
  if (Object.keys(grouped).length === 0) {
    return DEMANDBASE_CONTEXT;
  }
  let context = '';
  for (const [category, entries] of Object.entries(grouped)) {
    context += `\n## ${category}\n\n`;
    for (const entry of entries) {
      context += `### ${entry.title}\n${entry.content}\n\n`;
    }
  }
  return context;
}

export async function getProductKnowledgeContext(): Promise<string> {
  const products = await storage.getActiveProductKnowledge();
  if (products.length === 0) return "";

  let context = "═══ DEMANDBASE PRODUCT KNOWLEDGE ═══\nUse this product knowledge to make specific, relevant recommendations tied to the analyzed company's goals.\n\n";

  for (const p of products) {
    context += `### ${p.productName}\n`;
    context += `**Key Capabilities:**\n${p.keyCapabilities}\n\n`;
    context += `**Key Personas:**\n${p.idealCustomerProfile}\n\n`;
    context += `**Problems It Solves:**\n${p.problemsItSolves}\n\n`;
    context += `**Customer Outcomes:**\n${p.customerOutcomes}\n\n`;
    context += `**Recommended Talk Track:**\n${p.talkTrack}\n\n`;

    const features = await storage.getActiveFeaturesByProduct(p.id);
    if (features.length > 0) {
      for (const f of features) {
        context += `#### Feature: ${f.featureName}\n`;
        context += `**Capabilities:** ${f.keyCapabilities}\n`;
        context += `**Key Personas:** ${f.keyPersonas}\n`;
        context += `**Problems:** ${f.problemsItSolves}\n`;
        context += `**Outcomes:** ${f.customerOutcomes}\n`;
        context += `**Talk Track:** ${f.talkTrack}\n\n`;
      }
    }

    context += `---\n\n`;
  }

  return context;
}

export const DEMANDBASE_CONTEXT = `
## DEMANDBASE COMPANY OVERVIEW

Demandbase is the leading Account-Based Go-to-Market platform. The core platform is called "Demandbase One" — it unifies data, aligns every GTM team, and turns signals into revenue based on the buying groups behind every decision.

**Tagline:** "Grow high-quality pipeline faster with the only AI platform built for how B2B really buys"

**Key Value Prop:** Demandbase unifies your data, aligns every GTM team, and turns signals into revenue based on the buying groups behind every decision.

**Pipeline AI** powers the entire go-to-market strategy — automating signal intelligence and go-to-market outcomes across the customer journey. Unify data, automate execution, and connect your stack with shared insights and workflows.

**Notable Customers:** Adobe, SAP Concur, IBM, Salesforce, Visa, DocuSign, BlackBerry, Gong, Hexagon, Thermo Fisher Scientific, Ingram Micro

## DEMANDBASE ONE PLATFORM — PRODUCT SUITE

### 1. Marketing (Account-Based Experience / ABX)
- Identify, engage, and convert the right accounts across the entire buyer journey
- 360° view of every account at every stage
- Know the right accounts, right timing, right message
- Turn interest into pipeline, pipeline into revenue, clients into loyal fans
- **Results:** 40% pipeline growth (Coalfire), 121% increase in in-market accounts (WorkForce Software), 2X number of MQAs (Thales)
- Key capabilities: account selection, journey stages, web personalization, campaign orchestration

### 2. Sales Intelligence
- Surface in-market accounts, map buying groups, automate outreach
- Sellers close deals faster with real-time buying signals
- Prescriptive Sales Dashboards prioritize accounts to focus on
- AI recommends contacts based on their role in the buying group
- Integrates into CRM and sales engagement tools

### 3. Advertising (B2B DSP — only demand-side platform built specifically for B2B)
- The ONLY DSP built for how B2B really buys: long cycles, high stakes, multi-person decisions
- "Your ads aren't broken. Your ad tech is" — consumer ad tech doesn't work for B2B
- Build segments with buying group, intent, and CRM signals
- People-based targeting directed at decision-makers
- Spot purchase intent before prospects hit your site via trillions of behavioral signals
- True omnichannel activation: LinkedIn, Meta, Google, CTV, display, and more
- B2B-specific measurement: pipeline influence, account lift, engagement metrics
- **Key differentiator:** Most ad platforms optimize for impressions/clicks — Demandbase optimizes for pipeline and revenue

### 4. Data & Account Intelligence
- Combines curated 1st-party and 3rd-party data with advanced AI
- "We don't just grab data — we own it"
- Unparalleled B2B coverage and laser-focused accuracy
- Account identification: turns anonymous traffic into identified accounts using 1T+ monthly signals
- Company information: firmographic data from 40,000+ providers
- B2B contact data: verified contact data revealing the full buying team
- Technographics: technology stack intelligence
- Intent data: buying signals showing when accounts are actively researching
- **150M+ contact database** for gap-filling in buying groups

### 5. Agentbase (AI Agents)
- "The future of account-based is Agentbase"
- A system of connected AI agents for total go-to-market alignment
- AI agents that work together, powered by the same data
- Not just AI agents — the RIGHT agents for unified go-to-market
- Runs on trusted, connected data ensuring team alignment
- Automates execution with precision, driving more high-quality pipeline with less effort

### 6. Buying Groups
- "The next phase of ABM" — Buying Group Marketing (BGM)
- Leads give you a name. Accounts give you a company. Buying groups show you WHO MOVES A DEAL.
- No other solution maps every persona, role, and action inside a B2B buying group with Demandbase's precision
- AI agent builds buying groups in seconds — identifies right personas, maps known contacts, fills gaps
- See missing roles, highlight active engagement, surface silent influencers
- Prescriptive dashboards prioritize accounts; AI recommends contacts based on buying group role

## KEY DIFFERENTIATORS

### vs. All Competitors
1. **Only B2B-native DSP** — purpose-built ad tech for B2B, not retrofitted consumer tech
2. **Buying Group focus** — goes beyond accounts to the actual people who make decisions
3. **AI built on 20 years of B2B data** — deepest, most mature B2B intelligence
4. **Unified platform** — marketing, sales, advertising, and data in one platform (Demandbase One)
5. **Transparent AI** — not a black box; customers can see and control how decisions are made
6. **Flexible & transparent** — adapts to customer workflows, not the other way around
7. **Enterprise-grade** — advanced security, global scalability, governance without compromise

### Why Demandbase Wins
- **Flexible & Transparent:** "Find out how we adapt to you, not the other way around"
- **Best B2B Ad Tech:** Only DSP built for B2B — consumer ad tech fails for complex buying
- **Enterprise-Class:** Security, scalability, governance for the world's largest companies
- **Smarter Intelligence:** Proprietary data + AI = insights no one else can match
- **Connected Platform:** Eliminates silos between marketing, sales, and advertising

## PROOF POINTS & CUSTOMER RESULTS

- Adobe: 3X increase in visitor-to-lead conversions
- SAP Concur: +52% increase in revenue, 4X funnel velocity
- Thermo Fisher Scientific: +50% growth in average deal size
- Ingram Micro: +83% increase in pipeline velocity
- Coalfire: 40% pipeline growth
- WorkForce Software: 121% increase in in-market accounts
- Thales: 2X MQAs, quadrupled CTRs, re-engaged 50% of targets
- Vendr Verified: top 1% of SaaS offerings for quality, demand, pricing fairness

## COMPETITIVE LANDSCAPE & POSITIONING

### vs. 6sense
- 6sense is account-based but lacks Demandbase's B2B-native DSP
- Demandbase offers more transparent AI and flexible data model
- Demandbase has deeper buying group intelligence
- 6sense's advertising relies on third-party ad networks; Demandbase owns its DSP

### vs. ZoomInfo
- ZoomInfo is primarily a data/contact provider; Demandbase is a full GTM platform
- Demandbase offers advertising, ABM orchestration, and buying group intelligence that ZoomInfo lacks
- ZoomInfo sells contacts; Demandbase maps entire buying groups and orchestrates engagement
- Demandbase intent data is proprietary; ZoomInfo's is largely sourced from Bombora

### vs. Bombora
- Bombora is intent-data-only; Demandbase is a complete platform
- Demandbase has its own proprietary intent signals from trillions of data points
- Bombora data feeds into many platforms but lacks activation capabilities
- Demandbase combines intent with account identification, advertising, and orchestration

### vs. Others (Terminus, RollWorks, Madison Logic, TechTarget)
- These are point solutions focused on a single channel (typically display advertising)
- Demandbase offers a unified platform spanning the entire GTM motion
- Demandbase's B2B DSP is proprietary; competitors use third-party ad networks
- Demandbase's data depth and breadth surpasses point solution providers

### vs. Clearbit / Apollo / Lusha
- These are data enrichment tools, not GTM platforms
- Demandbase includes data AND activation AND measurement
- Clearbit (now part of HubSpot) is limited to enrichment within HubSpot ecosystem
- Apollo/Lusha focus on prospecting; Demandbase orchestrates the full account journey

## KEY MESSAGING PILLARS

1. **B2B buying is broken** — too many point solutions, no unified view, wasted spend on wrong accounts
2. **Buying groups, not just leads or accounts** — the real decision-making unit in B2B
3. **AI that actually works for B2B** — built on 20 years of B2B data, not generic consumer AI
4. **One platform for the entire GTM team** — no more silos between marketing, sales, and advertising
5. **Data you can trust** — owned, curated, ethically sourced, transparent AI
6. **Prove ROI** — tie every marketing dollar to pipeline and revenue, not vanity metrics

## INTEGRATIONS ECOSYSTEM
Demandbase integrates with: HubSpot, Dynamics 365, Marketo, Eloqua, Drift, Qualified, Outreach, SalesLoft, Google Analytics, Adobe Analytics, LinkedIn, Salesforce, and 100+ more via the integrations marketplace.

## PERSONAS DEMANDBASE SELLS TO
- CMOs and VP Marketing
- VPs of Demand Generation
- Marketing Operations leaders
- RevOps leaders
- Sales Leaders and CROs
- Digital Marketing leaders
- ABM/ABX practitioners
`;
