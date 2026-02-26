---
name: shogun-agent
description: Expert agent for building decentralized applications with GunDB and the Shogun ecosystem — authentication, P2P data, encrypted messaging, smart contracts, IPFS, and stealth payments.
allowed-tools: WebFetch, AskUserQuestion
model: opus
license: MIT
metadata:
  author: scobru
  version: "1.0.0"
---

This skill provides deep knowledge of the **Shogun ecosystem** — a modular suite of open-source tools for building fully decentralized applications using **GunDB** as the peer-to-peer data layer, **IPFS** for content addressing, and **Ethereum/Base** for on-chain capabilities.

## 1. Ecosystem Overview

The Shogun ecosystem follows a "building blocks" philosophy. Each package is an independent, composable module:

| Layer               | Packages                                               | Purpose                                                       |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| **Core SDK**        | shogun-core                                            | Authentication, wallet mgmt, GunDB abstraction                |
| **Infrastructure**  | shogun-relay, shogun-relays                            | P2P relay servers, relay discovery                            |
| **Smart Contracts** | shogun-contracts                                       | On-chain registry, stealth payments, wallets, bridge, oracles |
| **Applications**    | shogun-linda, shogun-pdos, tunecamp, shogun-iframechat | End-user dApps                                                |
| **Privacy**         | shogun-stealth                                         | Stealth address toolkit                                       |
| **Integration**     | shogun-message-bridge, shogun-wormhole                 | Cross-platform bridges, P2P file transfer                     |
| **DevX**            | shogun-starter, shogun-auth, shogun-button-react       | Templates, React components                                   |
| **Monitoring**      | shogun-scan                                            | Network health dashboard                                      |
| **Docs & Landing**  | shogun-docs, shogun-landing                            | Docusaurus site, landing page                                 |

---

## 2. Repository & Documentation Links

### 2.1 Core SDK

#### [shogun-core](https://github.com/scobru/shogun-core) — `npm install shogun-core`

Comprehensive SDK for decentralized apps. Simplifies authentication, wallet management, and decentralized data storage on GunDB.

- **Auth methods**: Password, WebAuthn, Web3 (MetaMask), Nostr, ZK-Proof, Challenge (Server-Signed)
- **Database backends**: Gun (default) or Holster (modern ES modules)
- **Plugin system** for extensibility
- **RxJS** for reactive real-time data streams
- **BIP39 mnemonics** and HD key derivation
- **Event system**: `auth:login`, `auth:logout`, `auth:signup`, `error`
- [DeepWiki](https://deepwiki.com/scobru/shogun-core) | [npm](https://www.npmjs.com/package/shogun-core) | [Docs](https://shogun-core-docs.vercel.app/)

---

### 2.2 Infrastructure

#### [shogun-relay](https://github.com/scobru/shogun-relay) — GunDB + IPFS Relay Hub

Production-ready WebSocket relay with SQLite/RADISK persistence, IPFS integration, admin dashboard, and network federation.

- **GunDB Relay**: WebSocket relay with persistence
- **IPFS API**: Upload, pin, cat, directory uploads
- **Admin Dashboard**: React-based UI at `/dashboard`
- **Federation**: Relay discovery, storage proofs, reputation
- [DeepWiki](https://deepwiki.com/scobru/shogun-relay) | [npm](https://www.npmjs.com/package/shogun-relay)

#### [shogun-relays](https://github.com/scobru/shogun-relays) — `npm install shogun-relays`

Returns volunteer GUN relay lists from the decentralized network. Works in Node.js and browser (CDN).

- [npm](https://www.npmjs.com/package/shogun-relays)

---

### 2.3 Smart Contracts

#### [shogun-contracts](https://github.com/scobru/shogun-contracts) — `npm install shogun-contracts`

Solidity contracts on Base/Ethereum:

| Contract                  | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| **ShogunRelayRegistry**   | On-chain relay registry, USDC staking, storage deals, slashing |
| **StealthKeyRegistry**    | Stealth key registration (EIP-712)                             |
| **PaymentForwarder**      | Stealth payments with anti-spam toll                           |
| **StealthPool**           | Privacy mixing pool with Merkle commitments                    |
| **SmartWallet / Factory** | Multi-sig wallet with social recovery                          |
| **BridgeDex**             | Decentralized cross-chain bridge                               |
| **IPCMFactory / IPCM**    | IPFS Content Management on-chain                               |
| **ShogunOracle**          | Trustus-based oracle data verification                         |
| **OracleFeedRegistry**    | Oracle data feeds with pricing                                 |

- **Base Sepolia Registry**: `0x412D3Cf47907C231EE26D261714D2126eb3735e6`
- **Stack**: Solidity ^0.8.28, Hardhat, OpenZeppelin 5.3, Ethers.js 6
- [DeepWiki](https://deepwiki.com/scobru/shogun-contracts)

---

### 2.4 Applications

#### [shogun-linda](https://github.com/scobru/shogun-linda) — E2EE Messaging App

Decentralized messaging with custom E2EE protocol (ECDH + AES-GCM + HMAC), hourly key rotation, group chats, public rooms, stealth messaging.

- **Protocol**: Linda Protocol (ECDH key agreement, AES-GCM, HMAC auth, replay protection)
- **Client**: React 18 + Vite + Tailwind + DaisyUI
- **Auth**: MetaMask, WebAuthn, Nostr, OAuth
- [DeepWiki](https://deepwiki.com/scobru/shogun-linda)

#### [shogun-pdos](https://github.com/scobru/shogun-pdos) — 19 Minimalist Web Tools

Zero-backend productivity suite with GunDB sync: Notes, Pad, List, Calendar, Contacts, Kanban, Chat, Poll, Pass (password manager), Secret, QR, Drive, and more. Vanilla HTML/CSS/JS.

#### [tunecamp](https://github.com/scobru/tunecamp) — Decentralized Music Platform

Dual-mode music platform: static site generator and streaming server. Subsonic API, ActivityPub federation, GunDB integration.

#### [shogun-iframechat](https://github.com/scobru/shogun-iframechat) — Embeddable P2P Chat

Serverless P2P chat widget for iframes. GunDB-powered, postMessage API for bidirectional parent-child communication. Vanilla JS.

---

### 2.5 Privacy

#### [shogun-stealth](https://github.com/scobru/shogun-stealth) — Privacy dApp Starter

TypeScript starter for privacy-preserving dApps with stealth addresses. Links GunDB identity `epriv` to Ethereum stealth addresses via ECDH.

---

### 2.6 Integration

#### [shogun-message-bridge](https://github.com/scobru/shogun-message-bridge)

Multi-protocol messaging bridge connecting **Telegram, Matrix, WhatsApp, Mastodon** using GunDB as transport.

#### [shogun-wormhole](https://github.com/scobru/shogun-wormhole) — `npm install -g gundb-wormhole`

P2P file transfer tool using GunDB + IPFS. CLI (`gwh send/receive`) and web interface.

---

### 2.7 Developer Experience

#### [shogun-starter](https://github.com/scobru/shogun-starter)

React + TypeScript template with shogun-core, shogun-button-react, shogun-relays, shogun-theme, shogun-onion pre-configured.

#### [shogun-auth](https://github.com/scobru/shogun-auth)

Comprehensive authentication app: multiple login methods, encrypted data vault, cross-app integration via postMessage, OAuth callback handling.

#### [shogun-button-react](https://github.com/scobru/shogun-button-react)

React component library providing `<ShogunButton>` and `useShogun()` hook for instant auth integration.

---

### 2.8 Monitoring & Docs

#### [shogun-scan](https://github.com/scobru/shogun-scan)

GunDB network monitor: real-time node health, geographic map, latency measurements. Vanilla JS + Leaflet.

#### [shogun-docs](https://github.com/scobru/shogun-docs)

Docusaurus-based documentation site for the entire ecosystem.

#### [shogun-landing](https://github.com/scobru/shogun-landing)

Ecosystem landing page. Also hosts **Binnu** — a decentralized P2P pastebin with syntax highlighting and optional E2E encryption.

#### [shogun-space](https://github.com/scobru/shogun-space)

Decentralized space / homepage for the ecosystem.

---

## 3. Key Technology Patterns

### 3.1 GunDB Fundamentals

```typescript
import Gun from "gun";
import "gun/sea";

const gun = Gun({ peers: ["https://relay.shogun-eco.xyz/gun"] });
const user = gun.user();

// Create / Auth
user.create("alice", "password", (ack) => {
  /* ... */
});
user.auth("alice", "password", (ack) => {
  /* ... */
});

// CRUD
gun.get("app").get("key").put({ value: "data" });
gun
  .get("app")
  .get("key")
  .once((data) => console.log(data));
gun
  .get("app")
  .get("key")
  .on((data) => console.log("live:", data));

// Encrypted user data
const SEA = Gun.SEA;
const enc = await SEA.encrypt("secret", user._.sea);
const dec = await SEA.decrypt(enc, user._.sea);
user.get("vault").get("item").put(enc);
```

### 3.2 Shogun Core Initialization

```typescript
import { ShogunCore } from "shogun-core";
import Gun from "gun";

const gun = Gun({ peers: ["https://relay.shogun-eco.xyz/gun"] });
const shogun = new ShogunCore({
  gunInstance: gun,
  web3: { enabled: true },
  webauthn: {
    enabled: true,
    rpName: "My dApp",
    rpId: window.location.hostname,
  },
  nostr: { enabled: true },
  zkproof: { enabled: true, defaultGroupId: "my-app-users" },
});

// Auth
await shogun.signUp("username", "password");
await shogun.login("username", "password");

// Plugin access
const web3 = shogun.getPlugin("web3");
const webauthn = shogun.getPlugin("webauthn");
```

### 3.3 React Integration

```tsx
import { useShogun } from "shogun-button-react";

const MyComponent = () => {
  const { isLoggedIn, userPub, username, sdk, logout } = useShogun();

  if (sdk?.gun) {
    const user = sdk.gun.user();
    // GunDB operations...
  }

  return <div>{isLoggedIn ? `Hello ${username}` : "Not logged in"}</div>;
};
```

### 3.4 Stealth Addresses

```typescript
// GunDB epriv → Ethereum private key
// Send to one-time stealth address via ECDH
await lindaLib.sendStealthMessage(recipientPub, recipientEpub, "Secret");

// Listen for stealth messages
lindaLib.listenForStealthMessages((msg, stealthInfo) => {
  console.log("Stealth:", msg.content);
});
```

---

## 4. Community & Resources

- **Website**: [shogun-eco.xyz](https://shogun-eco.xyz)
- **Telegram**: [t.me/shogun_eco](https://t.me/shogun_eco)
- **GitHub Org**: [github.com/scobru](https://github.com/scobru)
- **GunDB Docs**: [gun.eco](https://gun.eco)
- **GunDB Wiki**: [github.com/amark/gun/wiki](https://github.com/amark/gun/wiki)
