# Repository flow

This diagram follows one race from the browser entry point through the
role-specific screens, local persistence, WebSocket relay, event folding, and
result export.

## End-to-end flow

```mermaid
flowchart TD
    Browser["Browser"] --> Entry["src/main.tsx<br/>createRoot(App)"]
    Entry --> Route{"src/ui.tsx<br/>useRoute()"}

    Route -->|No room code| Home["src/Home.tsx<br/>Create or join a room"]
    Route -->|Room code| RoomView["src/RoomView.tsx<br/>Room shell + role tabs"]

    Home --> Navigate["Hash route<br/>#/<code>/<role>"]
    Navigate --> Route

    RoomView --> Role{"Active role"}
    Role --> Start["src/StartTab.tsx<br/>Prepare runners and start a heat"]
    Role --> Finish["src/FinishTab.tsx<br/>Record finish taps"]
    Role --> Results["src/ResultsTab.tsx<br/>Rank, correct, and export"]

    Start --> RoomClient["src/room.ts<br/>Room client"]
    Finish --> RoomClient
    Results --> RoomClient

    RoomClient --> Local["localStorage<br/>rt:room:<code>"]
    RoomClient -->|WebSocket /ws| Relay["server.js<br/>HTTP host + WebSocket relay"]

    Relay --> Validate["Validate and sanitize event"]
    Validate --> Append["Append to<br/>data/<code>.jsonl"]
    Append --> Broadcast["Broadcast event to<br/>all room sockets"]
    Broadcast --> RoomClient

    RoomClient --> Events["Immutable event set<br/>start / stop / cancel / void"]
    Events --> Fold["src/race.ts<br/>fold(events)"]
    Fold --> Heats["Derived heats and runners"]
    Heats --> Finish
    Heats --> Results
    Results --> CSV["CSV download"]
```

## Race event sequence

```mermaid
sequenceDiagram
    participant S as Start device
    participant F as Finish device
    participant B as Results device
    participant R as Relay
    participant L as Local storage

    S->>L: Save start event first
    S->>R: WebSocket { k: "ev", ev: start }
    R->>R: Validate and persist event
    R-->>S: Echo event (ack)
    R-->>F: Broadcast event
    R-->>B: Broadcast event
    F->>L: Merge event into local event set
    B->>L: Merge event into local event set

    F->>L: Save stop event first
    F->>R: WebSocket { k: "ev", ev: stop }
    R->>R: Validate and persist event
    R-->>S: Broadcast stop
    R-->>F: Echo stop (ack)
    R-->>B: Broadcast stop

    S->>S: fold(events)
    F->>F: fold(events)
    B->>B: fold(events)
    Note over S,B: Same event set produces the same race result
```

## Offline and recovery path

```mermaid
flowchart LR
    Tap["User tap"] --> Save["Write event locally"]
    Save --> Pending{"Relay reachable?"}
    Pending -->|Yes| Send["Send missing events"]
    Pending -->|No| Queue["Keep event in pending set"]
    Queue --> Reconnect["Reconnect with backoff"]
    Reconnect --> Sync["Exchange missing events"]
    Send --> Sync
    Sync --> Merge["Merge without overwriting local events"]
    Merge --> Derived["Recompute fold(events)"]

    RelayLoss["Relay restart or lost disk"] --> Sync
    Sync --> Rebuild["Devices re-upload events<br/>the relay does not have"]
    Rebuild --> Derived
```

## Code map

| Responsibility | File |
|---|---|
| Browser bootstrap and production service worker registration | `src/main.tsx` |
| Hash routing, storage helpers, room lifecycle, tap timestamps | `src/ui.tsx` |
| Room state, WebSocket sync, retries, clock synchronization | `src/room.ts` |
| Event types, deterministic state folding, timing, CSV formatting | `src/race.ts` |
| Role-based room shell and sharing QR | `src/RoomView.tsx` |
| Start, finish, and results workflows | `src/StartTab.tsx`, `src/FinishTab.tsx`, `src/ResultsTab.tsx` |
| Static hosting, WebSocket relay, validation, persistence | `server.js` |
| End-to-end resilience coverage | `test/*.test.ts` |
