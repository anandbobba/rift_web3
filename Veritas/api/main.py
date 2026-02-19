from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageFilter
import imagehash
import io
import base64
import numpy as np
from scipy.fft import dctn

# Algorand Testnet — read contract boxes for live registry
from algosdk.v2client import algod, indexer

# ── Testnet config ────────────────────────────────────────────────────────────
ALGOD_URL   = "https://testnet-api.algonode.cloud"
INDEXER_URL = "https://testnet-idx.algonode.cloud"
ALGOD_TOKEN = ""          # AlgoNode public endpoints need no token
APP_ID      = 755787017   # Veritas VeritasRegistry App ID on Testnet

algod_client    = algod.AlgodClient(ALGOD_TOKEN, ALGOD_URL)
indexer_client  = indexer.IndexerClient(ALGOD_TOKEN, INDEXER_URL)

app = FastAPI(title="Veritas Protocol API — Testnet")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pillow version compatibility (Transpose enum added in Pillow 9.1) ────────
try:
    _FLIP_LR = Image.Transpose.FLIP_LEFT_RIGHT
except AttributeError:
    _FLIP_LR = Image.FLIP_LEFT_RIGHT  # type: ignore[attr-defined]

# ── 8-Way Symmetry Transform Table ───────────────────────────────────────────
SYMMETRY_TRANSFORMS = [
    ("Original",               lambda img: img),
    ("90deg Rotation",         lambda img: img.rotate(90, expand=True)),
    ("180deg Rotation",        lambda img: img.rotate(180)),
    ("270deg Rotation",        lambda img: img.rotate(270, expand=True)),
    ("Horizontal Mirror",      lambda img: img.transpose(_FLIP_LR)),
    ("Mirrored 90deg Rotation",  lambda img: img.rotate(90, expand=True).transpose(_FLIP_LR)),
    ("Mirrored 180deg Rotation", lambda img: img.rotate(180).transpose(_FLIP_LR)),
    ("Mirrored 270deg Rotation", lambda img: img.rotate(270, expand=True).transpose(_FLIP_LR)),
]


def denoise(img: Image.Image) -> Image.Image:
    """3×3 Median Blur — strips adversarial high-freq perturbations."""
    return img.convert("RGB").filter(ImageFilter.MedianFilter(size=3))


def compute_phash(img: Image.Image) -> imagehash.ImageHash:
    """Denoise then pHash — always matches what was stored on-chain."""
    return imagehash.phash(denoise(img))


def fetch_registry_from_chain() -> dict[str, str]:
    """
    Read all registered pHashes directly from the Algorand Testnet.
    The VeritasRegistry contract stores: BoxMap(String -> Account)
    Box key   = the hex pHash string (UTF-8 bytes)
    Box value = 32-byte Algorand public key (owner address)
    Returns dict: { phash_hex: owner_address }
    """
    registry: dict[str, str] = {}
    try:
        boxes = algod_client.application_boxes(APP_ID)
        box_list = boxes.get("boxes", [])
        print(f"[CHAIN] Found {len(box_list)} box(es) in App {APP_ID}")

        for box_ref in box_list:
            # box_ref["name"] is base64-encoded box name (= the pHash hex string)
            import base64 as _b64
            box_name_b64 = box_ref["name"]
            box_name_bytes = _b64.b64decode(box_name_b64)
            raw_key = box_name_bytes.decode("utf-8")
            # algopy BoxMap prefixes every key with the field name
            BOX_PREFIX = "registered_hashes"
            phash_hex = raw_key[len(BOX_PREFIX):] if raw_key.startswith(BOX_PREFIX) else raw_key

            # Fetch box value = 32-byte account public key
            box_data = algod_client.application_box_by_name(APP_ID, box_name_bytes)
            value_b64 = box_data.get("value", "")
            value_bytes = _b64.b64decode(value_b64)

            # Decode 32-byte public key → Algorand address
            from algosdk import encoding
            owner_address = encoding.encode_address(value_bytes)

            registry[phash_hex] = owner_address
            print(f"[CHAIN] Loaded: {phash_hex[:8]}... -> {owner_address[:8]}...")

    except Exception as e:
        print(f"[CHAIN] Error reading boxes: {e}")

    return registry


@app.post("/compute-hash")
async def compute_hash(file: UploadFile = File(...)):
    """
    STEP 1 for the frontend: Compute the 64-bit pHash of the uploaded image.
    Returns the hex hash so the frontend can build a smart contract transaction
    and sign it with Pera Wallet (the actual on-chain write happens in the browser).
    """
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))
        phash = compute_phash(img)
        phash_str = str(phash)
        print(f"[HASH] Computed pHash: {phash_str}")
        return {"phash": phash_str, "status": "ok"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/verify")
async def verify_artwork(file: UploadFile = File(...)):
    """
    VERIFIER endpoint: Multi-layered forensic scan against the live Testnet registry.
      Layer 1 — Adversarial Noise Defense (Median Blur)
      Layer 2 — 8-Way Symmetry Invariance (D4 group)
      Layer 3 — pHash Hamming Distance on DCT skeleton
    Reads registry LIVE from Algorand Testnet BoxMap — no local cache.
    """
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))

        # Pull registry fresh from the blockchain
        registry = fetch_registry_from_chain()

        if not registry:
            return {
                "status": "No Registry",
                "message": f"No artworks found in App {APP_ID} on Testnet. Register one first."
            }

        best_distance = None
        best_match_hash = None
        best_match_owner = None
        best_transform = "Original"

        for transform_name, transform_fn in SYMMETRY_TRANSFORMS:
            try:
                transformed = transform_fn(img)
                suspect_hash = compute_phash(transformed)

                for stored_hash_str, owner in registry.items():
                    stored_hash = imagehash.hex_to_hash(stored_hash_str)
                    distance = suspect_hash - stored_hash
                    print(f"[VERIFY] {transform_name:28s} dist={distance:3d} vs {stored_hash_str[:8]}...")

                    if best_distance is None or distance < best_distance:
                        best_distance = distance
                        best_match_hash = stored_hash_str
                        best_match_owner = owner
                        best_transform = transform_name

                    if best_distance == 0:
                        break

            except Exception as te:
                print(f"[VERIFY] Transform error ({transform_name}): {te}")
                continue

            if best_distance == 0:
                break

        detection_method = f"Detected via {best_transform}"

        if best_distance == 0:
            return {
                "status": "Original",
                "score": 0,
                "matched_hash": best_match_hash,
                "owner": best_match_owner,
                "detection_method": detection_method,
                "app_id": APP_ID,
                "network": "Testnet",
            }

        if best_distance <= 10:
            return {
                "status": "Plagiarism Detected",
                "score": int(best_distance),
                "matched_hash": best_match_hash,
                "owner": best_match_owner,
                "detection_method": detection_method,
                "app_id": APP_ID,
                "network": "Testnet",
            }

        return {
            "status": "Clear",
            "score": int(best_distance),
            "detection_method": f"All 8 orientations tested — best: {best_transform} (dist={best_distance})",
            "app_id": APP_ID,
            "network": "Testnet",
        }

    except Exception as e:
        return {"error": str(e)}


@app.get("/registry")
async def get_registry():
    """Returns registry read live from Algorand Testnet boxes."""
    try:
        registry = fetch_registry_from_chain()
        return {
            "count": len(registry),
            "app_id": APP_ID,
            "network": "Testnet",
            "hashes": [
                {"phash": h, "owner": o, "short": h[:8] + "..."}
                for h, o in registry.items()
            ]
        }
    except Exception as e:
        return {"error": str(e), "count": 0, "hashes": []}


@app.post("/analyze")
async def analyze_artwork(file: UploadFile = File(...)):
    """
    FORENSIC endpoint: Full multi-layer pipeline visualisation.
    Steps: Median Blur → Grayscale 32×32 → 2D DCT → 8×8 low-pass → Median bitmask
    """
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))

        denoised_rgb = denoise(img)
        gray = denoised_rgb.convert("L").resize((32, 32), Image.LANCZOS)

        buf = io.BytesIO()
        gray.save(buf, format="PNG")
        gray_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        gray_original = img.convert("L").resize((32, 32), Image.LANCZOS)
        buf2 = io.BytesIO()
        gray_original.save(buf2, format="PNG")
        gray_original_b64 = base64.b64encode(buf2.getvalue()).decode("utf-8")

        pixels = list(gray.getdata())

        arr = np.array(gray, dtype=float)
        dct_matrix = dctn(arr, norm="ortho")
        low_freq = dct_matrix[:8, :8]
        coeffs_full = low_freq.flatten()
        coeffs_no_dc = coeffs_full[1:]

        median_val = float(np.median(coeffs_no_dc))
        bits = [1 if float(c) > median_val else 0 for c in coeffs_full]
        binary_str = "".join(str(b) for b in bits)
        official_phash = str(imagehash.phash(denoised_rgb))

        dct_norm = low_freq.copy()
        dct_min, dct_max = dct_norm.min(), dct_norm.max()
        if dct_max != dct_min:
            dct_norm = (dct_norm - dct_min) / (dct_max - dct_min) * 255
        dct_flat = [float(v) for v in dct_norm.flatten()]

        print(f"[ANALYZE] pHash: {official_phash} | Median: {median_val:.2f}")

        return {
            "phash_hex": official_phash,
            "phash_binary": binary_str,
            "median_frequency": round(median_val, 4),
            "bitmask_8x8": bits,
            "dct_heatmap": dct_flat,
            "gray_32x32_b64": gray_b64,
            "gray_original_b64": gray_original_b64,
            "pixels_32x32": pixels,
        }

    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
