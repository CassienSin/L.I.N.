"""Generate Lin's personal audition set using local files and no network access."""
import json
import os
from pathlib import Path
import socket
import time

BASE = Path(__file__).resolve().parent
os.environ.update({
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "GRADIO_ANALYTICS_ENABLED": "False",
    "TOKENIZERS_PARALLELISM": "false",
    "HF_HOME": str(BASE.parent / ".cache" / "huggingface"),
    "TORCH_HOME": str(BASE.parent / ".cache" / "torch"),
})

def block_network(*args, **kwargs):
    raise RuntimeError("Network access is disabled during Lin's local audition generation")

socket.socket.connect = block_network
socket.socket.connect_ex = block_network
socket.create_connection = block_network

import numpy as np
import soundfile as sf
import torch
from omnivoice import OmniVoice

def main():
    torch.set_num_threads(6)
    torch.set_num_interop_threads(2)
    spec = json.loads((BASE / "audition-script.json").read_text(encoding="utf-8"))
    out = BASE / "auditions"
    out.mkdir(exist_ok=True)
    print("Loading local model on CPU. Network connections are blocked in this process.", flush=True)
    started = time.perf_counter()
    model = OmniVoice.from_pretrained(str(BASE / "models" / "omnivoice"), device_map="cpu", dtype=torch.float32, load_asr=False)
    model.eval()
    report = {
        "engine": "OmniVoice", "device": "cpu", "threads": 6,
        "model_load_seconds": round(time.perf_counter() - started, 2),
        "network": "Offline environment flags and socket connection blocking enabled for the generation process",
        "purpose": spec["purpose"], "license": spec["model_license"],
        "reference": "Synthetic English sample generated here; no real person's reference recording used",
        "listening_review": "Pending user audition; no claim of native pronunciation or voice consistency",
        "samples": [], "comparisons": [],
    }
    print(f"Model loaded in {report['model_load_seconds']} seconds.", flush=True)
    for profile in spec["profiles"]:
        clips = []
        reference = None
        for index, line in enumerate(spec["lines"]):
            path = out / f"lin-{profile['id']}-{line['id']}.wav"
            if path.exists():
                print(f"Reusing generated sample: {path.name}", flush=True)
                wave, sr = sf.read(path, dtype="float32")
                elapsed = None
            else:
                torch.manual_seed(profile["seed"] + index)
                print(f"Generating {profile['label']} / {line['id']}...", flush=True)
                started = time.perf_counter()
                args = {"text": line["text"], "language": line["language_id"], "num_step": 32, "speed": 0.96}
                if reference is None:
                    args["instruct"] = profile["instruct"]
                else:
                    args["ref_audio"] = str(reference)
                    args["ref_text"] = spec["lines"][0]["text"]
                with torch.inference_mode():
                    wave = np.asarray(model.generate(**args)[0], dtype=np.float32).reshape(-1)
                elapsed = round(time.perf_counter() - started, 2)
                sr = model.sampling_rate
                if not np.isfinite(wave).all() or len(wave) < sr:
                    raise ValueError(f"Invalid audio generated for {path.name}")
                peak = float(np.max(np.abs(wave)))
                if peak < 0.001:
                    raise ValueError(f"Near-silent audio generated for {path.name}")
                if peak > 0.95:
                    wave = wave * (0.95 / peak)
                sf.write(path, wave, sr, subtype="PCM_16")
            if index == 0:
                reference = path
            clips.append(wave)
            duration = len(wave) / sr
            result = {"profile": profile["id"], "language": line["id"], "language_id": line["language_id"], "text": line["text"], "file": path.name, "sample_rate": sr, "duration_seconds": round(duration, 2), "generation_seconds": elapsed, "realtime_factor": round(elapsed / duration, 2) if elapsed else None, "peak": round(float(np.max(np.abs(wave))), 4), "rms": round(float(np.sqrt(np.mean(wave ** 2))), 4)}
            report["samples"].append(result)
            (out / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
            print(json.dumps(result, ensure_ascii=False), flush=True)
        silence = np.zeros(int(sr * 1.2), dtype=np.float32)
        joined = np.concatenate([clips[0], silence, clips[1], silence, clips[2]])
        combined = out / f"lin-{profile['id']}-multilingual.wav"
        sf.write(combined, joined, sr, subtype="PCM_16")
        report["comparisons"].append({"profile": profile["id"], "label": profile["label"], "file": combined.name, "language_order": [x["id"] for x in spec["lines"]], "duration_seconds": round(len(joined)/sr, 2)})
        (out / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("All local audition samples are ready.", flush=True)

if __name__ == "__main__":
    main()
