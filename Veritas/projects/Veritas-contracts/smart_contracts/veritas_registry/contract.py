# =============================================================================
#  VeritasRegistry — Algorand Smart Contract
#  -----------------------------------------------------------------------------
#  Project   : Veritas Protocol
#  Team      : Bingo — Gaurav B Shet (Lead), Anand Bobba, Keerthan Jogi
#  Institute : NMAM Institute of Technology
#  Event     : RIFT Hackathon 2026
#  Network   : Algorand Testnet  (App ID: 755806101)
#  Standard  : ARC-4  (typed ABI — register_work(string)void)
#  Language  : Algorand Python  →  compiled to AVM bytecode via PuyaPy
# =============================================================================
#
#  PURPOSE
#  -------
#  This contract is the immutable, trustless backbone of the Veritas Protocol.
#  It acts as a global on-chain copyright registry, mapping a 64-bit perceptual
#  hash (pHash) of an artwork to the Algorand wallet address of its rightful owner.
#
#  STORAGE MODEL
#  -------------
#  Uses Algorand Box Storage — a native key-value store on the AVM.
#
#    BoxMap<String, Account>
#    │
#    ├── Key   : 64-bit pHash hex string  (e.g. "f3a7b2c91d4e5f60")
#    │           — the "Visual DNA" of the artwork, computed off-chain via DCT
#    │
#    └── Value : 32-byte Algorand public key of the registrant
#                — proves permanent, on-chain ownership
#
#  Each box occupies: 2500 + 400 × (key_length + 32) microALGO in MBR,
#  funded by the registering wallet as part of the atomic transaction group.
#
#  ANTI-PLAGIARISM GUARANTEE
#  -------------------------
#  The `assert` in register_work() is enforced by the AVM itself — not by
#  application logic, not by a server. If a pHash is already in the BoxMap,
#  the transaction is rejected atomically before it lands in any block.
#  This makes double-registration physically impossible at the protocol level.
#
# =============================================================================

from algopy import ARC4Contract, String, Account, BoxMap, Txn, arc4


class VeritasRegistry(ARC4Contract):
    """
    On-chain registry mapping perceptual hashes (Visual DNA) to artwork owners.

    Deployment: one instance per network. All registered artworks share a single
    contract instance, making ownership lookups trustless and permissionless —
    anyone can read the registry without going through Veritas infrastructure.
    """

    def __init__(self) -> None:
        # BoxMap: pHash hex string  →  registrant's Algorand Account (public key)
        # Stored natively in Algorand Box Storage — no global state, no databases.
        self.registered_hashes = BoxMap(String, Account)

    @arc4.abimethod
    def register_work(self, p_hash: String) -> None:
        """
        Register a new artwork's Visual DNA signature on the Algorand blockchain.

        Parameters
        ----------
        p_hash : String
            64-bit perceptual hash (hex) of the artwork, computed by the Veritas
            backend using the pipeline:
              Raw Image → Median Blur → Grayscale 32×32 → 2D DCT → 8×8 low-pass
              → Median bitmask → 64-bit pHash

        Behaviour
        ---------
        - If p_hash does NOT exist in the registry:
              Writes  BoxMap[p_hash] = Txn.sender  and succeeds.
        - If p_hash ALREADY exists in the registry:
              The AVM rejects the entire transaction atomically.
              No state is modified. The registrant's ALGO is not charged.

        Access
        ------
        Public — any wallet may call this method. The caller automatically
        becomes the on-chain owner of the registered hash.

        Notes
        -----
        This method must be called as part of an atomic group that includes a
        payment transaction funding the Box Minimum Balance Requirement (MBR):
            MBR = 2500 + 400 × (len(p_hash) + 32)  microALGO
        """
        # ── Core anti-plagiarism assertion ────────────────────────────────────
        # Enforced by the AVM — not a server check. If this hash already exists,
        # the transaction fails at the protocol level with no side effects.
        assert p_hash not in self.registered_hashes, "Plagiarism Alert: Hash already registered!"

        # ── Write ownership record to Box Storage ────────────────────────────
        # Txn.sender is the wallet address of the person who signed this transaction.
        # This becomes the immutable, on-chain proof of authorship.
        self.registered_hashes[p_hash] = Txn.sender
