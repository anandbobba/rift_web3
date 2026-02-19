from fastapi import FastAPI, File, UploadFile, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageFilter
import imagehash
import io
import base64
import os
import numpy as np
from scipy.fft import dctn
import hashlib
import requests
import cloudinary
import cloudinary.uploader

# On Vercel, env vars are injected directly — no .env file needed
cloudinary.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))

ALGOD_URL = "https://testnet-api.algonode.cloud"
APP_ID    = 755787017


def encode_algorand_address(pk_bytes: bytes) -> str:
    """Encode 32-byte public key as an Algorand address (base32 + checksum)."""
    chksum = hashlib.new("sha512_256", pk_bytes).digest()[-4:]
    return base64.b32encode(pk_bytes + chksum).decode().upper().rstrip("=")

app = FastAPI(title="Veritas Protocol API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pillow version compatibility
try:
    _FLIP_LR = Image.Transpose.FLIP_LEFT_RIGHT
except AttributeError:
    _FLIP_LR = Image.FLIP_LEFT_RIGHT  # type: ignore[attr-defined]

SYMMETRY_TRANSFORMS = [
    ("Original",                 lambda img: img),
    ("90deg Rotation",           lambda img: img.rotate(90, expand=True)),
    ("180deg Rotation",          lambda img: img.rotate(180)),
    ("270deg Rotation",          lambda img: img.rotate(270, expand=True)),
    ("Horizontal Mirror",        lambda img: img.transpose(_FLIP_LR)),
    ("Mirrored 90deg Rotation",  lambda img: img.rotate(90, expand=True).transpose(_FLIP_LR)),
    ("Mirrored 180deg Rotation", lambda img: img.rotate(180).transpose(_FLIP_LR)),
    ("Mirrored 270deg Rotation", lambda img: img.rotate(270, expand=True).transpose(_FLIP_LR)),
]


def denoise(img: Image.Image) -> Image.Image:
    return img.convert("RGB").filter(ImageFilter.MedianFilter(size=3))


def compute_phash(img: Image.Image) -> imagehash.ImageHash:
    return imagehash.phash(denoise(img))


def fetch_registry_from_chain() -> dict:
    registry = {}
    try:
        resp = requests.get(f"{ALGOD_URL}/v2/applications/{APP_ID}/boxes", timeout=10)
        for box_ref in resp.json().get("boxes", []):
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
            registry[phash_hex] = encode_algorand_address(value_bytes)
    except Exception as e:
        print(f"[CHAIN] Error: {e}")
    return registry


# ── All routes are under /api prefix so Vercel routes them correctly ──────────
router = APIRouter(prefix="/api")


@router.post("/compute-hash")
async def compute_hash(file: UploadFile = File(...)):
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))
        phash_str = str(compute_phash(img))

        cloudinary_url = ""
        try:
            result = cloudinary.uploader.upload(
                io.BytesIO(data),
                folder="veritas",
                public_id=f"artwork_{phash_str}",
                resource_type="image",
                overwrite=False,
            )
            cloudinary_url = result.get("secure_url", "")
        except Exception as ce:
            print(f"[CLOUDINARY] Upload error (non-fatal): {ce}")

        return {"phash": phash_str, "status": "ok", "cloudinary_url": cloudinary_url}
    except Exception as e:
        return {"error": str(e)}


@router.post("/verify")
async def verify_artwork(file: UploadFile = File(...)):
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))
        registry = fetch_registry_from_chain()

        if not registry:
            return {"status": "No Registry", "message": f"No artworks in App {APP_ID}"}

        best_distance = None
        best_match_hash = None
        best_match_owner = None
        best_transform = "Original"

        for name, fn in SYMMETRY_TRANSFORMS:
            try:
                suspect_hash = compute_phash(fn(img))
                for stored_str, owner in registry.items():
                    dist = suspect_hash - imagehash.hex_to_hash(stored_str)
                    if best_distance is None or dist < best_distance:
                        best_distance, best_match_hash, best_match_owner, best_transform = dist, stored_str, owner, name
                    if best_distance == 0:
                        break
            except Exception:
                continue
            if best_distance == 0:
                break

        detection_method = f"Detected via {best_transform}"
        if best_distance == 0:
            return {"status": "Original", "score": 0, "matched_hash": best_match_hash, "owner": best_match_owner, "detection_method": detection_method, "app_id": APP_ID}
        if best_distance <= 10:
            return {"status": "Plagiarism Detected", "score": int(best_distance), "matched_hash": best_match_hash, "owner": best_match_owner, "detection_method": detection_method, "app_id": APP_ID}
        return {"status": "Clear", "score": int(best_distance), "detection_method": f"All 8 orientations — best: {best_transform} (dist={best_distance})", "app_id": APP_ID}

    except Exception as e:
        return {"error": str(e)}


@router.get("/registry")
async def get_registry():
    try:
        registry = fetch_registry_from_chain()
        return {
            "count": len(registry),
            "app_id": APP_ID,
            "network": "Testnet",
            "hashes": [{"phash": h, "owner": o, "short": h[:8] + "..."} for h, o in registry.items()],
        }
    except Exception as e:
        return {"error": str(e), "count": 0, "hashes": []}


@router.post("/analyze")
async def analyze_artwork(file: UploadFile = File(...)):
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))

        denoised_rgb = denoise(img)
        gray = denoised_rgb.convert("L").resize((32, 32), Image.LANCZOS)

        buf = io.BytesIO(); gray.save(buf, format="PNG")
        gray_b64 = base64.b64encode(buf.getvalue()).decode()

        gray_original = img.convert("L").resize((32, 32), Image.LANCZOS)
        buf2 = io.BytesIO(); gray_original.save(buf2, format="PNG")
        gray_original_b64 = base64.b64encode(buf2.getvalue()).decode()

        arr = np.array(gray, dtype=float)
        dct_matrix = dctn(arr, norm="ortho")
        low_freq = dct_matrix[:8, :8]
        coeffs_full = low_freq.flatten()
        median_val = float(np.median(coeffs_full[1:]))
        bits = [1 if float(c) > median_val else 0 for c in coeffs_full]
        binary_str = "".join(str(b) for b in bits)
        official_phash = str(imagehash.phash(denoised_rgb))

        dct_norm = low_freq.copy()
        mn, mx = dct_norm.min(), dct_norm.max()
        if mx != mn:
            dct_norm = (dct_norm - mn) / (mx - mn) * 255

        return {
            "phash_hex": official_phash,
            "phash_binary": binary_str,
            "median_frequency": round(median_val, 4),
            "bitmask_8x8": bits,
            "dct_heatmap": [float(v) for v in dct_norm.flatten()],
            "gray_32x32_b64": gray_b64,
            "gray_original_b64": gray_original_b64,
            "pixels_32x32": list(gray.getdata()),
        }
    except Exception as e:
        return {"error": str(e)}


app.include_router(router)
