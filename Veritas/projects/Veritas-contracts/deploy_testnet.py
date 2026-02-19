"""
One-shot deployment of VeritasRegistry to Algorand Testnet.
Usage:
    DEPLOYER_MNEMONIC="word1 word2 ..." python3 deploy_testnet.py
"""
import base64
import json
import os
import sys
from pathlib import Path

from algosdk import mnemonic, account
from algosdk.v2client import algod
from algosdk.transaction import ApplicationCreateTxn, StateSchema, wait_for_confirmation, OnComplete

ALGOD_URL   = "https://testnet-api.algonode.cloud"
ALGOD_TOKEN = ""
ARC56_PATH  = Path(__file__).parent / "smart_contracts/artifacts/veritas_registry/VeritasRegistry.arc56.json"

def main() -> None:
    raw_mnemonic = os.environ.get("DEPLOYER_MNEMONIC", "").strip()
    if not raw_mnemonic:
        print("ERROR: Set DEPLOYER_MNEMONIC env var to your 25-word mnemonic.")
        sys.exit(1)

    private_key = mnemonic.to_private_key(raw_mnemonic)
    sender      = account.address_from_private_key(private_key)
    print(f"Deployer: {sender}")

    client = algod.AlgodClient(ALGOD_TOKEN, ALGOD_URL)
    sp = client.suggested_params()

    arc56 = json.loads(ARC56_PATH.read_text())

    # Extract compiled bytes from ARC56 (base64-encoded approval + clear)
    approval_b64 = arc56["source"]["approval"]
    clear_b64    = arc56["source"].get("clear", "")

    # Compile via algod (they may already be TEAL source)
    def compile_teal(src_b64: str) -> bytes:
        src = base64.b64decode(src_b64).decode()
        result = client.compile(src)
        return base64.b64decode(result["result"])

    try:
        approval_bytes = compile_teal(approval_b64)
        clear_bytes    = compile_teal(clear_b64) if clear_b64 else b"\x01"  # minimal clear
    except Exception as e:
        print(f"Compile via algod failed ({e}), trying TEAL files directly…")
        approval_teal = (ARC56_PATH.parent / "VeritasRegistry.approval.teal").read_text()
        clear_teal    = (ARC56_PATH.parent / "VeritasRegistry.clear.teal").read_text()
        approval_bytes = base64.b64decode(client.compile(approval_teal)["result"])
        clear_bytes    = base64.b64decode(client.compile(clear_teal)["result"])

    # State schema: VeritasRegistry uses BoxMap, no local/global ints or bytes needed
    global_schema = StateSchema(num_uints=0, num_byte_slices=0)
    local_schema  = StateSchema(num_uints=0, num_byte_slices=0)

    txn = ApplicationCreateTxn(
        sender=sender,
        sp=sp,
        on_complete=OnComplete.NoOpOC,
        approval_program=approval_bytes,
        clear_program=clear_bytes,
        global_schema=global_schema,
        local_schema=local_schema,
    )

    signed_txn = txn.sign(private_key)
    tx_id      = client.send_transaction(signed_txn)
    print(f"Transaction submitted: {tx_id}")
    print("Waiting for confirmation…")

    result = wait_for_confirmation(client, tx_id, wait_rounds=8)
    app_id = result["application-index"]

    print()
    print("=" * 55)
    print(f"  ✅  VeritasRegistry deployed to Algorand Testnet!")
    print(f"      App ID : {app_id}")
    print(f"      TxID   : {tx_id}")
    print(f"      Explorer: https://testnet.explorer.perawallet.app/application/{app_id}/")
    print("=" * 55)
    print()
    print(f"Next: update APP_ID in api/main.py and src/App.tsx to {app_id}")

if __name__ == "__main__":
    main()
