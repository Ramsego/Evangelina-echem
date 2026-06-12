import asyncio
import logging
import os
import re
import tempfile
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any
from uuid import uuid4

import gamry_parser as gp_parser
from fastapi import APIRouter, HTTPException, Request, UploadFile
from limiter import limiter

from gamry_plotter.data import (
    extract_cv_curves,
    extract_dta_metadata,
    extract_eis_df,
    get_gcd_master_data,
    load_cycle_data,
    load_gcd_master_waveforms,
    manual_detect_type,
    organize_gcd_files,
)
from gamry_plotter.demo import generate_sample_data

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Upload limits (overridable via env vars) ───────────────────────────────────
_MAX_FILES       = int(os.getenv("MAX_FILES",    "100"))
_MAX_FILE_MB     = int(os.getenv("MAX_FILE_MB",  "20"))
_MAX_TOTAL_MB    = int(os.getenv("MAX_TOTAL_MB", "100"))
UPLOADS_ENABLED  = os.getenv("UPLOADS_ENABLED", "true").lower() != "false"
_CACHE_TTL_S     = int(os.getenv("CACHE_TTL_S", "3600"))  # 1 h default
_MAX_RANGE       = int(os.getenv("MAX_RANGE",   "500"))   # max curves/cycles per fetch


def _safe_filename(name: str) -> str:
    """Strip path components and replace non-safe chars to prevent path traversal."""
    name = Path(name).name
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or "upload"


def _cache_get(store: OrderedDict, key: str) -> Any:
    """Return cached payload or None; evict entries older than _CACHE_TTL_S."""
    now = time.time()
    stale = [k for k, (ts, _) in list(store.items()) if now - ts > _CACHE_TTL_S]
    for k in stale:
        del store[k]
    if key not in store:
        return None
    store.move_to_end(key)
    return store[key][1]


def _cache_set(store: OrderedDict, key: str, val: Any, maxsize: int) -> None:
    store[key] = (time.time(), val)
    store.move_to_end(key)
    if len(store) > maxsize:
        store.popitem(last=False)

# ── Seesaw store ───────────────────────────────────────────────────────────────
_SEESAW_MAX   = 20
_seesaw_store: OrderedDict[str, tuple[float, dict]] = OrderedDict()

def _seesaw_put(file_id: str, data: dict) -> None:
    _cache_set(_seesaw_store, file_id, data, _SEESAW_MAX)

def _seesaw_get(file_id: str) -> dict | None:
    return _cache_get(_seesaw_store, file_id)


# ── GCD store ──────────────────────────────────────────────────────────────────
_GCD_STORE_MAX = 20
_gcd_store: OrderedDict[str, tuple[float, dict]] = OrderedDict()

def _gcd_put(file_id: str, waveforms: dict[int, dict]) -> None:
    _cache_set(_gcd_store, file_id, waveforms, _GCD_STORE_MAX)

def _gcd_get(file_id: str) -> dict | None:
    return _cache_get(_gcd_store, file_id)


# ── CV store ───────────────────────────────────────────────────────────────────
_CV_LAZY_THRESHOLD = 30
_CV_STORE_MAX      = 20
_cv_store: OrderedDict[str, tuple[float, list]] = OrderedDict()

def _cv_put(file_id: str, curves: list[dict]) -> None:
    _cache_set(_cv_store, file_id, curves, _CV_STORE_MAX)

def _cv_get(file_id: str) -> list | None:
    return _cache_get(_cv_store, file_id)


_CYCLE_PAT = re.compile(r"^(charge|discharge)[_\s]?#?\d+\.dta$", re.IGNORECASE)


def _ser(val: Any) -> Any:
    """Recursively make numpy/pandas values JSON-serialisable."""
    if hasattr(val, "tolist"):
        return val.tolist()
    if isinstance(val, dict):
        return {str(k): _ser(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_ser(v) for v in val]
    return val


def _parse_regular(name: str, path: Path) -> dict:
    gp = None
    etype = None
    try:
        gp = gp_parser.GamryParser()
        gp.load(filename=str(path))
        etype = gp.get_experiment_type()
    except Exception as exc:
        logger.warning("gamry_parser failed for %s: %s", name, exc)
        etype = manual_detect_type(path)

    entry: dict = {
        "id":       str(uuid4()),
        "name":     name,
        "etype":    etype,
        "metadata": extract_dta_metadata(path),
    }

    if etype in ("CV", "LSV") and gp:
        raw_curves = extract_cv_curves(gp)
        curves_list = [
            {"vf": _ser(df["Vf"].values), "im": _ser(df["Im"].values)}
            for df in raw_curves
        ]
        if len(curves_list) > _CV_LAZY_THRESHOLD:
            _cv_put(entry["id"], curves_list)
            entry["total_curves"] = len(curves_list)
        else:
            entry["curves"] = curves_list
    elif etype == "EISPOT" and gp:
        df = extract_eis_df(gp)
        entry["eis"] = {
            "freq":  _ser(df["Freq"].values),
            "zreal": _ser(df["Zreal"].values),
            "zimag": _ser(df["Zimag"].values),
            "zmod":  _ser(df["Zmod"].values),
            "zphz":  _ser(df["Zphz"].values),
        }
    elif etype in ("CHRONOP", "PWR800_CYCLICCHARGEDISCHARGE"):
        (cycles, discharge_caps, charge_by_cycle), durations = get_gcd_master_data(path)
        entry["gcd"] = {
            "cycles":          _ser(cycles),
            "discharge_caps":  _ser(discharge_caps),
            "charge_by_cycle": _ser(charge_by_cycle),
            "durations":       _ser(durations),
        }
        # Energy from CAPACITYCURVE TABLE (PWR800 and some CHRONOP files have an
        # Energy column in Joules — use it directly so the Energy view works even
        # when no raw CURVE TABLE is present).
        energy_from_table = {
            str(c): round(d["dis_energy_j"] / 3.6, 4)
            for c, d in durations.items()
            if "dis_energy_j" in d
        }
        if energy_from_table:
            entry["gcd"]["dis_energy_mwh"] = energy_from_table
        ch_energy_from_table = {
            str(c): round(d["chg_energy_j"] / 3.6, 4)
            for c, d in durations.items()
            if "chg_energy_j" in d
        }
        if ch_energy_from_table:
            entry["gcd"]["ch_energy_mwh"] = ch_energy_from_table

        # Parse raw waveforms for on-demand cycle profiles (Profiles, dQ/dV, Energy views).
        # For PWR800 files the CURVE TABLE is absent; waveforms will be empty and
        # Profiles/dQ/dV views remain disabled — which is correct.
        waveforms = load_gcd_master_waveforms(path)
        if waveforms:
            _gcd_put(entry["id"], waveforms)
            entry["total_gcd_cycles"] = len(waveforms)
            # Raw-waveform energy overrides the table-level energy when available,
            # as it is integrated directly from V(t)·I(t) and is more accurate.
            entry["gcd"]["dis_energy_mwh"] = {
                str(c): round(data["discharge"]["energy_mwh"], 4)
                for c, data in waveforms.items()
                if "discharge" in data
            }
            entry["gcd"]["ch_energy_mwh"] = {
                str(c): round(data["charge"]["energy_mwh"], 4)
                for c, data in waveforms.items()
                if "charge" in data
            }

    if entry.get("etype") is None:
        entry["error"] = (
            "Unrecognised file format. "
            "Supported Gamry experiment types: CV, LSV, EISPOT (EIS), CHRONOP (GCD), "
            "PWR800_CYCLICCHARGEDISCHARGE, SEESAW. "
            "Check that this file was exported directly from Gamry Framework as a .dta file."
        )

    return entry


def _parse_cycle_group(files: list[tuple[str, bytes]], tmp_path: Path) -> dict | None:
    buckets = organize_gcd_files(tmp_path)
    if not buckets:
        return None

    all_cyc = sorted(buckets.keys())
    file_id = str(uuid4())

    cycle_data: dict = {}
    for c in all_cyc:
        cycle_data[c] = {}
        for step in ("charge", "discharge"):
            fp = buckets[c].get(step)
            cycle_data[c][step] = load_cycle_data(fp) if fp else ([], [])

    _seesaw_put(file_id, {"all_cycles": all_cyc, "cycle_data": cycle_data})

    return {
        "id":          file_id,
        "name":        f"GCD Cycles #{all_cyc[0]}–#{all_cyc[-1]}",
        "etype":       "SEESAW",
        "all_cycles":  all_cyc,
        "total_cycles": len(all_cyc),
    }


@router.post("/upload")
@limiter.limit("30/minute")
async def upload(request: Request, files: list[UploadFile]) -> list[dict]:
    if not UPLOADS_ENABLED:
        raise HTTPException(503, "Uploads are currently disabled")
    if len(files) > _MAX_FILES:
        raise HTTPException(400, f"Too many files (max {_MAX_FILES})")

    results: list[dict] = []

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        named: list[tuple[str, bytes]] = []
        total_bytes = 0

        for uf in files:
            content = await uf.read()
            if len(content) > _MAX_FILE_MB * 1024 * 1024:
                raise HTTPException(400, f"{uf.filename!r} exceeds {_MAX_FILE_MB} MB limit")
            total_bytes += len(content)
            if total_bytes > _MAX_TOTAL_MB * 1024 * 1024:
                raise HTTPException(400, f"Total upload exceeds {_MAX_TOTAL_MB} MB")
            if not uf.filename or not uf.filename.lower().endswith(".dta"):
                continue
            safe = _safe_filename(uf.filename)
            named.append((safe, content))
            (tmp_path / safe).write_bytes(content)

        cycle_names: set[str] = set()
        regular_names: list[str] = []
        for name, _ in named:
            if _CYCLE_PAT.match(name):
                cycle_names.add(name)
            else:
                regular_names.append(name)

        if cycle_names:
            cycle_pairs = [(n, c) for n, c in named if n in cycle_names]
            entry = await asyncio.to_thread(_parse_cycle_group, cycle_pairs, tmp_path)
            if entry:
                results.append(entry)

        if regular_names:
            parsed = await asyncio.gather(
                *[asyncio.to_thread(_parse_regular, name, tmp_path / name) for name in regular_names]
            )
            results.extend(parsed)

    return results


_SAMPLE_IDS = {
    "Sample_CV.dta":  "sample-cv",
    "Sample_LSV.dta": "sample-lsv",
    "Sample_EIS.dta": "sample-eis",
    "Sample_GCD.dta": "sample-gcd",
}

_sample_cache: list[dict] | None = None


def _build_sample() -> list[dict]:
    raw = generate_sample_data()
    results: list[dict] = []
    for item in raw:
        entry: dict = {"id": _SAMPLE_IDS.get(item["name"], item["name"]), "name": item["name"], "etype": item["etype"]}
        if item["etype"] in ("CV", "LSV"):
            entry["curves"] = [
                {"vf": _ser(df["Vf"].values), "im": _ser(df["Im"].values)}
                for df in item["curves"]
            ]
        elif item["etype"] == "EISPOT":
            df = item["eis_df"]
            entry["eis"] = {
                "freq":  _ser(df["Freq"].values),
                "zreal": _ser(df["Zreal"].values),
                "zimag": _ser(df["Zimag"].values),
                "zmod":  _ser(df["Zmod"].values),
                "zphz":  _ser(df["Zphz"].values),
            }
        elif item["etype"] == "CHRONOP":
            entry["gcd"] = {
                "cycles":          _ser(item["cycles"]),
                "discharge_caps":  _ser(item["discharge_caps"]),
                "charge_by_cycle": _ser(item["charge_by_cycle"]),
            }
        results.append(entry)
    return results


@router.get("/sample")
@limiter.limit("120/minute")
def sample(request: Request) -> list[dict]:
    global _sample_cache
    if _sample_cache is None:
        _sample_cache = _build_sample()
    return _sample_cache


@router.get("/files/{file_id}/curves")
@limiter.limit("120/minute")
def get_curves(request: Request, file_id: str, start: int = 1, end: int = 10) -> dict:
    curves = _cv_get(file_id)
    if curves is None:
        raise HTTPException(status_code=404, detail="File not found or expired — re-upload to restore")
    end = min(end, start + _MAX_RANGE - 1)
    s = max(0, start - 1)
    e = min(len(curves), end)
    return {"curves": curves[s:e], "start": start, "end": min(end, len(curves)), "total": len(curves)}


@router.get("/files/{file_id}/gcd-cycle")
@limiter.limit("120/minute")
def get_gcd_cycle(request: Request, file_id: str, cycle: int = 1) -> dict:
    waveforms = _gcd_get(file_id)
    if waveforms is None:
        raise HTTPException(status_code=404, detail="File not found or expired — re-upload to restore cycle data")
    if cycle not in waveforms:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle} not found")
    data = waveforms[cycle]
    _empty: dict = {"times": [], "voltages": [], "currents": [], "energy_mwh": 0.0}
    return {
        "cycle":     cycle,
        "charge":    data.get("charge",    _empty),
        "discharge": data.get("discharge", _empty),
    }


@router.get("/files/{file_id}/cycles")
@limiter.limit("120/minute")
def get_cycles(request: Request, file_id: str, start: int = 1, end: int = 10) -> dict:
    end = min(end, start + _MAX_RANGE - 1)
    store = _seesaw_get(file_id)
    if store is None:
        raise HTTPException(status_code=404, detail="File not found or expired — re-upload to restore")

    cycle_data = store["cycle_data"]

    times: list[float] = []
    voltages: list[float] = []
    cumulative = 0.0

    for c in range(start, end + 1):
        if c not in cycle_data:
            continue
        for step in ("charge", "discharge"):
            t, v = cycle_data[c][step]
            if not t:
                continue
            times.extend(x + cumulative for x in t)
            voltages.extend(v)
            cumulative += max(t)

    return {"times": times, "voltages": voltages, "start": start, "end": end}


@router.delete("/files/{file_id}")
@limiter.limit("60/minute")
def delete_file(request: Request, file_id: str) -> dict:
    removed = any(
        store.pop(file_id, None) is not None
        for store in (_seesaw_store, _gcd_store, _cv_store)
    )
    if not removed:
        raise HTTPException(status_code=404, detail="File not found in cache")
    logger.info("Deleted cached data for file_id=%s", file_id)
    return {"deleted": file_id}
