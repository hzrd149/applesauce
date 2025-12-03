# Beginner's Tutorial

Welcome to the Applesauce tutorial! This step-by-step guide will teach you how to build reactive Nostr applications using the applesauce library ecosystem.

## What You'll Learn

By the end of this tutorial, you'll understand how to:

- Set up an in-memory reactive database for Nostr events
- Parse and display user profiles and content
- Create reactive UI components that respond to data changes
- Connect to Nostr relays and subscribe to events
- Create and publish new Nostr events

## Tutorial Structure

This tutorial is broken down into digestible sections:

1. **[Introduction to EventStore](./01-event-store.md)** - Learn about the reactive database at the heart of applesauce
2. **[Working with Helpers](./02-helpers.md)** - Parse profiles and extract data from events
3. **[Building Reactive UI with Models](./03-models.md)** - Create React components that respond to data changes
4. **[Connecting to Relays](./04-relays.md)** - Subscribe to Nostr relays and receive events
5. **[Loading Specific Events with Loaders](./05-loaders.md)** - Load specific events from relays
6. **[Creating Events with EventFactory](./06-event-factory.md)** - Set up event creation and signing
7. **[Publishing Events](./07-publishing.md)** - Publish events to relays and handle responses
8. **[Using Actions](./08-actions.md)** - Run complex actions like following users

## Prerequisites

- Basic knowledge of JavaScript/TypeScript
- Familiarity with React hooks (`useState`, `useEffect`)
- Understanding of RxJS observables (helpful but not required)
- A Nostr extension wallet (like [Alby](https://getalby.com/) or [nos2x](https://github.com/fiatjaf/nos2x))

## Getting Started

Let's begin with [Introduction to EventStore](./01-event-store.md) to learn about the foundation of applesauce applications.
