---
name: dotnet-slopwatch
description: Use Slopwatch to detect LLM reward hacking in .NET code changes. Run after every code modification to catch disabled tests, suppressed warnings, empty catch blocks, and other shortcuts that mask real problems.
---

# Slopwatch: LLM Anti-Cheat for .NET

## When to Use This Skill

**Use this skill constantly.** Every time an LLM (including Claude) makes changes to:
- C# source files (.cs)
- Project files (.csproj)
- Props files (Directory.Build.props, Directory.Packages.props)
- Test files

Run slopwatch to validate the changes don't introduce "slop."

## What is Slop?

"Slop" refers to shortcuts LLMs take that make tests pass or builds succeed without actually solving the underlying problem. These are reward hacking behaviors - the LLM optimizes for apparent success rather than real fixes.

### Common Slop Patterns

| Pattern | Example | Why It's Bad |
|---------|---------|--------------|
| Disabled tests | `[Fact(Skip="flaky")]` | Hides failures instead of fixing them |
| Warning suppression | `#pragma warning disable CS8618` | Silences compiler without fixing issue |
| Empty catch blocks | `catch (Exception) { }` | Swallows errors, hides bugs |
| Arbitrary delays | `await Task.Delay(1000);` | Masks race conditions, makes tests slow |
| Project-level suppression | `<NoWarn>CS1591</NoWarn>` | Disables warnings project-wide |
| CPM bypass | `Version="1.0.0"` inline | Undermines central package management |

**Never accept these patterns.** If an LLM introduces slop, reject the change and require a proper fix.

---

## Installation

### As a Local Tool (Recommended)

Add to `.config/dotnet-tools.json`:

```json
{
  "version": 1,
  "isRoot": true,
  "tools": {
    "slopwatch.cmd": {
      "version": "0.4.2",
      "commands": ["slopwatch"],
      "rollForward": false
    }
  }
}
```

Then restore:
```bash
dotnet tool restore
```

## First-Time Setup: Establish a Baseline

Before using slopwatch on an existing project, create a baseline of current issues:

```bash
# Initialize baseline from existing code
slopwatch init

# This creates .slopwatch/baseline.json
git add .slopwatch/baseline.json
git commit -m "Add slopwatch baseline"
```

**Why baseline?** Legacy code may have existing issues. The baseline ensures slopwatch only catches **new** slop being introduced, not pre-existing technical debt.

---

## Usage During LLM Sessions

### After Every Code Change

Run slopwatch after any LLM-generated code modification:

```bash
# Analyze for new issues (uses baseline)
slopwatch analyze

# Use strict mode - fail on warnings too
slopwatch analyze --fail-on warning
```

### When Slopwatch Flags an Issue

**Do not ignore it.** Instead:

1. **Understand why** the LLM took the shortcut
2. **Request a proper fix** - be specific about what's wrong
3. **Verify the fix** doesn't introduce different slop

```
# Example: LLM disabled a test
❌ SW001 [Error]: Disabled test detected
   File: tests/MyApp.Tests/OrderTests.cs:45
   Pattern: [Fact(Skip="Test is flaky")]

# Correct response: Ask for actual fix
"This test was disabled instead of fixed. Please investigate why
it's flaky and fix the underlying timing/race condition issue."
```

### Updating the Baseline (Rare)

Only update the baseline when slop is **truly justified** and documented:

```bash
# Add current detections to baseline (use sparingly!)
slopwatch analyze --update-baseline
```

**Justification examples:**
- Third-party library forces a pattern (e.g., must suppress specific warning)
- Intentional delay for rate limiting (not test flakiness)
- Generated code that can't be modified

Document why in a code comment when updating baseline.

---

## Editor Integration

Do not add a global tool install or a .claude/settings.json hook in this repository;
slopwatch is optional here and may only be used through dotnet tool restore when the
maintainer explicitly asks for it.
## Optional local use

This repository does not install slopwatch globally and does not add editor hooks. If the maintainer explicitly wants a local check, restore the pinned tool with `dotnet tool restore` and run it manually; no CI wiring is assumed.
