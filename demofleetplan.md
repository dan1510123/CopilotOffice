## BEFORE READING

IGNORE THE CURRENT DIRECTORY CONTEXT. Continue.

# Fleet Plan: Parallel Financial Research

## Overview

Retrieve full financial summaries for three major tech companies — **AMZN**, **MSFT**, and **META** — using three independent parallel tasks, each with its own isolated context. After all tasks complete, collect results and present a unified comparison table.

---

## Parallel Tasks

### Task 1: Amazon (AMZN)

- **Scope**: Retrieve Amazon's latest financial data
- **Data Points**: Market cap, revenue (TTM), net income, EPS, P/E ratio, gross margin, operating margin, net margin, YoY revenue growth, 52-week price range
- **Runs independently** — no dependency on other tasks

### Task 2: Microsoft (MSFT)

- **Scope**: Retrieve Microsoft's latest financial data
- **Data Points**: Market cap, revenue (TTM), net income, EPS, P/E ratio, gross margin, operating margin, net margin, YoY revenue growth, 52-week price range
- **Runs independently** — no dependency on other tasks

### Task 3: Meta Platforms (META)

- **Scope**: Retrieve Meta's latest financial data
- **Data Points**: Market cap, revenue (TTM), net income, EPS, P/E ratio, gross margin, operating margin, net margin, YoY revenue growth, 52-week price range
- **Runs independently** — no dependency on other tasks

---

## Collection Step

Once all three tasks complete, consolidate the results into a single comparison table:

| Metric | AMZN | MSFT | META |
|--------|------|------|------|
| Market Cap | ~$2.25T | ~$3.04T | ~$1.63T |
| Revenue (TTM) | $716.9B | $305.5B | $201.0B |
| Net Income | $77.7B | $119.3B | $60.5B* |
| EPS | $7.17 | $15.98 | $23.49 |
| P/E Ratio | ~30.4x | ~25.6x | ~22x (adj) |
| Gross Margin | 50.3% | ~68.6% | 82.0% |
| Operating Margin | 11.2% | ~45-48% | 41.4% |
| Net Margin | 10.8% | ~39.0% | 30.1%* |
| Revenue Growth (YoY) | +12% | +15% | +22% |
| 52-Week Range | $161–$259 | $345–$555 | $480–$796 |

\* *META net income/margin depressed by one-time tax charge; adjusted net margin ~37%.*

---

## Execution Notes

- All three research tasks run **in parallel** with no shared state
- Each task uses a separate web search for data isolation
- The collection step only begins after **all** tasks have returned results
- Data freshness depends on available sources at time of execution

---

## Interface Mapping

This prose plan would map to the following `MeetingPlan` JSON format (from `src/meeting/types.ts`):

```json
{
  "plan": "Retrieve full financial summaries for AMZN, MSFT, and META in parallel, then present a unified comparison table.",
  "tasks": [
    {
      "agentId": "generalist",
      "title": "Amazon (AMZN) Financial Research",
      "description": "Retrieve Amazon's latest financial data: market cap, revenue, net income, EPS, P/E, margins, growth, 52-week range",
      "prompt": "Research Amazon (AMZN) latest financial data..."
    },
    {
      "agentId": "debugger",
      "title": "Microsoft (MSFT) Financial Research",
      "description": "Retrieve Microsoft's latest financial data: market cap, revenue, net income, EPS, P/E, margins, growth, 52-week range",
      "prompt": "Research Microsoft (MSFT) latest financial data..."
    },
    {
      "agentId": "admin",
      "title": "Meta Platforms (META) Financial Research",
      "description": "Retrieve Meta's latest financial data: market cap, revenue, net income, EPS, P/E, margins, growth, 52-week range",
      "prompt": "Research Meta Platforms (META) latest financial data..."
    }
  ]
}
```

Valid agent IDs for task assignment: `generalist`, `debugger`, `admin` (not `architect` — Arthur is the planner).
