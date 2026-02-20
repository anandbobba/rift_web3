"""
Reset VeritasRegistry on Algorand Testnet.
Deletes the current app (wiping ALL box registrations) and redeploys a fresh instance.

Usage:
    DEPLOYER_MNEMONIC="word1 word2 ..." python3 reset_testnet.py

After running, copy the new App ID printed at the end and update:
  - Veritas/api/main.py           → APP_ID = <new_id>
  - Veritas/projects/Veritas-frontend/src/App.tsx  → const APP_ID = <new_id>
"""
import base64
import json
import os
import sys
from pathlib import Path

from algosdk import mnemonic, account
from algosdk.v2client import algod
from algosdk.transaction import (
    ApplicationDeleteTxn,
    ApplicationCreateTxn,
    StateSchema,
    wait_for_confirmation,
    OnComplete,
)

ALGOD_URL   = "https://testnet-api.algonode.cloud"
ALGOD_TOKEN = ""
OLD_APP_ID  = 755787017
ARC56_PATH  = Path(__file__).parent / "smart_contracts/artifacts/veritas_registry/VeritasRegistry.arc56.json"


def main() -> None:
    raw_mnemonic = os.environ.get("DEPLOYER_MNEMONIC", "").strip()
    if not raw_mnemonic:
        print("ERROR: Set DEPLOYER_MNEMONIC env var to your 25-word mnemonic.")
        sys.exit(1)

    private_key = mnemonic.to_private_key(raw_mnemonic)
    sender      = account.address_from_private_key(private_key)
    print(f"Deployer : {sender}")

    client = algod.AlgodClient(ALGOD_TOKEN, ALGOD_URL)

    # ── Step 1: Delete old app (destroys all boxes + state) ──────────────────
    print(f"\nStep 1/2 — Deleting App #{OLD_APP_ID} and all its registrations...")
    try:
        sp = client.suggested_params()
        del_txn    = ApplicationDeleteTxn(sender=sender, sp=sp, index=OLD_APP_ID)
        signed_del = del_txn.sign(private_key)
        del_tx_id  = client.send_transaction(signed_del)
        print(f"  Delete tx submitted: {del_tx_id}")
        wait_for_confirmation(client, del_tx_id, wait_rounds=8)
        print(f"  ✅ App #{OLD_APP_ID} deleted. All registrations wiped.")
    except Exception as e:
        print(f"  ⚠️  Could not delete app (maybe already deleted or wrong deployer): {e}")
        print("  Continuing to redeploy fresh app anyway...\n")

    # ── Step 2: Deploy fresh app ──────────────────────────────────────────────
    print("\nStep 2/2 — Deploying fresh VeritasRegistry...")

    arc56 = json.loads(ARC56_PATH.read_text())
    approval_b64 = arc56["source"]["approval"]
    clear_b64    = arc56["source"].get("clear", "")

    def compile_teal(src_b64: str) -> bytes:
        src = base64.b64decode(src_b64).decode()
        result = client.compile(src)
        return base64.b64decode(result["result"])

    try:
        approval_bytes = compile_teal(approval_b64)
        clear_bytes    = compile_teal(clear_b64) if clear_b64 else b"\x01"
    except Exception as e:
        print(f"  Compile via ARC56 failed ({e}), falling back to .teal files...")
        approval_teal  = (ARC56_PATH.parent / "VeritasRegistry.approval.teal").read_text()
        clear_teal     = (ARC56_PATH.parent / "VeritasRegistry.clear.teal").read_text()
        approval_bytes = base64.b64decode(client.compile(approval_teal)["result"])
        clear_bytes    = base64.b64decode(client.compile(clear_teal)["result"])

    sp = client.suggested_params()
    txn = ApplicationCreateTxn(
        sender=sender,
        sp=sp,
        on_complete=OnComplete.NoOpOC,
        approval_program=approval_bytes,
        clear_program=clear_bytes,
        global_schema=StateSchema(num_uints=0, num_byte_slices=0),
        local_schema=StateSchema(num_uints=0, num_byte_slices=0),
    )

    signed_txn = txn.sign(private_key)
    tx_id      = client.send_transaction(signed_txn)
    print(f"  Deploy tx submitted: {tx_id}")
    print("  Waiting for confirmation...")

    result = wait_for_confirmation(client, tx_id, wait_rounds=8)
    new_app_id = result["application-index"]

    print()
    print("=" * 60)
    print(f"  ✅  Fresh VeritasRegistry deployed!")
    print(f"      New App ID : {new_app_id}")
    print(f"      Explorer   : https://testnet.algoexplorer.io/application/{new_app_id}")
    print("=" * 60)
    print()
    print("⚠️  ACTION REQUIRED — update App ID in two files:")
    print()
    print(f"  1. Veritas/api/main.py")
    print(f"       APP_ID = {new_app_id}")
    print()
    print(f"  2. Veritas/projects/Veritas-frontend/src/App.tsx")
    print(f"       const APP_ID = {new_app_id}")
    print()
    print("  Then commit and push — Render + Vercel will redeploy automatically.")
    print()


if __name__ == "__main__":
    main()
