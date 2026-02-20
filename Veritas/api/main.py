from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageFilter
import imagehash
import io
import base64
import os
import hashlib
import requests
import numpy as np
from pathlib import Path
from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader
import cloudinary.api

# Load .env from the same directory as this file, regardless of cwd
load_dotenv(Path(__file__).parent / '.env')

# Cloudinary — configured via CLOUDINARY_URL in .env
cloudinary.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))

# ── Testnet config ────────────────────────────────────────────────────────────
ALGOD_URL = "https://testnet-api.algonode.cloud"
APP_ID    = 755806101   # Veritas VeritasRegistry App ID on Testnet


def encode_algorand_address(pk_bytes: bytes) -> str:
    """Encode 32-byte public key as Algorand address (base32 + sha512/256 checksum)."""
    chksum = hashlib.new("sha512_256", pk_bytes).digest()[-4:]
    return base64.b32encode(pk_bytes + chksum).decode().upper().rstrip("=")


def dctn_numpy(arr: np.ndarray) -> np.ndarray:
    """2D Type-II DCT with ortho normalization — replaces scipy.fft.dctn."""
    def _dct1d(x: np.ndarray) -> np.ndarray:
        N = len(x)
        v = np.empty(2 * N)
        v[:N] = x
        v[N:] = x[::-1]
        V = np.fft.rfft(v)[:N]
        k = np.arange(N, dtype=float)
        phase = np.exp(-1j * np.pi * k / (2.0 * N))
        result = np.real(phase * V)
        result[0] /= np.sqrt(4.0 * N)
        result[1:] /= np.sqrt(2.0 * N)
        return result
    tmp = np.apply_along_axis(_dct1d, 1, arr.astype(float))
    return np.apply_along_axis(_dct1d, 0, tmp)

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

def pad_to_scale(img: Image.Image, factor: float) -> Image.Image:
    """
    Simulate 'unzoom': place the image centred on a neutral-grey canvas that is
    `factor` times larger. This reverses a crop/zoom so pHash sees the original
    low-frequency structure again.
    e.g. factor=2.0 → the query image fills only the centre 50% of the canvas.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    nw, nh = int(w * factor), int(h * factor)
    canvas = Image.new("RGB", (nw, nh), (128, 128, 128))
    canvas.paste(rgb, ((nw - w) // 2, (nh - h) // 2))
    return canvas


# ── Transform Table: 8-way symmetry + zoom-out variants ───────────────────────
SYMMETRY_TRANSFORMS = [
    ("Original",                    lambda img: img),
    ("90deg Rotation",              lambda img: img.rotate(90, expand=True)),
    ("180deg Rotation",             lambda img: img.rotate(180)),
    ("270deg Rotation",             lambda img: img.rotate(270, expand=True)),
    ("Horizontal Mirror",           lambda img: img.transpose(_FLIP_LR)),
    ("Mirrored 90deg Rotation",     lambda img: img.rotate(90, expand=True).transpose(_FLIP_LR)),
    ("Mirrored 180deg Rotation",    lambda img: img.rotate(180).transpose(_FLIP_LR)),
    ("Mirrored 270deg Rotation",    lambda img: img.rotate(270, expand=True).transpose(_FLIP_LR)),
    # Zoom-invariance: pad the query image to simulate it being a zoomed-in crop
    ("Zoom-out x1.25",              lambda img: pad_to_scale(img, 1.25)),
    ("Zoom-out x1.5",               lambda img: pad_to_scale(img, 1.50)),
    ("Zoom-out x2.0",               lambda img: pad_to_scale(img, 2.00)),
    ("Zoom-out x1.25 + Mirror",     lambda img: pad_to_scale(img, 1.25).transpose(_FLIP_LR)),
    ("Zoom-out x1.5  + Mirror",     lambda img: pad_to_scale(img, 1.50).transpose(_FLIP_LR)),
]


def denoise(img: Image.Image) -> Image.Image:
    """3×3 Median Blur — strips adversarial high-freq perturbations."""
    return img.convert("RGB").filter(ImageFilter.MedianFilter(size=3))


def compute_phash(img: Image.Image) -> imagehash.ImageHash:
    """Denoise then pHash — always matches what was stored on-chain."""
    return imagehash.phash(denoise(img))


def get_original_sha256_from_cloudinary(phash_str: str) -> str | None:
    """
    Fetch the original registered image from Cloudinary and return its SHA-256.
    Used to distinguish "exact same file" from "perceptually identical derivative".
    """
    try:
        resource = cloudinary.api.resource(f"veritas/artwork_{phash_str}")
        url = resource.get("secure_url", "")
        if url:
            r = requests.get(url, timeout=15)
            return hashlib.sha256(r.content).hexdigest()
    except Exception as e:
        print(f"[CLOUDINARY] Could not fetch original for SHA-256 comparison: {e}")
    return None


def fetch_registry_from_chain() -> dict:
    """Read all registered pHashes directly from Algorand Testnet via REST API."""
    registry: dict = {}
    try:
        resp = requests.get(f"{ALGOD_URL}/v2/applications/{APP_ID}/boxes", timeout=10)
        box_list = resp.json().get("boxes", [])
        print(f"[CHAIN] Found {len(box_list)} box(es) in App {APP_ID}")

        for box_ref in box_list:
            box_name_b64 = box_ref["name"]
            box_name_bytes = base64.b64decode(box_name_b64)
            raw_key = box_name_bytes.decode("utf-8", errors="replace")
            BOX_PREFIX = "registered_hashes"
            phash_hex = raw_key[len(BOX_PREFIX):] if raw_key.startswith(BOX_PREFIX) else raw_key

            box_resp = requests.get(
                f"{ALGOD_URL}/v2/applications/{APP_ID}/box",
                params={"name": f"b64:{box_name_b64}"},
                timeout=10,
            )
            value_bytes = base64.b64decode(box_resp.json().get("value", ""))
            owner_address = encode_algorand_address(value_bytes)

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

        # ── Upload original image to Cloudinary ────────────────────────────
        cloudinary_url = ""
        try:
            upload_result = cloudinary.uploader.upload(
                io.BytesIO(data),
                folder="veritas",
                public_id=f"artwork_{phash_str}",
                resource_type="image",
                overwrite=False,
            )
            cloudinary_url = upload_result.get("secure_url", "")
            print(f"[CLOUDINARY] Uploaded: {cloudinary_url}")
        except Exception as ce:
            print(f"[CLOUDINARY] Upload error (non-fatal): {ce}")

        return {"phash": phash_str, "status": "ok", "cloudinary_url": cloudinary_url}
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
            # pHash is perceptually identical — now check if bytes are actually the same.
            # A sketch/filter/stylised version can produce the same pHash as the original
            # but is a different file → should be Plagiarism Detected, not Original Verified.
            uploaded_sha = hashlib.sha256(data).hexdigest()
            original_sha = get_original_sha256_from_cloudinary(best_match_hash)
            print(f"[VERIFY] SHA-256 uploaded={uploaded_sha[:12]}... original={str(original_sha)[:12]}...")

            if original_sha is not None and uploaded_sha != original_sha:
                # Same perceptual structure, different file — derivative work
                return {
                    "status": "Plagiarism Detected",
                    "score": 0,
                    "matched_hash": best_match_hash,
                    "owner": best_match_owner,
                    "detection_method": f"{detection_method} (near-identical derivative — same composition, different file)",
                    "app_id": APP_ID,
                    "network": "Testnet",
                }

            # SHA-256 matches (or Cloudinary unavailable) — treat as genuine original
            return {
                "status": "Original",
                "score": 0,
                "matched_hash": best_match_hash,
                "owner": best_match_owner,
                "detection_method": detection_method,
                "app_id": APP_ID,
                "network": "Testnet",
            }

        if best_distance <= 15:
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


@app.get("/")
async def root():
    return {"status": "ok", "message": "Veritas Protocol API is running", "endpoints": ["/registry", "/compute-hash", "/verify", "/analyze"]}


@app.get("/algod/params")
async def algod_params():
    """Proxy: fetch suggested transaction params from AlgoNode (avoids browser 403)."""
    try:
        r = requests.get(f"{ALGOD_URL}/v2/transactions/params", timeout=10)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


@app.get("/algod/account/{address}")
async def algod_account(address: str):
    """Proxy: fetch account info from AlgoNode (avoids browser 403)."""
    try:
        r = requests.get(f"{ALGOD_URL}/v2/accounts/{address}", timeout=10)
        return r.json()
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
        dct_matrix = dctn_numpy(arr)
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
