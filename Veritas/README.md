<div align="center">

# ⚖️ Veritas Protocol

### *Truth, Immutable and On-Chain*

**A Decentralized, AI-Driven Visual Copyright Registry built on the Algorand Blockchain**

[![Built on Algorand](https://img.shields.io/badge/Built%20on-Algorand%20Testnet-00BFD8?style=for-the-badge&logo=algorand&logoColor=white)](https://testnet.algoexplorer.io/application/755787017)
[![Python](https://img.shields.io/badge/Backend-Python%203.12-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/Frontend-React%2018%20%2B%20TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)

> **RIFT Hackathon Submission — Team Bingo, NMAM Institute of Technology**
>
> 👑 **Team Leader:** Gaurav B Shet &nbsp;|&nbsp; 👨‍💻 **Members:** Anand Bobba · Keerthan Jogi

---

</div>

## 🎯 The Problem — Why Standard Hashing Has Failed Artists for Decades

Every major image platform today relies on **SHA-256 or MD5** to detect duplicate content. These are cryptographic checksums — they produce a completely different hash if even a single pixel changes. This makes them catastrophically useless for visual copyright protection.

A bad actor can defeat cryptographic hashing with any of the following trivial attacks:

| Attack | SHA-256 Result | Human Eye Result |
|---|---|---|
| Rotate image 90° | 100% different hash | Identical artwork |
| Mirror horizontally | 100% different hash | Identical artwork |
| Add subtle noise layer | 100% different hash | Identical artwork |
| Convert PNG → JPEG | 100% different hash | Identical artwork |
| Crop 5px from edge | 100% different hash | Identical artwork |
| Apply a sketch filter | 100% different hash | Same composition |
| Zoom in 1.5× | 100% different hash | Same artwork |

**The result?** Stolen art passes every automated check. Artists have no recourse. Plagiarists thrive.

---

## 💡 The Veritas Solution — Visual DNA, Not Byte Fingerprints

Veritas Protocol takes a fundamentally different approach. Instead of hashing bytes, it extracts the **perceptual essence** of an image — its underlying frequency skeleton — and encodes that as a 64-bit **Visual DNA signature**, stored immutably on the Algorand blockchain.

### How the Visual DNA is Extracted

```
Raw Image
    │
    ▼
┌─────────────────────────────┐
│  Layer 1: Denoise           │  Median Blur (3×3) strips adversarial
│  (Adversarial Defense)      │  pixel-level perturbations
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│  Layer 2: Normalize         │  Convert to Grayscale, resize to 32×32
│  (Scale Invariance)         │  eliminates resolution dependency
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│  Layer 3: DCT Transform     │  2D Discrete Cosine Transform extracts
│  (Frequency Domain)         │  low-frequency structural components
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│  Layer 4: 8×8 Low-Pass      │  Discard high-freq noise; keep only
│  (Noise Rejection)          │  the 64 most structurally significant bits
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│  Layer 5: Median Bitmask    │  Each bit = 1 if DCT coeff > median
│  (Binary Encoding)          │  64-bit pHash — the Visual DNA
└─────────────────────────────┘
    │
    ▼
  0xf3a7b2c91d4e5f60   ←  64-bit hex Visual DNA signature
```

The DCT is the same mathematical transform used inside every JPEG encoder on Earth. It captures the **energy distribution of the image** — not its pixels, but its *structure*. Two images that look the same will always produce similar DCTs, regardless of format, resolution, or minor modifications.

---

## 🛡️ Zero Blind Spots — The Forensic Resilience Engine

Veritas's verification pipeline is designed with a single engineering principle: **every conceivable piracy evasion tactic must fail**.

### Defense Layer 1 — Median Blur (Anti-Adversarial Noise)

Before any hash computation, every image passes through a **3×3 Median Blur filter**. This strips the high-frequency perturbations that adversarial attacks inject to confuse perceptual algorithms — the same technique used in robust ML defenses. Both the registered original and the suspect image are blurred before comparison, so noise-injection attacks produce zero benefit to the plagiarist.

### Defense Layer 2 — 8-Way Symmetry Invariance (D4 Dihedral Group)

The verification pipeline does not test a single orientation. It tests all **8 rigid symmetry transformations** of the dihedral group D4:

```
┌────────────────────────────┬─────────────────────────────────────────┐
│ Transform                  │ Catches                                 │
├────────────────────────────┼─────────────────────────────────────────┤
│ Original                   │ Exact copies, format re-saves           │
│ 90° Rotation               │ Rotated uploads                         │
│ 180° Rotation              │ Upside-down uploads                     │
│ 270° Rotation              │ Counter-rotated uploads                 │
│ Horizontal Mirror          │ Flipped copies                          │
│ Mirror + 90° Rotation      │ Compound rotation + flip                │
│ Mirror + 180° Rotation     │ Compound rotation + flip                │
│ Mirror + 270° Rotation     │ Compound rotation + flip                │
└────────────────────────────┴─────────────────────────────────────────┘
```

The system returns the **minimum Hamming distance** across all 8 orientations.

### Defense Layer 3 — Zoom & Crop Invariance

A zoom attack is a crop attack in disguise. Veritas reverses this by padding the suspect image to multiple scale factors (×1.25, ×1.5, ×2.0) on a neutral canvas, restoring the original framing before pHash comparison. This catches cropped screenshots, zoomed social media reposts, and "creative" recropping.

### Defense Layer 4 — SHA-256 Derivative Verification

When the pHash distance is 0 (perceptually identical), Veritas performs a second check: it compares the **SHA-256** of the uploaded file against the original file stored in Cloudinary. A sketch, oil-paint filter, or stylistic re-render will have the same pHash but a completely different SHA-256 — Veritas catches this and correctly flags it as a derivative work rather than the original.

### The Mathematics of Proof

Plagiarism is proven using **Hamming Distance** — the number of bit positions where two 64-bit signatures differ:

$$d_H(h_1, h_2) = \text{popcount}(h_1 \oplus h_2)$$

| Hamming Distance | Verdict | Meaning |
|---|---|---|
| 0 (same SHA-256) | ✅ Original Verified | Pixel-perfect original |
| 0 (different SHA-256) | ⚠️ Plagiarism Detected | Derivative — same composition, different file |
| 1 – 15 | ⚠️ Plagiarism Detected | Modified copy — mathematically proven |
| > 15 | ✅ Clear | Genuinely new work |

---

## ⛓️ Why Algorand — The Only Chain That Makes This Possible

A global copyright registry has hard requirements that most blockchains cannot meet:

| Requirement | Why It Matters | Algorand's Answer |
|---|---|---|
| **Fast Finality** | A registration must be immutable within seconds, not minutes | ~3.5s finality, no reorgs |
| **Low Fees** | Artists shouldn't pay $50 to register a $5 sketch | ~0.001 ALGO per transaction |
| **Efficient Key-Value Storage** | 64-bit hash → 32-byte address pairs need native on-chain storage | **Box Storage** — per-entry on-chain KV store |
| **Trustless Verification** | Anyone must be able to verify ownership without trusting Veritas | Smart contract ABI is open; anyone can read boxes |
| **Developer Experience** | The registry logic must be auditable and minimal | AlgoKit + Algorand Python — the contract is 10 lines |

### The Smart Contract

The entire registry logic lives in a single, auditable 10-line Algorand Python contract:

```python
class VeritasRegistry(ARC4Contract):
    def __init__(self) -> None:
        self.registered_hashes = BoxMap(String, Account)

    @arc4.abimethod
    def register_work(self, p_hash: String) -> None:
        assert p_hash not in self.registered_hashes, "Plagiarism Alert: Hash already registered!"
        self.registered_hashes[p_hash] = Txn.sender
```

`BoxMap(String, Account)` maps each 64-bit pHash hex string to the Algorand wallet address of its registrant. If a hash already exists, the contract **atomically rejects** the transaction — on-chain plagiarism prevention at the protocol level, not just the application layer.

- **Live Contract:** App ID `755787017` on Algorand Testnet
- **Wallet Signing:** Pera Wallet via `@perawallet/connect`
- **ABI Standard:** ARC-4 compatible

---

## 🗺️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Browser                              │
│  React 18 + TypeScript + TailwindCSS (Vercel)                       │
│                                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────────┐ │
│  │ Register │  │   Verify     │  │   Forensic Analyze            │ │
│  │  Artwork │  │   Artwork    │  │   (DCT Visualizer)            │ │
│  └────┬─────┘  └──────┬───────┘  └──────────────┬────────────────┘ │
│       │               │                          │                  │
└───────┼───────────────┼──────────────────────────┼──────────────────┘
        │               │                          │
        ▼               ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Render / Docker)                │
│  python:3.12-slim                                                   │
│                                                                     │
│  /compute-hash   →  Median Blur → 32×32 → DCT → 64-bit pHash       │
│  /verify         →  13-Transform loop + SHA-256 derivative check    │
│  /analyze        →  Full forensic pipeline + DCT heatmap           │
│  /algod/params   →  AlgoNode proxy (avoids browser geo-blocks)      │
│  /algod/account  →  AlgoNode proxy                                  │
└──────────────────┬──────────────────────────┬───────────────────────┘
                   │                          │
        ┌──────────▼──────────┐    ┌──────────▼──────────┐
        │   Cloudinary CDN    │    │  Algorand Testnet   │
        │ (original archive)  │    │  testnet-api.       │
        │                     │    │  algonode.cloud     │
        └─────────────────────┘    └──────────┬──────────┘
                                              │
                                   ┌──────────▼──────────┐
                                   │  VeritasRegistry    │
                                   │  App #755787017     │
                                   │  BoxMap pHash→Addr  │
                                   └─────────────────────┘
```

---

## 🔮 Future Scope

| Feature | Description |
|---|---|
| **SIFT Feature Matching** | Scale-Invariant Feature Transform eliminates perspective-warping blind spots — catches photos of paintings taken at an angle |
| **Video Frame Fingerprinting** | Extend pHash to keyframe extraction for video plagiarism detection |
| **Mainnet Migration** | Move from Testnet to Algorand Mainnet for production use |
| **NFT Provenance Integration** | Cross-reference with ARC-69/ARC-19 NFT metadata for automatic provenance chains |
| **Browser Extension** | One-click "Verify this image" from any webpage |

---

## 📁 Repository Structure

```
Veritas/
├── api/                        ← FastAPI backend
│   ├── main.py                 ← Forensic engine, proxy endpoints
│   ├── requirements.txt        ← Python dependencies
│   ├── Dockerfile              ← Docker image for Render
│   └── .env                    ← CLOUDINARY_URL (not committed)
│
├── projects/
│   ├── Veritas-frontend/       ← React/TypeScript UI (Vercel)
│   │   ├── src/
│   │   │   ├── App.tsx         ← Main app logic, all API calls
│   │   │   └── components/     ← Wallet connect, account, transactions
│   │   └── vercel.json         ← Vercel deployment config
│   │
│   └── Veritas-contracts/      ← AlgoKit smart contract
│       └── smart_contracts/
│           └── veritas_registry/
│               └── contract.py ← 10-line VeritasRegistry ARC-4 contract
│
└── render.yaml                 ← Render deployment config (repo root)
```

---

<div align="center">

**Built with 🧠 and ☕ by Team Bingo**

| Role | Name |
|---|---|
| 👑 Team Leader | Gaurav B Shet |
| 👨‍💻 Team Member | Anand Bobba |
| 👨‍💻 Team Member | Keerthan Jogi |

*NMAM Institute of Technology · RIFT Hackathon 2026*

</div>

This starter full stack project has been generated using AlgoKit. See below for default getting started instructions.

## Setup

### Initial setup
1. Clone this repository to your local machine.
2. Ensure [Docker](https://www.docker.com/) is installed and operational. Then, install `AlgoKit` following this [guide](https://github.com/algorandfoundation/algokit-cli#install).
3. Run `algokit project bootstrap all` in the project directory. This command sets up your environment by installing necessary dependencies, setting up a Python virtual environment, and preparing your `.env` file.
4. In the case of a smart contract project, execute `algokit generate env-file -a target_network localnet` from the `Veritas-contracts` directory to create a `.env.localnet` file with default configuration for `localnet`.
5. To build your project, execute `algokit project run build`. This compiles your project and prepares it for running.
6. For project-specific instructions, refer to the READMEs of the child projects:
   - Smart Contracts: [Veritas-contracts](projects/Veritas-contracts/README.md)
   - Frontend Application: [Veritas-frontend](projects/Veritas-frontend/README.md)

> This project is structured as a monorepo, refer to the [documentation](https://github.com/algorandfoundation/algokit-cli/blob/main/docs/features/project/run.md) to learn more about custom command orchestration via `algokit project run`.

### Subsequently

1. If you update to the latest source code and there are new dependencies, you will need to run `algokit project bootstrap all` again.
2. Follow step 3 above.

## Tools

This project makes use of Python and React to build Algorand smart contracts and to provide a base project configuration to develop frontends for your Algorand dApps and interactions with smart contracts. The following tools are in use:

- Algorand, AlgoKit, and AlgoKit Utils
- Python dependencies including Poetry, Black, Ruff or Flake8, mypy, pytest, and pip-audit
- React and related dependencies including AlgoKit Utils, Tailwind CSS, daisyUI, use-wallet, npm, jest, playwright, Prettier, ESLint, and Github Actions workflows for build validation

### VS Code

It has also been configured to have a productive dev experience out of the box in [VS Code](https://code.visualstudio.com/), see the [backend .vscode](./backend/.vscode) and [frontend .vscode](./frontend/.vscode) folders for more details.

## Integrating with smart contracts and application clients

Refer to the [Veritas-contracts](projects/Veritas-contracts/README.md) folder for overview of working with smart contracts, [projects/Veritas-frontend](projects/Veritas-frontend/README.md) for overview of the React project and the [projects/Veritas-frontend/contracts](projects/Veritas-frontend/src/contracts/README.md) folder for README on adding new smart contracts from backend as application clients on your frontend. The templates provided in these folders will help you get started.
When you compile and generate smart contract artifacts, your frontend component will automatically generate typescript application clients from smart contract artifacts and move them to `frontend/src/contracts` folder, see [`generate:app-clients` in package.json](projects/Veritas-frontend/package.json). Afterwards, you are free to import and use them in your frontend application.

The frontend starter also provides an example of interactions with your VeritasRegistryClient in [`AppCalls.tsx`](projects/Veritas-frontend/src/components/AppCalls.tsx) component by default.

## Next Steps

You can take this project and customize it to build your own decentralized applications on Algorand. Make sure to understand how to use AlgoKit and how to write smart contracts for Algorand before you start.
