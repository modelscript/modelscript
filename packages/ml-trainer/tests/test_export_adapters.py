# SPDX-License-Identifier: AGPL-3.0-or-later

import json
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np

from modelscript_trainer.export_adapters import GGUF_MAGIC, export_all_targets
from modelscript_trainer.train_dynamic_m import build_arg_parser, run_training


class TestMultiTargetExportsAndDataInf(unittest.TestCase):
    def test_export_all_targets_mlc_gguf_onnx_peft(self) -> None:
        rng = np.random.default_rng(42)
        tensors = {
            "blocks.0.attn.q_proj.lora_a": rng.normal(0, 0.05, size=(4, 16)).astype(np.float32),
            "blocks.0.attn.q_proj.lora_b": rng.normal(0, 0.05, size=(16, 4)).astype(np.float32),
            "projection_head.weight": rng.normal(0, 0.1, size=(32, 16)).astype(np.float32),
            "projection_head.bias": np.zeros((32,), dtype=np.float32),
        }
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            exports = export_all_targets(
                tensors,
                out_dir,
                targets=["mlc-webgpu", "gguf", "onnx", "peft"],
                model_id="msx-modelica-v1",
                base_model="Qwen/Qwen3-1.7B",
                lora_rank=4,
                lora_alpha=8.0,
                retriever_dim=32,
                m_cap=32,
            )

            # MLC-WebGPU bundle
            self.assertIn("mlcWebgpu", exports)
            mlc_cfg = json.loads((out_dir / "mlc_webgpu" / "mlc-chat-config.json").read_text("utf-8"))
            self.assertEqual(mlc_cfg["model_id"], "msx-modelica-v1")
            self.assertEqual(mlc_cfg["lora_adapter"]["rank"], 4)
            self.assertTrue((out_dir / "mlc_webgpu" / "params_shard_0.bin").exists())
            self.assertTrue((out_dir / "mlc_webgpu" / "ndarray-cache.json").exists())

            # GGUF v3 binary verification
            self.assertIn("gguf", exports)
            gguf_bytes = (out_dir / "gguf" / "adapter.gguf").read_bytes()
            self.assertEqual(gguf_bytes[:4], GGUF_MAGIC)
            version = struct.unpack("<I", gguf_bytes[4:8])[0]
            tensor_count = struct.unpack("<Q", gguf_bytes[8:16])[0]
            self.assertEqual(version, 3)
            self.assertEqual(tensor_count, 4)

            # ONNX QueryProjectionHead spec
            self.assertIn("onnx", exports)
            onnx_spec = json.loads((out_dir / "onnx" / "query_projection_head.onnx.json").read_text("utf-8"))
            self.assertTrue(onnx_spec["hasWeights"])
            self.assertEqual(onnx_spec["weights"]["W_q"]["shape"], [32, 16])

            # PEFT Multi-LoRA config
            self.assertIn("peft", exports)
            peft_cfg = json.loads((out_dir / "peft" / "adapter_config.json").read_text("utf-8"))
            self.assertEqual(peft_cfg["peft_type"], "LORA")
            self.assertEqual(peft_cfg["r"], 4)

    def test_train_dynamic_m_emits_datainf_attribution_and_exports(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "run_out"
            parser = build_arg_parser()
            args = parser.parse_args(
                [
                    "--mode",
                    "projection-head-align",
                    "--epochs",
                    "1",
                    "--batch-size",
                    "4",
                    "--hidden-dim",
                    "16",
                    "--num-layers",
                    "1",
                    "--num-heads",
                    "2",
                    "--retriever-dim",
                    "32",
                    "--export-targets",
                    "mlc-webgpu,gguf,onnx,peft",
                    "--output-dir",
                    str(out_dir),
                ]
            )
            run_training(args)
            attr = json.loads((out_dir / "attribution_weights.json").read_text("utf-8"))
            self.assertEqual(attr["method"], "lora_datainf")
            self.assertGreater(len(attr["weights"]), 0)
            self.assertAlmostEqual(sum(attr["weights"].values()), 1.0, places=3)
            self.assertTrue((out_dir / "gguf" / "adapter.gguf").exists())
            self.assertTrue((out_dir / "mlc_webgpu" / "mlc-chat-config.json").exists())


if __name__ == "__main__":
    unittest.main()
