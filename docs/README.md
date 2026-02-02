# Shogun Relay – Documentazione

Indice della documentazione del relay.

## Guide e riferimenti

| Documento | Descrizione |
|-----------|-------------|
| **[API.md](./API.md)** | Riferimento completo delle REST API: autenticazione, health, IPFS, torrent, drive, graph, x402, registry, deals, network. |
| **[ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)** | Tutte le variabili d’ambiente: moduli, identità, IPFS, GunDB, registry, x402, prezzi, limiti, federazione, opzioni avanzate. |
| **[NODE_OPERATOR_GUIDE.md](./NODE_OPERATOR_GUIDE.md)** | Guida per operatori: prerequisiti, quick start (Docker/manuale), configurazione minima, staking, revenue, troubleshooting. |
| **[RELAY_KEYS.md](./RELAY_KEYS.md)** | Configurazione della keypair SEA del relay (variabile, file, Docker) per evitare errori di firma GunDB. |
| **[X402_PAYMENTS.md](./X402_PAYMENTS.md)** | Pagamenti x402: flusso, tier di abbonamento, settlement (facilitator/direct), variabili e API. |
| **[STORAGE_DEALS.md](./STORAGE_DEALS.md)** | Storage deals: prezzi, lifecycle (create → pay → activate → store), API e integrazione. |
| **[NETWORK_FEDERATION.md](./NETWORK_FEDERATION.md)** | Federazione di rete: discovery relay, storage proofs, verifica contenuti, API `/api/v1/network/*`. |
| **[DRIVE_SDK_EXAMPLE.md](./DRIVE_SDK_EXAMPLE.md)** | Esempio d’uso dello SDK per Drive: upload, download, navigazione, metadati, best practice. |

## Dove trovare cosa

- **Avvio e configurazione** → [README principale](../README.md), [NODE_OPERATOR_GUIDE.md](./NODE_OPERATOR_GUIDE.md), [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)
- **API REST** → [API.md](./API.md); nel dashboard: `/dashboard/api-docs`
- **Dashboard** → `/dashboard/` (o `/admin`); autenticazione in **Settings** (`/dashboard/settings`)
- **Chiavi relay** → [RELAY_KEYS.md](./RELAY_KEYS.md)
- **Pagamenti e abbonamenti** → [X402_PAYMENTS.md](./X402_PAYMENTS.md), [STORAGE_DEALS.md](./STORAGE_DEALS.md)
- **Rete e federazione** → [NETWORK_FEDERATION.md](./NETWORK_FEDERATION.md)
- **Contribuire** → [CONTRIBUTING.md](../CONTRIBUTING.md)  
- **Sicurezza** → [SECURITY.md](../SECURITY.md)
